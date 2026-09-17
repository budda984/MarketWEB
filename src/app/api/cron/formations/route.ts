import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { yahooDownloadMany } from '@/lib/yahoo';
import { MARKETS, getMarketForTicker } from '@/lib/tickers';
import {
  detectFormations,
  FORMATION_LABELS,
  isMultiTouch,
  levelLabel,
  type Formation,
} from '@/lib/formations';
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
      .select('ticker, kind, state, state_changed_at');
    const prevState = new Map<string, string>();
    const prevChanged = new Map<string, string | null>();
    for (const p of previous ?? []) {
      prevState.set(`${p.ticker}|${p.kind}`, p.state);
      prevChanged.set(`${p.ticker}|${p.kind}`, p.state_changed_at);
    }

    let found = 0;
    let truncated = false;
    const now = new Date().toISOString();
    const CHUNK = 40;

    // Novita' da segnalare
    const breakouts: Formation[] = [];
    const newlyForming: Formation[] = [];
    // Doppi e tripli: il momento da segnalare e' il tocco sul livello,
    // non un cambio di stato successivo
    const onLevel: Formation[] = [];

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

          if (isMultiTouch(f.kind)) {
            // Si segnala la prima volta che la figura compare, in
            // qualunque stato: e' li' che il prezzo e' sul livello.
            // Il passaggio successivo a 'confermata' non e' una notizia,
            // il prezzo nel frattempo si e' gia' mosso.
            if (!before) onLevel.push(f);
          } else if (f.state === 'confirmed' && before !== 'confirmed') {
            // Rottura: e' il momento operativo, quindi va segnalata sia
            // se la figura era gia' nota sia se compare gia' rotta
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
            // La data del cambio si aggiorna solo quando lo stato cambia
            // davvero: altrimenti una figura ferma da settimane
            // risulterebbe sempre la piu' recente
            state_changed_at:
              before && before === f.state
                ? (prevChanged.get(key) ?? now)
                : now,
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
    if (breakouts.length > 0 || newlyForming.length > 0 || onLevel.length > 0) {
      const parts: string[] = [];

      if (onLevel.length > 0) {
        parts.push('🎯 <b>Prezzo sul livello</b>');
        parts.push(
          ...onLevel
            .sort((a, b) => b.depthPct - a.depthPct)
            .slice(0, 12)
            .map((f) => {
              const label = FORMATION_LABELS[f.kind];
              const dir = f.direction === 'bearish' ? '↓' : '↑';
              const dist = Math.abs(f.distanceToNecklinePct);
              return (
                `${dir} <b>${f.ticker}</b> ${label}\n` +
                `   ${f.price.toFixed(2)} · ${levelLabel(f.kind)} ${f.neckline.toFixed(2)}` +
                ` (${dist.toFixed(1)}%) · obiettivo ${f.target.toFixed(2)}`
              );
            })
        );
        if (onLevel.length > 12) parts.push(`… e altre ${onLevel.length - 12}`);
        parts.push('');
      }

      if (breakouts.length > 0) {
        // Il titolo resta generico: per il testa e spalle significa
        // rottura del collo, per i doppi e tripli che il tocco finale sul
        // livello e' formato. Ogni riga poi lo specifica.
        parts.push('🚨 <b>Rottura del collo</b>');
        parts.push(
          ...breakouts
            .sort((a, b) => b.depthPct - a.depthPct)
            .slice(0, 12)
            .map((f) => {
              const label = FORMATION_LABELS[f.kind];
              const dir = f.direction === 'bearish' ? '↓' : '↑';
              return (
                `${dir} <b>${f.ticker}</b> ${label}\n` +
                `   ${f.price.toFixed(2)} · rottura ${f.neckline.toFixed(2)} · obiettivo ${f.target.toFixed(2)}`
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
