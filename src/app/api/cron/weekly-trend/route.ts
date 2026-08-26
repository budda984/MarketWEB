import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS } from '@/lib/tickers';
import { sendTelegramMessage } from '@/lib/telegram';
import {
  evaluateWeeklyTrend,
  formatWeeklyFlipLine,
  type WeeklyTrendResult,
} from '@/lib/weekly-trend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/weekly-trend
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Pensato per essere schedulato il sabato mattina, a settimana chiusa.
 * Notifica tutti gli utenti che hanno configurato Telegram.
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

    const flips: WeeklyTrendResult[] = [];
    let evaluated = 0;
    let skipped = 0;
    const CHUNK = 40;

    for (let i = 0; i < universe.length; i += CHUNK) {
      if (Date.now() - t0 > 42000) break;
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '5y', '1wk', 8);

      const stateRows: Array<Record<string, unknown>> = [];
      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length === 0) {
          skipped++;
          continue;
        }
        const r = evaluateWeeklyTrend(ticker, candles);
        if (!r) {
          skipped++;
          continue;
        }
        evaluated++;
        stateRows.push({
          ticker: r.ticker,
          state: r.state,
          close: r.close,
          hma_value: r.hmaValue,
          distance_pct: r.distancePct,
          bar_date: r.barDate,
          previous_state: r.prevState,
          flipped_at: r.flipped ? r.barDate : null,
          updated_at: new Date().toISOString(),
        });
        if (r.flipped) flips.push(r);
      }

      if (stateRows.length > 0) {
        await admin
          .from('weekly_trend_state')
          .upsert(stateRows, { onConflict: 'ticker', ignoreDuplicates: false });
      }
    }

    let newFlips = 0;
    let telegramSent = 0;

    if (flips.length > 0) {
      const { data: existing } = await admin
        .from('weekly_trend_flips')
        .select('ticker, bar_date')
        .in(
          'ticker',
          flips.map((f) => f.ticker)
        );
      const known = new Set(
        (existing ?? []).map((e) => `${e.ticker}|${e.bar_date}`)
      );

      await admin.from('weekly_trend_flips').upsert(
        flips.map((r) => ({
          ticker: r.ticker,
          direction: r.direction,
          close: r.close,
          hma_value: r.hmaValue,
          distance_pct: r.distancePct,
          bar_date: r.barDate,
        })),
        { onConflict: 'ticker,bar_date', ignoreDuplicates: true }
      );

      const fresh = flips.filter((f) => !known.has(`${f.ticker}|${f.barDate}`));
      newFlips = fresh.length;

      if (fresh.length > 0) {
        const bull = fresh.filter((f) => f.direction === 'bullish');
        const bear = fresh.filter((f) => f.direction === 'bearish');
        const parts: string[] = [
          '📊 <b>Cambio trend settimanale — HMA50</b>',
          `Settimana chiusa il ${fresh[0].barDate}`,
        ];
        if (bull.length > 0) {
          parts.push(
            '',
            `<b>Passati sopra la media (${bull.length})</b>`,
            ...bull.slice(0, 25).map(formatWeeklyFlipLine)
          );
          if (bull.length > 25) parts.push(`… e altri ${bull.length - 25}`);
        }
        if (bear.length > 0) {
          parts.push(
            '',
            `<b>Passati sotto la media (${bear.length})</b>`,
            ...bear.slice(0, 25).map(formatWeeklyFlipLine)
          );
          if (bear.length > 25) parts.push(`… e altri ${bear.length - 25}`);
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
    }

    return NextResponse.json({
      ok: true,
      universeSize: universe.length,
      evaluated,
      skipped,
      flipsFound: flips.length,
      newFlips,
      telegramSent,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
