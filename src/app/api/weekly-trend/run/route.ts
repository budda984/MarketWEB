import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

/** Universo: titoli USA (S&P 500 + NASDAQ), senza duplicati. */
function usUniverse(): string[] {
  return Array.from(
    new Set([
      ...((MARKETS['S&P 500'] as readonly string[]) ?? []),
      ...((MARKETS['NASDAQ'] as readonly string[]) ?? []),
    ])
  );
}

/**
 * POST /api/weekly-trend/run
 * body: { offset?: number, notify?: boolean }
 *
 * Valuta lo stato settimanale sulla HMA50 e registra i cambi di stato.
 *
 * Con ~400 titoli non si sta dentro i 60s di Vercel in una sola volta:
 * la route elabora finche' ha tempo e restituisce nextOffset, cosi' il
 * chiamante puo' riprendere da dove si era fermata.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const offset = Math.max(0, Number(body.offset ?? 0));
  const notify = body.notify !== false;

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    const universe = usUniverse();
    const CHUNK = 40;
    const flips: WeeklyTrendResult[] = [];
    let evaluated = 0;
    let skipped = 0;
    let i = offset;

    while (i < universe.length) {
      if (Date.now() - t0 > 42000) break; // margine sui 60s

      const chunk = universe.slice(i, i + CHUNK);
      // 5 anni di settimanali: ~260 barre, ampiamente sufficienti per
      // una HMA50 stabile
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

      i += CHUNK;
    }

    // Registro i cambi di stato. Il vincolo su (ticker, bar_date) evita
    // che rieseguire la scansione nella stessa settimana generi doppioni.
    let newFlips = 0;
    if (flips.length > 0) {
      const payload = flips.map((r) => ({
        ticker: r.ticker,
        direction: r.direction,
        close: r.close,
        hma_value: r.hmaValue,
        distance_pct: r.distancePct,
        bar_date: r.barDate,
      }));

      // Quali erano gia' registrati: solo i nuovi vanno notificati
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

      const { error } = await admin
        .from('weekly_trend_flips')
        .upsert(payload, {
          onConflict: 'ticker,bar_date',
          ignoreDuplicates: true,
        });

      if (!error) {
        const fresh = flips.filter(
          (f) => !known.has(`${f.ticker}|${f.barDate}`)
        );
        newFlips = fresh.length;

        if (notify && fresh.length > 0) {
          const { data: settings } = await supabase
            .from('user_settings')
            .select('telegram_bot_token, telegram_chat_id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (settings?.telegram_bot_token && settings?.telegram_chat_id) {
            const bull = fresh.filter((f) => f.direction === 'bullish');
            const bear = fresh.filter((f) => f.direction === 'bearish');
            const parts: string[] = [
              `📊 <b>Cambio trend settimanale — HMA50</b>`,
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
            await sendTelegramMessage({
              token: settings.telegram_bot_token,
              chatId: settings.telegram_chat_id,
              text: parts.join('\n'),
            });
          }
        }
      }
    }

    const done = i >= universe.length;
    return NextResponse.json({
      ok: true,
      done,
      nextOffset: done ? null : i,
      stats: {
        universeSize: universe.length,
        processedUpTo: Math.min(i, universe.length),
        evaluated,
        skipped,
        flipsFound: flips.length,
        newFlips,
        elapsedMs: Date.now() - t0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore trend settimanale: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
