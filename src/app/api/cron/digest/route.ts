import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';
import { fetchSocialMentions } from '@/lib/social';
import { FORMATION_LABELS, type FormationKind } from '@/lib/formations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TOP = 5;

/**
 * GET /api/cron/digest
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * Riepilogo giornaliero con il meglio di ogni sezione.
 *
 * Legge quasi tutto dall'archivio invece di ricalcolare: i dati li
 * producono i rispettivi cron, e rifarli qui significherebbe sforare i
 * 60 secondi. La conseguenza e' che una sezione il cui cron non ha
 * girato non compare, invece di mostrare numeri vecchi spacciandoli per
 * aggiornati.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const admin = createAdminClient();
  const sections: string[] = [];
  const included: string[] = [];

  /** Considera fresco solo cio' che e' stato aggiornato di recente. */
  const since = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString();

  try {
    // --- Figure piu' avanzate -----------------------------------------
    const { data: formations } = await admin
      .from('formations')
      .select('*')
      .in('state', ['confirmed', 'right_shoulder'])
      .gte('last_seen', since(3))
      .order('last_seen', { ascending: false })
      .limit(TOP);

    if (formations && formations.length > 0) {
      included.push('figure');
      sections.push(
        `📐 <b>Figure</b>\n` +
          formations
            .map((f) => {
              const label =
                FORMATION_LABELS[f.kind as FormationKind] ?? f.kind;
              const stato =
                f.state === 'confirmed' ? 'collo rotto' : 'struttura completa';
              return `• <b>${f.ticker}</b> ${label} — ${stato}`;
            })
            .join('\n')
      );
    }

    // --- Gap ancora aperti --------------------------------------------
    const { data: gaps } = await admin
      .from('price_gaps')
      .select('*')
      .eq('filled', false)
      .gte('gap_date', since(5).slice(0, 10))
      .order('gap_date', { ascending: false })
      .limit(TOP);

    if (gaps && gaps.length > 0) {
      included.push('gap');
      sections.push(
        `📊 <b>Gap aperti</b>\n` +
          gaps
            .map((g) => {
              const vol =
                g.volume_ratio != null
                  ? ` · vol ${Number(g.volume_ratio).toFixed(1)}×`
                  : '';
              return `• <b>${g.ticker}</b> ${Number(g.gap_pct) >= 0 ? '+' : ''}${Number(g.gap_pct).toFixed(1)}%${vol} — chiude a ${Number(g.target_price).toFixed(2)}`;
            })
            .join('\n')
      );
    }

    // --- Incroci settimanali sulla HMA50 ------------------------------
    const { data: flips } = await admin
      .from('weekly_trend_flips')
      .select('*')
      .gte('bar_date', since(9).slice(0, 10))
      .order('bar_date', { ascending: false })
      .limit(20);

    if (flips && flips.length > 0) {
      included.push('trend settimanale');
      const bull = flips.filter((f) => f.direction === 'bullish').slice(0, TOP);
      const bear = flips.filter((f) => f.direction === 'bearish').slice(0, TOP);
      const parts: string[] = ['📈 <b>Trend settimanale HMA50</b>'];
      if (bull.length > 0) {
        parts.push(`Sopra: ${bull.map((f) => f.ticker).join(', ')}`);
      }
      if (bear.length > 0) {
        parts.push(`Sotto: ${bear.map((f) => f.ticker).join(', ')}`);
      }
      sections.push(parts.join('\n'));
    }

    // --- Radar giornaliero --------------------------------------------
    const { data: lastRun } = await admin
      .from('opportunities')
      .select('run_date')
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastRun?.run_date && lastRun.run_date >= since(2).slice(0, 10)) {
      const { data: opps } = await admin
        .from('opportunities')
        .select('*')
        .eq('run_date', lastRun.run_date)
        .order('total_score', { ascending: false })
        .limit(TOP);
      if (opps && opps.length > 0) {
        included.push('radar');
        sections.push(
          `🎯 <b>Radar</b>\n` +
            opps
              .map(
                (o) =>
                  `• <b>${o.ticker}</b> ${o.total_score} — ${Number(o.price).toFixed(2)}`
              )
              .join('\n')
        );
      }
    }

    // --- Valutazioni a sconto -----------------------------------------
    const { data: cheap } = await admin
      .from('valuations')
      .select('*')
      .eq('verdict_level', 'occasione')
      .order('pe_discount_pct', { ascending: false })
      .limit(TOP);

    if (cheap && cheap.length > 0) {
      included.push('valutazioni');
      sections.push(
        `⚖️ <b>A sconto sulla propria storia</b>\n` +
          cheap
            .map(
              (v) =>
                `• <b>${v.ticker}</b> −${Math.abs(Number(v.pe_discount_pct)).toFixed(0)}% sul multiplo storico`
            )
            .join('\n')
      );
    }

    // --- Acquisti insider multipli ------------------------------------
    const { data: insider } = await admin
      .from('insider_trades')
      .select('ticker, owner_name, value')
      .eq('transaction_code', 'P')
      .eq('is_derivative', false)
      .gte('transaction_date', since(14).slice(0, 10))
      .limit(500);

    if (insider && insider.length > 0) {
      const byTicker = new Map<string, Set<string>>();
      for (const t of insider) {
        if (!t.ticker) continue;
        const set = byTicker.get(t.ticker) ?? new Set<string>();
        set.add(t.owner_name);
        byTicker.set(t.ticker, set);
      }
      const clusters = Array.from(byTicker.entries())
        .filter(([, owners]) => owners.size >= 2)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, TOP);
      if (clusters.length > 0) {
        included.push('insider');
        sections.push(
          `💼 <b>Acquisti insider multipli</b>\n` +
            clusters
              .map(([tk, owners]) => `• <b>${tk}</b> — ${owners.size} insider`)
              .join('\n')
        );
      }
    }

    // --- Menzioni social (unica fonte esterna, una richiesta) ---------
    try {
      const social = await fetchSocialMentions('all-stocks', 1);
      const top = social.mentions
        .filter((m) => m.mentionsChangePct != null)
        .sort((a, b) => (b.mentionsChangePct ?? 0) - (a.mentionsChangePct ?? 0))
        .slice(0, TOP);
      if (top.length > 0) {
        included.push('social');
        sections.push(
          `💬 <b>In crescita sui social</b>\n` +
            top
              .map(
                (m) =>
                  `• <b>${m.ticker}</b> ${m.mentions} menzioni (+${(m.mentionsChangePct ?? 0).toFixed(0)}%)`
              )
              .join('\n')
        );
      }
    } catch {
      // fonte esterna non raggiungibile: il resto del riepilogo resta valido
    }

    if (sections.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        note: 'Nessuna sezione con dati recenti: riepilogo non inviato.',
      });
    }

    const oggi = new Date().toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
    });
    const text =
      `🗞 <b>Riepilogo del ${oggi}</b>\n\n` +
      sections.join('\n\n') +
      `\n\n<i>Spunti da approfondire, non indicazioni operative.</i>`;

    const { data: users } = await admin
      .from('user_settings')
      .select('telegram_bot_token, telegram_chat_id')
      .not('telegram_bot_token', 'is', null)
      .not('telegram_chat_id', 'is', null);

    let sent = 0;
    for (const u of users ?? []) {
      const ok = await sendTelegramMessage({
        token: u.telegram_bot_token!,
        chatId: u.telegram_chat_id!,
        text,
      });
      if (ok) sent++;
    }

    return NextResponse.json({
      ok: true,
      sent,
      sections: included,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'errore sconosciuto' },
      { status: 500 }
    );
  }
}
