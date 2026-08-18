import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany, type OHLCV } from '@/lib/yahoo';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import { sendTelegramMessage } from '@/lib/telegram';
import {
  evaluateRuleForTicker,
  formatAutoAlertLine,
  type AutoAlertRule,
  type RuleEvaluation,
} from '@/lib/auto-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scarica a blocchi con pausa, per non farsi rate-limitare da Yahoo. */
async function downloadChunked(
  tickers: string[],
  period: '1y' | '2y',
  chunkSize = 40,
  concurrency = 6,
  pauseMs = 150
): Promise<Record<string, OHLCV[]>> {
  const out: Record<string, OHLCV[]> = {};
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    Object.assign(out, await yahooDownloadMany(chunk, period, '1d', concurrency));
    if (i + chunkSize < tickers.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return out;
}

/**
 * POST /api/auto-rules/run
 *
 * Valuta le regole attive dell'utente. Chiamabile a mano dalla vista
 * oppure dal cron notturno.
 *
 * Il ciclo di vita di uno scatto:
 *   1. prezzo entra nella fascia  -> scatto 'armed', notifica inviata
 *   2. prezzo resta nella fascia  -> nessuna nuova notifica
 *   3. prezzo risale sopra rearm  -> scatto 'cleared', regola riarmata
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const onlyRuleId: string | undefined = body.ruleId;

  const t0 = Date.now();
  const admin = createAdminClient();

  try {
    let q = supabase
      .from('auto_alert_rules')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true);
    if (onlyRuleId) q = q.eq('id', onlyRuleId);

    const { data: rules, error: rulesErr } = await q;
    if (rulesErr)
      return NextResponse.json({ error: rulesErr.message }, { status: 500 });
    if (!rules || rules.length === 0) {
      return NextResponse.json({
        ok: true,
        stats: { rulesRun: 0, newHits: 0, cleared: 0, elapsedMs: Date.now() - t0 },
        message: 'Nessuna regola attiva.',
      });
    }

    // Impostazioni Telegram dell'utente
    const { data: settings } = await supabase
      .from('user_settings')
      .select('telegram_bot_token, telegram_chat_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let newHits = 0;
    let cleared = 0;
    let evaluated = 0;
    let skipped = 0;
    const allNewLines: string[] = [];
    const ruleResults: Array<{
      ruleId: string;
      market: string;
      inZone: number;
      newHits: number;
    }> = [];

    for (const rule of rules as AutoAlertRule[]) {
      if (Date.now() - t0 > 45000) break; // margine sui 60s di Vercel

      const universe = (MARKETS[rule.market as MarketKey] as readonly string[]) ?? [];
      if (universe.length === 0) continue;

      // 1 anno basta per lookback fino a 252 barre; oltre serve 2 anni
      const period = rule.lookback_days > 200 ? '2y' : '1y';
      const candles = await downloadChunked([...universe], period);

      // Scatti gia' registrati per questa regola
      const { data: existingHits } = await admin
        .from('auto_alert_hits')
        .select('id, ticker, state')
        .eq('rule_id', rule.id);
      const armedByTicker = new Map<string, string>();
      for (const h of existingHits ?? []) {
        if (h.state === 'armed') armedByTicker.set(h.ticker, h.id);
      }

      const fresh: RuleEvaluation[] = [];
      const toClear: string[] = [];
      let inZoneCount = 0;

      for (const ticker of universe) {
        const c = candles[ticker];
        if (!c || c.length === 0) {
          skipped++;
          continue;
        }
        const ev = evaluateRuleForTicker(ticker, c, rule);
        if (!ev) {
          skipped++;
          continue;
        }
        evaluated++;

        const isArmed = armedByTicker.has(ticker);

        if (ev.inZone && !ev.excludedFreefall) {
          inZoneCount++;
          if (!isArmed) fresh.push(ev); // nuovo ingresso nella fascia
        } else if (isArmed && ev.aboveRearm) {
          // risalito: libero la regola per future notifiche
          toClear.push(armedByTicker.get(ticker)!);
        }
      }

      // Registro i nuovi scatti
      if (fresh.length > 0) {
        const payload = fresh.map((e) => ({
          rule_id: rule.id,
          user_id: user.id,
          ticker: e.ticker,
          price: e.price,
          period_low: e.periodLow,
          threshold: e.threshold,
          pct_above_low: e.pctAboveLow,
          drop_from_high_pct: e.dropFromHighPct,
          state: 'armed',
        }));
        const { error } = await admin
          .from('auto_alert_hits')
          .upsert(payload, {
            onConflict: 'rule_id,ticker,state',
            ignoreDuplicates: false,
          });
        if (!error) {
          newHits += fresh.length;
          const label = rule.name || rule.market;
          allNewLines.push(
            `<b>${label}</b> — sotto minimo ${rule.lookback_days}g +${rule.threshold_pct}%`,
            ...fresh
              .sort((a, b) => a.pctAboveLow - b.pctAboveLow)
              .slice(0, 15)
              .map((e) => `• ${formatAutoAlertLine(e)}`)
          );
          if (fresh.length > 15) {
            allNewLines.push(`… e altri ${fresh.length - 15}`);
          }
        }
      }

      // Riarmo i titoli risaliti
      if (toClear.length > 0) {
        const { error } = await admin
          .from('auto_alert_hits')
          .update({ state: 'cleared', cleared_at: new Date().toISOString() })
          .in('id', toClear);
        if (!error) cleared += toClear.length;
      }

      ruleResults.push({
        ruleId: rule.id,
        market: rule.market,
        inZone: inZoneCount,
        newHits: fresh.length,
      });
    }

    // Telegram: un solo messaggio con tutte le novita'
    let telegramSent = false;
    const wantsTelegram = (rules as AutoAlertRule[]).some((r) => r.notify_telegram);
    if (
      allNewLines.length > 0 &&
      wantsTelegram &&
      settings?.telegram_bot_token &&
      settings?.telegram_chat_id
    ) {
      telegramSent = await sendTelegramMessage({
        token: settings.telegram_bot_token,
        chatId: settings.telegram_chat_id,
        text: `🎯 <b>Titoli vicini ai minimi</b>\n\n${allNewLines.join('\n')}`,
      });
    }

    return NextResponse.json({
      ok: true,
      stats: {
        rulesRun: ruleResults.length,
        evaluated,
        skipped,
        newHits,
        cleared,
        telegramSent,
        elapsedMs: Date.now() - t0,
      },
      ruleResults,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Errore valutazione regole: ${
          e instanceof Error ? e.message : 'errore sconosciuto'
        }`,
      },
      { status: 500 }
    );
  }
}
