import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany, type OHLCV } from '@/lib/yahoo';
import { scanTickers } from '@/lib/signals';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { evaluateAlerts } from '@/lib/alerts';
import {
  evaluateRuleForTicker,
  formatAutoAlertLine,
  type AutoAlertRule,
  type RuleEvaluation,
} from '@/lib/auto-alerts';
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
    haFlipBarsAgo: number | null;
    timestamp: number;
    market: string;
  }> = [];

  // Prezzi correnti per ogni ticker (serve per gli alert)
  const currentPrices = new Map<string, number>();
  // Candele di tutti i mercati scansionati: servono alle regole
  // automatiche, che riusano questi dati senza riscaricare.
  const allCandles = new Map<string, OHLCV[]>();

  const marketsCompleted: string[] = [];
  const marketsSkipped: string[] = [];

  for (const market of marketsToScan) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      marketsSkipped.push(market);
      continue;
    }

    const tickers = MARKETS[market];
    try {
      // 6 mesi di candele: bastano per HMA50 e per le finestre delle regole automatiche
      const candles = await yahooDownloadMany(tickers, '6mo', '1d', 15);
      for (const [tk, arr] of Object.entries(candles)) allCandles.set(tk, arr);
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
          haFlipBarsAgo: s.haFlipBarsAgo,
          timestamp: s.timestamp,
          market,
        });
      }

      for (const [ticker, candlesArr] of Object.entries(candles)) {
        if (candlesArr.length < 60) continue;
        // Salvo il prezzo corrente per la valutazione alert
        currentPrices.set(ticker, candlesArr[candlesArr.length - 1].c);
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
      ha_flip_bars_ago: s.haFlipBarsAgo,
      details: s.details,
      signal_at: new Date(s.timestamp * 1000).toISOString(),
      status: 'ACTIVE',
      entry_price: s.price,
      market: s.market,
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
  // fillMissing: anche i titoli con avvisi fuori dall'universo, o dei
  // mercati saltati per tempo, vengono controllati
  // Il tempo concesso e' quello che resta prima dei 50 secondi, per
  // lasciare margine a regole automatiche e Telegram.
  const alertResult = await evaluateAlerts(admin, currentPrices, undefined, {
    fillMissing: true,
    fillBudgetMs: 50_000 - (Date.now() - t0),
  });
  const alertsByUser = alertResult.byUser;

  // ============================================================
  // Regole automatiche sui minimi di periodo
  // ============================================================
  // Riusa le candele gia' scaricate dal cron: nessun download extra.
  // I titoli non presenti in questo giro vengono semplicemente saltati
  // e valutati alla prossima esecuzione.
  const autoLinesByUser = new Map<string, string[]>();
  let autoNewHits = 0;
  let autoSkippedLookback = 0;

  try {
    const { data: activeRules } = await admin
      .from('auto_alert_rules')
      .select('*')
      .eq('active', true);

    for (const rule of (activeRules ?? []) as AutoAlertRule[]) {
      const universe =
        (MARKETS[rule.market as MarketKey] as readonly string[]) ?? [];
      if (universe.length === 0) continue;

      // Il cron scarica 6 mesi di candele: una finestra piu' lunga non e'
      // calcolabile con questi dati. Quelle regole restano da eseguire a
      // mano dalla vista, che scarica 1-2 anni.
      if (rule.lookback_days > 126) {
        autoSkippedLookback++;
        continue;
      }

      const { data: existing } = await admin
        .from('auto_alert_hits')
        .select('id, ticker, state')
        .eq('rule_id', rule.id)
        .eq('state', 'armed');
      const armed = new Map<string, string>();
      for (const h of existing ?? []) armed.set(h.ticker, h.id);

      const fresh: RuleEvaluation[] = [];
      const toClear: string[] = [];

      for (const ticker of universe) {
        const c = allCandles.get(ticker);
        if (!c || c.length === 0) continue;
        const ev = evaluateRuleForTicker(ticker, c, rule);
        if (!ev) continue;
        const isArmed = armed.has(ticker);
        if (ev.inZone && !ev.excludedFreefall) {
          if (!isArmed) fresh.push(ev);
        } else if (isArmed && ev.aboveRearm) {
          toClear.push(armed.get(ticker)!);
        }
      }

      if (fresh.length > 0) {
        const { error } = await admin.from('auto_alert_hits').upsert(
          fresh.map((e) => ({
            rule_id: rule.id,
            user_id: rule.user_id,
            ticker: e.ticker,
            price: e.price,
            period_low: e.periodLow,
            threshold: e.threshold,
            pct_above_low: e.pctAboveLow,
            drop_from_high_pct: e.dropFromHighPct,
            state: 'armed',
          })),
          { onConflict: 'rule_id,ticker,state', ignoreDuplicates: false }
        );
        if (!error) {
          autoNewHits += fresh.length;
          if (rule.notify_telegram) {
            const lines = autoLinesByUser.get(rule.user_id) ?? [];
            lines.push(
              `<b>${rule.name || rule.market}</b> — minimo ${rule.lookback_days}g +${rule.threshold_pct}%`,
              ...fresh
                .sort((a, b) => a.pctAboveLow - b.pctAboveLow)
                .slice(0, 12)
                .map((e) => `• ${formatAutoAlertLine(e)}`)
            );
            if (fresh.length > 12) lines.push(`… e altri ${fresh.length - 12}`);
            autoLinesByUser.set(rule.user_id, lines);
          }
        }
      }

      if (toClear.length > 0) {
        await admin
          .from('auto_alert_hits')
          .update({ state: 'cleared', cleared_at: new Date().toISOString() })
          .in('id', toClear);
      }
    }
  } catch {
    // Le regole automatiche non devono far fallire l'intero cron
  }

  // Telegram
  let telegramSent = 0;
  const hasTriggeredAlerts = alertsByUser.size > 0;
  const hasAutoHits = autoLinesByUser.size > 0;
  if (allHma.length > 0 || hasTriggeredAlerts || hasAutoHits) {
    const { data: userSettings } = await admin
      .from('user_settings')
      .select('user_id, telegram_bot_token, telegram_chat_id, min_strength')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    if (userSettings && userSettings.length > 0) {
      const tasks = userSettings.map(async (s) => {
        // Mai sotto 1: da quando si salvano anche le componenti isolate,
        // uno zero farebbe finire nelle notifiche roba che segnale non e'
        const minStr = Math.max(1, s.min_strength ?? 1);
        const hma = allHma.filter((x) => x.strength >= minStr);
        const triggeredForUser = alertsByUser.get(s.user_id) ?? [];

        if (
          hma.length === 0 &&
          triggeredForUser.length === 0 &&
          (autoLinesByUser.get(s.user_id) ?? []).length === 0
        ) {
          return false;
        }

        const parts: string[] = [];
        // Priorità: alert in cima (sono i più urgenti)
        const autoLines = autoLinesByUser.get(s.user_id) ?? [];
        if (autoLines.length > 0) {
          parts.push(
            `🎯 <b>Titoli vicini ai minimi</b>\n\n${autoLines.join('\n')}`
          );
        }
        if (triggeredForUser.length > 0) {
          parts.push(formatAlertDigest(triggeredForUser));
        }
        if (hma.length > 0) parts.push(formatSignalsDigest(hma));

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
        signals_found: totalSignals,
        errors,
      })
      .eq('id', run.id);
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - t0,
    scanned: totalScanned,
    hmaSignals: totalSignals,
    autoRuleHits: autoNewHits,
    autoRulesSkippedLookback: autoSkippedLookback,
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
  const lines: string[] = ['🚨 <b>AVVISI DI PREZZO</b>\n'];
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
      `  ${arrow} <code>${a.ticker}</code> ${dirIcon} soglia $${a.threshold.toFixed(2)} → prezzo $${a.currentPrice.toFixed(2)}${noteStr}`
    );
  }
  return lines.join('\n');
}
