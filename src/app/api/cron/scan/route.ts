import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { scanTickers } from '@/lib/signals';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { sendTelegramMessage, formatSignalsDigest } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/scan?market=<optional>
 *
 * Protetto da header `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Strategia:
 *  1. Se il parametro ?market=KEY è presente, scansiona solo quel mercato
 *     (utile per chiamate manuali, non usato dal cron di default).
 *  2. Altrimenti scansiona tutti i mercati in sequenza, fino a 55s totali.
 *     Se il tempo scade, registra quanti mercati sono stati completati.
 *  3. Salva segnali pubblici (user_id null).
 *  4. Recupera user_settings con Telegram configurato e invia digest a ognuno.
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
  const TIME_BUDGET_MS = 55_000; // Lascia 5s per salvataggi e Telegram

  // Registra la run
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
  const allSignals: Array<{
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
  const marketsCompleted: string[] = [];
  const marketsSkipped: string[] = [];

  for (const market of marketsToScan) {
    const elapsed = Date.now() - t0;
    if (elapsed > TIME_BUDGET_MS) {
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
        allSignals.push({
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
      marketsCompleted.push(market);
    } catch {
      errors++;
    }
  }

  // Salva segnali come pubblici (user_id null)
  if (allSignals.length > 0) {
    const rows = allSignals.map((s) => ({
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
      status: 'ACTIVE' as const,
      entry_price: s.price,
      market: s.market,
    }));
    const { error } = await admin.from('signals').insert(rows);
    if (error) errors++;
  }

  // Notifiche Telegram per ogni utente configurato
  let telegramSent = 0;
  if (allSignals.length > 0) {
    const { data: userSettings } = await admin
      .from('user_settings')
      .select('user_id, telegram_bot_token, telegram_chat_id, min_strength')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    if (userSettings && userSettings.length > 0) {
      const digestTasks = userSettings.map(async (s) => {
        const filtered = allSignals.filter(
          (x) => x.strength >= (s.min_strength ?? 1)
        );
        if (filtered.length === 0) return false;
        const text = formatSignalsDigest(filtered);
        return sendTelegramMessage({
          token: s.telegram_bot_token!,
          chatId: s.telegram_chat_id!,
          text,
        });
      });
      const results = await Promise.all(digestTasks);
      telegramSent = results.filter(Boolean).length;
    }
  }

  // Aggiorna la run
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
    signals: totalSignals,
    errors,
    marketsCompleted,
    marketsSkipped,
    telegramSent,
  });
}
