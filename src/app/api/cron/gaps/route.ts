import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { analyzeGaps, formatGapLine, type Gap } from '@/lib/gaps';
import { sendTelegramMessage } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/gaps
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Da schedulare dopo la chiusura di New York. Per la notifica bastano
 * pochi giorni di storico: i gap nuovi sono quelli delle ultime sedute.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = Array.from(
      new Set([
        ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
        ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
      ])
    );

    // Solo i gap delle ultime 3 sedute: quelli piu' vecchi sono gia' noti
    const cutoff = new Date(Date.now() - 5 * 86400000)
      .toISOString()
      .slice(0, 10);

    const fresh: Gap[] = [];
    const CHUNK = 40;
    let truncated = false;

    for (let i = 0; i < universe.length; i += CHUNK) {
      if (Date.now() - t0 > 40000) {
        truncated = true;
        break;
      }
      const chunk = universe.slice(i, i + CHUNK);
      // 6 mesi bastano per rilevare i gap recenti e verificarne la chiusura
      const data = await yahooDownloadMany(chunk, '6mo', '1d', 8);

      const rows: Array<Record<string, unknown>> = [];
      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 30) continue;
        const r = analyzeGaps(ticker, candles, 2);
        if (!r) continue;
        const market = getMarketForTicker(ticker);
        for (const g of r.allGaps) {
          if (g.date < cutoff) continue;
          fresh.push(g);
          rows.push({
            ticker: g.ticker,
            gap_date: g.date,
            direction: g.direction,
            gap_pct: g.gapPct,
            open_price: g.openPrice,
            target_price: g.targetPrice,
            edge_price: g.edgePrice,
            filled: g.filled,
            fill_date: g.fillDate,
            days_to_fill: g.daysToFill,
            days_open: g.daysOpen,
            market,
            updated_at: new Date().toISOString(),
          });
        }
      }

      if (rows.length > 0) {
        const seen = new Map<string, (typeof rows)[0]>();
        for (const r of rows) seen.set(`${r.ticker}|${r.gap_date}`, r);
        await admin
          .from('price_gaps')
          .upsert(Array.from(seen.values()), {
            onConflict: 'ticker,gap_date',
            ignoreDuplicates: false,
          });
      }
    }

    // Notifico solo i gap della seduta piu' recente fra quelli trovati,
    // e solo se ancora aperti: uno gia' richiuso non e' piu' operativo
    let telegramSent = 0;
    let notified = 0;
    if (fresh.length > 0) {
      const latestDate = fresh.reduce(
        (max, g) => (g.date > max ? g.date : max),
        fresh[0].date
      );
      const today = fresh
        .filter((g) => g.date === latestDate && !g.filled)
        .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

      if (today.length > 0) {
        notified = today.length;
        const up = today.filter((g) => g.direction === 'up');
        const down = today.filter((g) => g.direction === 'down');
        const parts = [
          `📐 <b>Nuovi gap</b> — ${latestDate}`,
          `${today.length} aperture con vuoto oltre il 2%`,
        ];
        if (up.length > 0) {
          parts.push('', `<b>Al rialzo (${up.length})</b>`);
          parts.push(...up.slice(0, 15).map(formatGapLine));
          if (up.length > 15) parts.push(`… e altri ${up.length - 15}`);
        }
        if (down.length > 0) {
          parts.push('', `<b>Al ribasso (${down.length})</b>`);
          parts.push(...down.slice(0, 15).map(formatGapLine));
          if (down.length > 15) parts.push(`… e altri ${down.length - 15}`);
        }
        if (truncated) parts.push('', '<i>Scansione parziale per limiti di tempo.</i>');

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
    }

    return NextResponse.json({
      ok: true,
      gapsSeen: fresh.length,
      notified,
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
