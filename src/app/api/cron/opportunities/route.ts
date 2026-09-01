import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { SECTOR_ETFS, TICKER_SECTOR, rankSectors } from '@/lib/screener';
import { sendTelegramMessage } from '@/lib/telegram';
import {
  evaluateOpportunity,
  formatOpportunityLine,
  type Opportunity,
} from '@/lib/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/opportunities
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Da schedulare una volta al giorno, dopo la chiusura di New York.
 * Notifica solo i primi risultati: una lista lunga non e' azionabile.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();
  const runDate = new Date().toISOString().slice(0, 10);

  try {
    const { data: weeklyRows } = await admin
      .from('weekly_trend_state')
      .select('ticker, state, flipped_at');
    const weeklyMap = new Map<
      string,
      { state: 'above' | 'below'; flippedAt: string | null }
    >();
    for (const w of weeklyRows ?? []) {
      weeklyMap.set(w.ticker, {
        state: w.state as 'above' | 'below',
        flippedAt: w.flipped_at,
      });
    }
    if (weeklyMap.size === 0) {
      return NextResponse.json(
        { error: 'Stato settimanale non disponibile: esegui prima quel cron.' },
        { status: 409 }
      );
    }

    const usAll = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ])
    );
    const universe = usAll.filter(
      (t) => weeklyMap.get(t)?.state === 'above'
    );

    const since90 = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);
    const { data: insiderRows } = await admin
      .from('insider_trades')
      .select('ticker, owner_name')
      .eq('transaction_code', 'P')
      .eq('is_derivative', false)
      .gte('transaction_date', since90)
      .limit(2000);
    const buyersByTicker = new Map<string, Set<string>>();
    for (const r of insiderRows ?? []) {
      if (!r.ticker) continue;
      const set = buyersByTicker.get(r.ticker) ?? new Set<string>();
      set.add(r.owner_name);
      buyersByTicker.set(r.ticker, set);
    }

    const sectorPerf = new Map<string, number | null>();
    const sectorRank = new Map<string, number>();
    try {
      const sc = await yahooDownloadMany(
        [...Object.keys(SECTOR_ETFS), 'SPY'],
        '1y',
        '1d',
        6
      );
      for (const s of rankSectors(sc)) {
        sectorPerf.set(s.etf, s.perf3m);
        sectorRank.set(s.etf, s.rank);
      }
    } catch {
      // accessorio
    }

    const found: Opportunity[] = [];
    const CHUNK = 40;
    let truncated = false;

    for (let i = 0; i < universe.length; i += CHUNK) {
      if (Date.now() - t0 > 40000) {
        truncated = true;
        break;
      }
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '1y', '1d', 8);
      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 200) continue;
        const etf = TICKER_SECTOR[ticker] ?? null;
        const w = weeklyMap.get(ticker);
        const o = evaluateOpportunity({
          ticker,
          candles,
          weeklyState: w?.state ?? null,
          weeklyFlippedAt: w?.flippedAt ?? null,
          insiderBuyers: buyersByTicker.get(ticker)?.size ?? 0,
          market: getMarketForTicker(ticker),
          sectorName: etf ? SECTOR_ETFS[etf] : null,
          sectorRank: etf ? (sectorRank.get(etf) ?? null) : null,
          sectorPerf3m: etf ? (sectorPerf.get(etf) ?? null) : null,
        });
        if (o) found.push(o);
      }
    }

    found.sort((a, b) => b.totalScore - a.totalScore);

    if (found.length > 0) {
      await admin.from('opportunities').upsert(
        found.map((o) => ({
          run_date: runDate,
          ticker: o.ticker,
          market: o.market,
          sector_name: o.sectorName,
          sector_rank: o.sectorRank,
          price: o.price,
          weekly_state: o.weeklyState,
          weekly_flip_recent: o.weeklyFlipRecent,
          trend_score: o.trendScore,
          discount_score: o.discountScore,
          ha_score: o.haScore,
          insider_buyers: o.insiderBuyers,
          total_score: o.totalScore,
          rsi14: o.rsi14,
          dist_from_52w_high: o.distFrom52wHigh,
          dist_from_ma50: o.distFromMa50,
          perf_3m: o.perf3m,
          ha_flip_bars_ago: o.haFlipBarsAgo,
          trend_checks_passed: o.trendChecksPassed,
          reasons: o.reasons,
        })),
        { onConflict: 'run_date,ticker', ignoreDuplicates: false }
      );
    }

    // Notifica solo i migliori: una lista lunga non si guarda
    let telegramSent = 0;
    const top = found.filter((o) => o.totalScore >= 65).slice(0, 10);
    if (top.length > 0) {
      const parts = [
        '🎯 <b>Radar giornaliero</b>',
        `${found.length} titoli in lista, ecco i primi ${top.length}`,
        '',
        ...top.map(
          (o, i) => `${i + 1}. ${formatOpportunityLine(o)}`
        ),
        '',
        '<i>Candidati da approfondire, non indicazioni operative.</i>',
      ];
      if (truncated) {
        parts.push('<i>Scansione parziale per limiti di tempo.</i>');
      }
      const text = parts.join('\n');

      const { data: users } = await admin
        .from('user_settings')
        .select('telegram_bot_token, telegram_chat_id')
        .not('telegram_bot_token', 'is', null)
        .not('telegram_chat_id', 'is', null);

      for (const u of users ?? []) {
        const ok = await sendTelegramMessage({
          token: u.telegram_bot_token!,
          chatId: u.telegram_chat_id!,
          text,
        });
        if (ok) telegramSent++;
      }
    }

    return NextResponse.json({
      ok: true,
      runDate,
      universeSize: universe.length,
      matches: found.length,
      notified: top.length,
      telegramSent,
      truncated,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
