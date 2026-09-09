import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import { detectFormations, FORMATION_LABELS, type Formation } from '@/lib/formations';
import { sendTelegramMessage } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/formations
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Tiene aggiornato l'archivio delle figure senza intervento manuale.
 * Le figure che non vengono piu' rilevate restano in archivio con la
 * loro ultima data: si distinguono dalla data di ultimo avvistamento.
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

    // Stati precedenti: servono a riconoscere i cambiamenti. Senza,
    // ogni sera si rinotificherebbe la stessa rottura.
    const { data: previous } = await admin
      .from('formations')
      .select('ticker, kind, state');
    const prevState = new Map<string, string>();
    for (const p of previous ?? []) {
      prevState.set(`${p.ticker}|${p.kind}`, p.state);
    }

    let found = 0;
    let truncated = false;
    const now = new Date().toISOString();
    const CHUNK = 40;

    // Novita' da segnalare
    const breakouts: Formation[] = [];
    const newlyForming: Formation[] = [];

    for (let i = 0; i < universe.length; i += CHUNK) {
      if (Date.now() - t0 > 42000) {
        truncated = true;
        break;
      }
      const chunk = universe.slice(i, i + CHUNK);
      const data = await yahooDownloadMany(chunk, '1y', '1d', 8);

      const rows: Array<Record<string, unknown>> = [];
      for (const ticker of chunk) {
        const candles = data[ticker];
        if (!candles || candles.length < 80) continue;
        for (const f of detectFormations(ticker, candles)) {
          const key = `${f.ticker}|${f.kind}`;
          const before = prevState.get(key);

          // Rottura: e' il momento operativo, quindi va segnalata sia se
          // la figura era gia' nota sia se compare direttamente rotta
          if (f.state === 'confirmed' && before !== 'confirmed') {
            breakouts.push(f);
          } else if (!before && f.state !== 'confirmed') {
            newlyForming.push(f);
          }

          rows.push({
            ticker: f.ticker,
            kind: f.kind,
            state: f.state,
            neckline: f.neckline,
            price: f.price,
            distance_to_neckline_pct: f.distanceToNecklinePct,
            depth_pct: f.depthPct,
            target: f.target,
            bars_span: f.barsSpan,
            points: f.points,
            market: getMarketForTicker(ticker),
            last_seen: now,
            first_state: f.state,
          });
        }
      }

      if (rows.length > 0) {
        const seen = new Map<string, (typeof rows)[0]>();
        for (const r of rows) seen.set(`${r.ticker}|${r.kind}`, r);
        const deduped = Array.from(seen.values());
        const { error } = await admin
          .from('formations')
          .upsert(deduped, {
            onConflict: 'ticker,kind',
            ignoreDuplicates: false,
          });
        if (!error) found += deduped.length;
      }
    }

    // Pulizia: le figure non piu' rilevate da oltre tre settimane sono
    // decadute e affollerebbero l'archivio
    const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
    await admin.from('formations').delete().lt('last_seen', cutoff);

    // ------------------------------------------------------------------
    // Notifica
    // ------------------------------------------------------------------
    let telegramSent = 0;
    if (breakouts.length > 0 || newlyForming.length > 0) {
      const parts: string[] = [];

      if (breakouts.length > 0) {
        parts.push('🚨 <b>Rottura confermata</b>');
        parts.push(
          ...breakouts
            .sort((a, b) => b.depthPct - a.depthPct)
            .slice(0, 12)
            .map((f) => {
              const label = FORMATION_LABELS[f.kind];
              const dir = f.direction === 'bearish' ? '↓' : '↑';
              return (
                `${dir} <b>${f.ticker}</b> ${label}\n` +
                `   ${f.price.toFixed(2)} · livello ${f.neckline.toFixed(2)} · obiettivo ${f.target.toFixed(2)}`
              );
            })
        );
        if (breakouts.length > 12) {
          parts.push(`… e altre ${breakouts.length - 12}`);
        }
      }

      if (newlyForming.length > 0) {
        // In formazione: elenco compatto, non e' ancora il momento di agire
        const byKind = new Map<string, string[]>();
        for (const f of newlyForming) {
          const label = FORMATION_LABELS[f.kind];
          const list = byKind.get(label) ?? [];
          list.push(f.ticker);
          byKind.set(label, list);
        }
        parts.push('', '📐 <b>Nuove figure in formazione</b>');
        for (const [label, tickers] of byKind) {
          parts.push(`${label}: ${tickers.slice(0, 12).join(', ')}`);
        }
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
      universeSize: universe.length,
      found,
      breakouts: breakouts.length,
      newlyForming: newlyForming.length,
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
