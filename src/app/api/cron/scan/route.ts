import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { scanTickers } from '@/lib/signals';
import {
  detectHeadAndShoulders,
  detectFlags,
  type HSPattern,
  type FlagPattern,
} from '@/lib/patterns';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { sendTelegramMessage, formatSignalsDigest } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  let totalHsPatterns = 0;
  let totalFlagPatterns = 0;
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

  const allHsPatterns: Array<{
    ticker: string;
    pattern: HSPattern;
    market: string;
    timestamp: number;
    details: string;
  }> = [];

  const allFlagPatterns: Array<{
    ticker: string;
    pattern: FlagPattern;
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

      for (const [ticker, candlesArr] of Object.entries(candles)) {
        if (candlesArr.length < 60) continue;

        const hsPatterns = detectHeadAndShoulders(candlesArr);
        for (const p of hsPatterns) {
          if (p.strength < 2) continue;
          totalHsPatterns++;
          allHsPatterns.push({
            ticker,
            pattern: p,
            market,
            timestamp: candlesArr[candlesArr.length - 1].t,
            details: hsDetails(p),
          });
        }

        const flags = detectFlags(candlesArr);
        for (const p of flags) {
          if (p.strength < 2) continue;
          totalFlagPatterns++;
          allFlagPatterns.push({
            ticker,
            pattern: p,
            market,
            timestamp: candlesArr[candlesArr.length - 1].t,
            details: flagDetails(p),
          });
        }
      }

      marketsCompleted.push(market);
    } catch {
      errors++;
    }
  }

  // Salva
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
  for (const p of allHsPatterns) {
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
  for (const p of allFlagPatterns) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy:
        p.pattern.type === 'BULL_FLAG' ? 'PATTERN_BULL_FLAG' : 'PATTERN_BEAR_FLAG',
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

  // Telegram
  let telegramSent = 0;
  const totalPatterns = allHsPatterns.length + allFlagPatterns.length;
  if (allHmaSignals.length > 0 || totalPatterns > 0) {
    const { data: userSettings } = await admin
      .from('user_settings')
      .select('user_id, telegram_bot_token, telegram_chat_id, min_strength')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    if (userSettings && userSettings.length > 0) {
      const tasks = userSettings.map(async (s) => {
        const minStr = s.min_strength ?? 1;
        const hmaFiltered = allHmaSignals.filter((x) => x.strength >= minStr);
        const hsFiltered = allHsPatterns.filter(
          (x) => x.pattern.strength >= minStr
        );
        const flagFiltered = allFlagPatterns.filter(
          (x) => x.pattern.strength >= minStr
        );

        if (
          hmaFiltered.length === 0 &&
          hsFiltered.length === 0 &&
          flagFiltered.length === 0
        ) {
          return false;
        }

        const parts: string[] = [];
        if (hmaFiltered.length > 0) {
          parts.push(formatSignalsDigest(hmaFiltered));
        }
        if (hsFiltered.length > 0 || flagFiltered.length > 0) {
          parts.push(formatPatternDigest(hsFiltered, flagFiltered));
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
    hsPatterns: totalHsPatterns,
    flagPatterns: totalFlagPatterns,
    patterns: totalPatterns,
    errors,
    marketsCompleted,
    marketsSkipped,
    telegramSent,
  });
}

function hsDetails(p: HSPattern): string {
  const name = p.type === 'HS' ? 'Testa e Spalle' : 'Inv. Testa e Spalle';
  const dir = p.direction === 'down' ? '↓ ribassista' : '↑ rialzista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${conf} · ${status}`;
}

function flagDetails(p: FlagPattern): string {
  const name = p.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag';
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  const pole = `pole ${p.poleChangePct >= 0 ? '+' : ''}${p.poleChangePct.toFixed(1)}%`;
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${name} · ${dir} · ${pole} · ${conf} · ${status}`;
}

function formatPatternDigest(
  hs: Array<{ ticker: string; pattern: HSPattern }>,
  flags: Array<{ ticker: string; pattern: FlagPattern }>
): string {
  const breakouts = [
    ...hs.filter((p) => p.pattern.strength === 3).map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'HS' ? 'H&S' : 'Inv.H&S',
      icon: p.pattern.type === 'HS' ? '📉' : '📈',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
    })),
    ...flags.filter((p) => p.pattern.strength === 3).map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag',
      icon: p.pattern.type === 'BULL_FLAG' ? '🚩' : '🏳',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
    })),
  ];
  const forming = [
    ...hs.filter((p) => p.pattern.strength === 2).map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'HS' ? 'H&S' : 'Inv.H&S',
      icon: p.pattern.type === 'HS' ? '📉' : '📈',
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
    })),
    ...flags.filter((p) => p.pattern.strength === 2).map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag',
      icon: p.pattern.type === 'BULL_FLAG' ? '🚩' : '🏳',
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
    })),
  ];

  const lines: string[] = ['*🎯 Pattern Radar*\n'];

  if (breakouts.length > 0) {
    lines.push(`🚨 *BREAKOUT* (${breakouts.length})`);
    for (const p of breakouts.slice(0, 15)) {
      lines.push(
        `  ${p.icon} \`${p.ticker}\` ${p.name} @ $${p.price.toFixed(2)} → $${p.target.toFixed(2)}`
      );
    }
    lines.push('');
  }

  if (forming.length > 0) {
    lines.push(`⏳ *In attesa* (${forming.length})`);
    for (const p of forming.slice(0, 10)) {
      lines.push(
        `  ${p.icon} \`${p.ticker}\` ${p.name} lvl $${p.level.toFixed(2)} (${(p.conf * 100).toFixed(0)}%)`
      );
    }
  }

  return lines.join('\n');
}
