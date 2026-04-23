import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { scanTickers } from '@/lib/signals';
import {
  detectHeadAndShoulders,
  detectFlags,
  detectWedges,
  detectCupHandle,
  detectDoubleTopBottom,
  type HSPattern,
  type FlagPattern,
  type WedgePattern,
  type CupHandlePattern,
  type DoublePattern,
} from '@/lib/patterns';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { evaluateAlerts } from '@/lib/alerts';
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
  let totalHs = 0;
  let totalFlag = 0;
  let totalWedge = 0;
  let totalCup = 0;
  let totalDouble = 0;
  let errors = 0;

  const allHma: Array<{
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

  const allHs: Array<{ ticker: string; pattern: HSPattern; market: string; timestamp: number; details: string }> = [];
  const allFlag: Array<{ ticker: string; pattern: FlagPattern; market: string; timestamp: number; details: string }> = [];
  const allWedge: Array<{ ticker: string; pattern: WedgePattern; market: string; timestamp: number; details: string }> = [];
  const allCup: Array<{ ticker: string; pattern: CupHandlePattern; market: string; timestamp: number; details: string }> = [];
  const allDouble: Array<{ ticker: string; pattern: DoublePattern; market: string; timestamp: number; details: string }> = [];

  // Prezzi correnti per ogni ticker (serve per gli alert)
  const currentPrices = new Map<string, number>();

  const marketsCompleted: string[] = [];
  const marketsSkipped: string[] = [];

  for (const market of marketsToScan) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      marketsSkipped.push(market);
      continue;
    }

    const tickers = MARKETS[market];
    try {
      // 6 mesi di dati per pattern più lunghi (Cup può arrivare a 130 candele + 25 handle)
      const candles = await yahooDownloadMany(tickers, '6mo', '1d', 15);
      const found = await scanTickers(candles, 1);
      totalScanned += tickers.length;
      totalSignals += found.length;

      for (const s of found) {
        allHma.push({
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
        const ts = candlesArr[candlesArr.length - 1].t;
        // Salvo il prezzo corrente per la valutazione alert
        currentPrices.set(ticker, candlesArr[candlesArr.length - 1].c);

        for (const p of detectHeadAndShoulders(candlesArr)) {
          if (p.strength < 2) continue;
          totalHs++;
          allHs.push({ ticker, pattern: p, market, timestamp: ts, details: hsDetails(p) });
        }
        for (const p of detectFlags(candlesArr)) {
          if (p.strength < 2) continue;
          totalFlag++;
          allFlag.push({ ticker, pattern: p, market, timestamp: ts, details: flagDetails(p) });
        }
        for (const p of detectWedges(candlesArr)) {
          if (p.strength < 2) continue;
          totalWedge++;
          allWedge.push({ ticker, pattern: p, market, timestamp: ts, details: wedgeDetails(p) });
        }
        for (const p of detectCupHandle(candlesArr)) {
          if (p.strength < 2) continue;
          totalCup++;
          allCup.push({ ticker, pattern: p, market, timestamp: ts, details: cupDetails(p) });
        }
        for (const p of detectDoubleTopBottom(candlesArr)) {
          if (p.strength < 2) continue;
          totalDouble++;
          allDouble.push({ ticker, pattern: p, market, timestamp: ts, details: doubleDetails(p) });
        }
      }

      marketsCompleted.push(market);
    } catch {
      errors++;
    }
  }

  // Salva
  const rows: unknown[] = [];
  for (const s of allHma) {
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
  for (const p of allHs) {
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
  for (const p of allFlag) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy: p.pattern.type === 'BULL_FLAG' ? 'PATTERN_BULL_FLAG' : 'PATTERN_BEAR_FLAG',
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
  for (const p of allWedge) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy: p.pattern.type === 'RISING_WEDGE' ? 'PATTERN_RISING_WEDGE' : 'PATTERN_FALLING_WEDGE',
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
  for (const p of allCup) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy: 'PATTERN_CUP_HANDLE',
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
  for (const p of allDouble) {
    rows.push({
      user_id: null,
      ticker: p.ticker,
      strategy: `PATTERN_${p.pattern.type}`,
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
    // Dedup del batch: Postgres rifiuta se lo stesso UPSERT tocca due
    // volte la stessa chiave (user_id, ticker, strategy). Può succedere
    // se un detector trova più pattern dello stesso tipo sullo stesso
    // ticker. Tengo il più forte a parità di strength il più recente.
    type SignalRow = {
      user_id: string | null;
      ticker: string;
      strategy: string;
      strength: number;
      signal_at: string;
      [key: string]: unknown;
    };
    const typedRows = rows as SignalRow[];
    const byKey = new Map<string, SignalRow>();
    for (const row of typedRows) {
      const key = `${row.user_id ?? 'PUBLIC'}|${row.ticker}|${row.strategy}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      const better =
        row.strength > existing.strength ||
        (row.strength === existing.strength &&
          row.signal_at > existing.signal_at);
      if (better) byKey.set(key, row);
    }
    const deduped = Array.from(byKey.values());

    // UPSERT: se (user_id, ticker, strategy) esiste già, aggiorna invece di
    // creare un nuovo record. Così evitiamo duplicati quando il cron gira
    // più volte nello stesso giorno.
    const { error } = await admin
      .from('signals')
      .upsert(deduped, {
        onConflict: 'user_id,ticker,strategy',
        ignoreDuplicates: false,
      });
    if (error) errors++;
  }

  // ============================================================
  // Valutazione alert di prezzo (logica condivisa con lo scan manuale)
  // ============================================================
  const alertResult = await evaluateAlerts(admin, currentPrices);
  const alertsByUser = alertResult.byUser;

  // Telegram
  let telegramSent = 0;
  const totalPatterns = allHs.length + allFlag.length + allWedge.length + allCup.length + allDouble.length;
  const hasTriggeredAlerts = alertsByUser.size > 0;
  if (allHma.length > 0 || totalPatterns > 0 || hasTriggeredAlerts) {
    const { data: userSettings } = await admin
      .from('user_settings')
      .select('user_id, telegram_bot_token, telegram_chat_id, min_strength')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    if (userSettings && userSettings.length > 0) {
      const tasks = userSettings.map(async (s) => {
        const minStr = s.min_strength ?? 1;
        const hma = allHma.filter((x) => x.strength >= minStr);
        const hs = allHs.filter((x) => x.pattern.strength >= minStr);
        const fl = allFlag.filter((x) => x.pattern.strength >= minStr);
        const we = allWedge.filter((x) => x.pattern.strength >= minStr);
        const cu = allCup.filter((x) => x.pattern.strength >= minStr);
        const db = allDouble.filter((x) => x.pattern.strength >= minStr);
        const triggeredForUser = alertsByUser.get(s.user_id) ?? [];

        if (
          hma.length === 0 &&
          hs.length === 0 &&
          fl.length === 0 &&
          we.length === 0 &&
          cu.length === 0 &&
          db.length === 0 &&
          triggeredForUser.length === 0
        ) {
          return false;
        }

        const parts: string[] = [];
        // Priorità: alert in cima (sono i più urgenti)
        if (triggeredForUser.length > 0) {
          parts.push(formatAlertDigest(triggeredForUser));
        }
        if (hma.length > 0) parts.push(formatSignalsDigest(hma));
        if (
          hs.length > 0 ||
          fl.length > 0 ||
          we.length > 0 ||
          cu.length > 0 ||
          db.length > 0
        ) {
          parts.push(formatPatternDigest(hs, fl, we, cu, db));
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
    hsPatterns: totalHs,
    flagPatterns: totalFlag,
    wedgePatterns: totalWedge,
    cupPatterns: totalCup,
    doublePatterns: totalDouble,
    patterns: totalPatterns,
    alertsTriggered: Array.from(alertsByUser.values()).reduce(
      (s, arr) => s + arr.length,
      0
    ),
    errors,
    marketsCompleted,
    marketsSkipped,
    telegramSent,
  });
}

function hsDetails(p: HSPattern): string {
  const name = p.type === 'HS' ? 'Testa e Spalle' : 'Inv. Testa e Spalle';
  const dir = p.direction === 'down' ? '↓ ribassista' : '↑ rialzista';
  return `${name} · ${dir} · conf ${(p.confidence * 100).toFixed(0)}% · ${
    p.breakoutConfirmed ? `breakout ${p.breakoutBarsAgo}d fa` : 'in attesa breakout'
  }`;
}
function flagDetails(p: FlagPattern): string {
  const name = p.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag';
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  return `${name} · ${dir} · pole ${p.poleChangePct >= 0 ? '+' : ''}${p.poleChangePct.toFixed(1)}% · conf ${(p.confidence * 100).toFixed(0)}% · ${
    p.breakoutConfirmed ? `breakout ${p.breakoutBarsAgo}d fa` : 'in attesa breakout'
  }`;
}
function wedgeDetails(p: WedgePattern): string {
  const name = p.type === 'RISING_WEDGE' ? 'Rising Wedge' : 'Falling Wedge';
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  return `${name} · ${dir} · conf ${(p.confidence * 100).toFixed(0)}% · ${
    p.breakoutConfirmed ? `breakout ${p.breakoutBarsAgo}d fa` : 'in attesa breakout'
  }`;
}
function cupDetails(p: CupHandlePattern): string {
  return `Cup & Handle · ↑ rialzista · cup ${p.cupDepthPct.toFixed(1)}% · handle ${p.handleDepthPct.toFixed(1)}% · conf ${(p.confidence * 100).toFixed(0)}% · ${
    p.breakoutConfirmed ? `breakout ${p.breakoutBarsAgo}d fa` : 'in attesa breakout'
  }`;
}

function doubleDetails(p: DoublePattern): string {
  const label = {
    DOUBLE_TOP: 'Double Top',
    DOUBLE_BOTTOM: 'Double Bottom',
    TRIPLE_TOP: 'Triple Top',
    TRIPLE_BOTTOM: 'Triple Bottom',
  }[p.type];
  const dir = p.direction === 'up' ? '↑ rialzista' : '↓ ribassista';
  const conf = `conf ${(p.confidence * 100).toFixed(0)}%`;
  const status =
    p.breakoutConfirmed && p.breakoutBarsAgo != null
      ? `breakout ${p.breakoutBarsAgo}d fa`
      : 'in attesa breakout';
  return `${label} · ${dir} · neck $${p.neckline.toFixed(2)} · ${conf} · ${status}`;
}

type PatternLine = {
  ticker: string;
  icon: string;
  name: string;
  price: number;
  target?: number;
  level: number;
  conf: number;
  strength: number;
};

function formatPatternDigest(
  hs: Array<{ ticker: string; pattern: HSPattern }>,
  flags: Array<{ ticker: string; pattern: FlagPattern }>,
  wedges: Array<{ ticker: string; pattern: WedgePattern }>,
  cups: Array<{ ticker: string; pattern: CupHandlePattern }>,
  doubles: Array<{ ticker: string; pattern: DoublePattern }> = []
): string {
  const all: PatternLine[] = [
    ...hs.map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'HS' ? 'H&S' : 'Inv.H&S',
      icon: p.pattern.type === 'HS' ? '📉' : '📈',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
      strength: p.pattern.strength,
    })),
    ...flags.map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'BULL_FLAG' ? 'Bull Flag' : 'Bear Flag',
      icon: p.pattern.type === 'BULL_FLAG' ? '🚩' : '🏳',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
      strength: p.pattern.strength,
    })),
    ...wedges.map((p) => ({
      ticker: p.ticker,
      name: p.pattern.type === 'RISING_WEDGE' ? 'Rising Wedge' : 'Falling Wedge',
      icon: p.pattern.type === 'RISING_WEDGE' ? '🔻' : '🔺',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
      strength: p.pattern.strength,
    })),
    ...cups.map((p) => ({
      ticker: p.ticker,
      name: 'Cup&Handle',
      icon: '☕',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.breakoutLevel,
      conf: p.pattern.confidence,
      strength: p.pattern.strength,
    })),
    ...doubles.map((p) => ({
      ticker: p.ticker,
      name: {
        DOUBLE_TOP: 'Double Top',
        DOUBLE_BOTTOM: 'Double Bottom',
        TRIPLE_TOP: 'Triple Top',
        TRIPLE_BOTTOM: 'Triple Bottom',
      }[p.pattern.type],
      icon: p.pattern.direction === 'up' ? '⬆️' : '⬇️',
      price: p.pattern.lastPrice,
      target: p.pattern.target,
      level: p.pattern.neckline,
      conf: p.pattern.confidence,
      strength: p.pattern.strength,
    })),
  ];

  const breakouts = all.filter((p) => p.strength === 3);
  const forming = all.filter((p) => p.strength === 2);

  const lines: string[] = ['*🎯 Pattern Radar*\n'];

  if (breakouts.length > 0) {
    lines.push(`🚨 *BREAKOUT* (${breakouts.length})`);
    for (const p of breakouts.slice(0, 20)) {
      const tgt = p.target != null ? ` → $${p.target.toFixed(2)}` : '';
      lines.push(`  ${p.icon} \`${p.ticker}\` ${p.name} @ $${p.price.toFixed(2)}${tgt}`);
    }
    lines.push('');
  }

  if (forming.length > 0) {
    lines.push(`⏳ *In attesa* (${forming.length})`);
    for (const p of forming.slice(0, 15)) {
      lines.push(
        `  ${p.icon} \`${p.ticker}\` ${p.name} lvl $${p.level.toFixed(2)} (${(p.conf * 100).toFixed(0)}%)`
      );
    }
  }

  return lines.join('\n');
}

function formatAlertDigest(
  triggered: Array<{
    ticker: string;
    threshold: number;
    direction: 'above' | 'below' | 'cross';
    currentPrice: number;
    previousPrice: number | null;
    note: string | null;
  }>
): string {
  const lines: string[] = ['🚨 *AVVISI DI PREZZO*\n'];
  for (const a of triggered) {
    const arrow =
      a.previousPrice != null && a.currentPrice > a.previousPrice
        ? '↗'
        : a.previousPrice != null && a.currentPrice < a.previousPrice
          ? '↘'
          : '•';
    const dirIcon =
      a.direction === 'above' ? '↑' : a.direction === 'below' ? '↓' : '⇅';
    const noteStr = a.note ? ` _(${a.note})_` : '';
    lines.push(
      `  ${arrow} \`${a.ticker}\` ${dirIcon} soglia $${a.threshold.toFixed(2)} → prezzo $${a.currentPrice.toFixed(2)}${noteStr}`
    );
  }
  return lines.join('\n');
}
