import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { scanTickers } from '@/lib/signals';
import { detectHeadAndShoulders, type HSPattern } from '@/lib/patterns';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { sendTelegramMessage, formatSignalsDigest } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/scan
 * Cron schedulato. Scansiona HMA+HA e H&S/IHS su tutti i mercati.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const singleMarket = url.searchParams.get('market') as MarketKey | null;

  const admin = createAdminClient();
  const t0 = Date.now();
  const TIME_BUDGET_MS = 55_000;

  const { data: run } = await admin
    .from('scan_runs')
    .insert({ triggered_by: 'cron' })
    .select('id')
    .single();

  const marketsToScan: MarketKey[] = singleMarket
    ? [singleMarket]
    : (Object.keys(MARKETS) as MarketKey[]);

  let totalScanned = 0;
  let totalSignals = 0;
  let totalPatterns = 0;
  let errors = 0;

  const allHmaSignals: Array<{
    ticker: string;
    strength: number;
    price: number;
    changePct: number;
    details: string;
    hmaValue: number;
    distancePct: number;
    crossedBarsAgo: number | null;
    haBullish: boolean;
    timestamp: number;
    market: string;
  }> = [];

  const allPatterns: Array<{
    ticker: string;
    pattern: HSPattern;
    market: string;
    timestamp: number;
    details: string;
  }> = [];

  const marketsCompleted: string[] = [];
  const marketsSkipped: string[] = [];

  for (const market of marketsToScan) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      marketsSkipped.push(market);
      continue;
    }

    const tickers = MARKETS[market];
    try {
      const candles = await yahooDownloadMany(tickers, '3mo', '1d', 15);
      const found = await scanTickers(candles, 1);
      totalScanned += tickers.length;
      totalSignals += found.length;

      for (const s of found) {
        allHmaSignals.push({
          ticker: s.ticker,
          strength: s.strength,
          price: s.price,
          changePct: s.changePct,
          details: s.details,
          hmaValue: s.hmaValue,
          distancePct: s.distancePct,
          crossedBarsAgo: s.crossedBarsAgo,
          haBullish: s.haBullish,
          timestamp: s.timestamp,
          market,
        });
      }

      // Pattern detection sullo stesso dataset
      for (const [ticker, candlesArr] of Object.entries(candles)) {
        if (candlesArr.length < 60) continue;
        const patterns = detectHeadAndShoulders(candlesArr);
        for (const p of patterns) {
          if (p.strength < 2) continue;
          totalPatterns++;
          allPatterns.push({
            ticker,
            pattern: p,
            market,
            timestamp: candlesArr[candlesArr.length - 1].t,
            details: patternDetails(p),
          });
        }
      }

      marketsCompleted.push(market);
    } catch {
      errors++;
    }
  }

  // Salva tutto come segnali pubblici (user_id null)
  const rows: unknown[] = [];

  for (const s of allHmaSignals) {
    rows.push({
      user_id: null,
      ticker: s.ticker,
      strategy: 'HMA50_HA',
      strength: s.strength,
      price: s.price,
      hma_value: s.hmaValue,
      distance_pct: s.distancePct,
      crossed_bars_ago: s.crossedBarsAgo,
      change_pct: s.changePct,
      ha_bullish: s.haBullish,
      details: s.details,
      signal_at: new Date(s.timestamp * 1000).toISOString(),
      status: 'ACTIVE',
      entry_price: s.price,
      market: s.market,
    });
  }

  for (const p of allPatterns) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy: p.pattern.type === 'HS' ? 'PATTERN_HS' : 'PATTERN_IHS',
      strength: p.pattern.strength,
      price: p.pattern.lastPrice,
      details: p.details,
      signal_at: new Date(p.timestamp * 1000).toISOString(),
      status: 'ACTIVE',
      entry_price: p.pattern.lastPrice,
      market: p.market,
      pattern_data: p.pattern,
    });
  }

  if (rows.length > 0) {
    const { error } = await admin.from('signals').insert(rows);
    if (error) errors++;
  }

  // Telegram per ogni utente configurato
  let telegramSent = 0;
  if (allHmaSignals.length > 0 || allPatterns.length > 0) {
    const { data: userSettings } = await admin
      .from('user_settings')
      .select('user_id, telegram_bot_token, telegram_chat_id, min_strength')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    if (userSettings && userSettings.length > 0) {
      const tasks = userSettings.map(async (s) => {
        const minStr = s.min_strength ?? 1;
        const hmaFiltered = allHmaSignals.filter((x) => x.strength >= minStr);
        const patternFiltered = allPatterns.filter(
          (x) => x.pattern.strength >= minStr
        );
        if (hmaFiltered.length === 0 && patternFiltered.length === 0) {
          return false;
        }

        const parts: string[] = [];
        if (hmaFiltered.length > 0) {
          parts.push(formatSignalsDigest(hmaFiltered));
        }
        if (patternFiltered.length > 0) {
          parts.push(formatPatternDigest(patternFiltered));
        }

        return sendTelegramMessage({
          token: s.telegram_bot_token!,
          chatId: s.telegram_chat_id!,
          text: parts.join('\n\n━━━━━━━━━━\n\n'),
        });
      });
      const results = await Promise.all(tasks);
      telegramSent = results.filter(Boolean).length;
    }
  }

  if (run?.id) {
    await admin
      .from('scan_runs')
      .update({
        finished_at: new Date().toISOString(),
        tickers_scanned: totalScanned,
        signals_found: totalSignals + totalPatterns,
        errors,
      })
      .eq('id', run.id);
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - t0,
    scanned: totalScanned,
    hmaSignals: totalSignals,
    patterns: totalPatterns,
    errors,
    marketsCompleted,
    marketsSkipped,
    telegramSent,
  });
}

function patternDetails(p: HSPattern): string {
  const name = p.type === 'HS' ? 'Testa e Spalle' : 'Inv. Testa e Spalle';
  const dir = p.direction === 'down' ? '↓ ribassista' : '↑ rialzista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${conf} · ${status}`;
}

function formatPatternDigest(
  patterns: Array<{
    ticker: string;
    pattern: HSPattern;
    details: string;
  }>
): string {
  const breakouts = patterns.filter((p) => p.pattern.strength === 3);
  const forming = patterns.filter((p) => p.pattern.strength === 2);

  const lines: string[] = ['*🎯 Pattern Radar*\n'];

  if (breakouts.length > 0) {
    lines.push(`🚨 *BREAKOUT* (${breakouts.length})`);
    for (const p of breakouts.slice(0, 10)) {
      const icon = p.pattern.type === 'HS' ? '📉' : '📈';
      const target = p.pattern.target.toFixed(2);
      lines.push(
        `  ${icon} \`${p.ticker}\` @ $${p.pattern.lastPrice.toFixed(2)} → target $${target}`
      );
    }
    lines.push('');
  }

  if (forming.length > 0) {
    lines.push(`⏳ *In attesa breakout* (${forming.length})`);
    for (const p of forming.slice(0, 8)) {
      const icon = p.pattern.type === 'HS' ? '📉' : '📈';
      const level = p.pattern.breakoutLevel.toFixed(2);
      lines.push(
        `  ${icon} \`${p.ticker}\` neckline $${level} (conf ${(p.pattern.confidence * 100).toFixed(0)}%)`
      );
    }
  }

  return lines.join('\n');
}
