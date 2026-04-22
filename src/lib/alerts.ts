/**
 * Logica condivisa per la valutazione degli alert di prezzo.
 *
 * Usata sia dal cron (`/api/cron/scan`) che dallo scan manuale
 * (`/api/scan`). Ogni volta che si ha una mappa di prezzi correnti
 * (ticker → prezzo), si possono controllare tutti gli alert attivi,
 * aggiornare il DB e restituire la lista di quelli triggerati per
 * inviare le notifiche.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type TriggeredAlert = {
  userId: string;
  ticker: string;
  threshold: number;
  direction: 'above' | 'below' | 'cross';
  currentPrice: number;
  previousPrice: number | null;
  note: string | null;
};

export type AlertEvaluationResult = {
  checked: number;
  triggered: number;
  byUser: Map<string, TriggeredAlert[]>;
};

/**
 * Valuta tutti gli alert attivi contro i prezzi correnti forniti.
 *
 * @param admin Client Supabase con service-role (serve per scrivere su
 *              alert di tutti gli utenti, bypassando RLS)
 * @param currentPrices Mappa ticker → prezzo corrente
 * @param userIdFilter Se fornito, limita il check agli alert di quel
 *                     singolo utente (usato dallo scan manuale)
 */
export async function evaluateAlerts(
  admin: SupabaseClient,
  currentPrices: Map<string, number>,
  userIdFilter?: string
): Promise<AlertEvaluationResult> {
  const byUser = new Map<string, TriggeredAlert[]>();
  let triggered = 0;

  let query = admin.from('price_alerts').select('*').eq('active', true);
  if (userIdFilter) {
    query = query.eq('user_id', userIdFilter);
  }

  const { data: activeAlerts, error } = await query;
  if (error || !activeAlerts || activeAlerts.length === 0) {
    return { checked: 0, triggered: 0, byUser };
  }

  const alertUpdates: Array<{
    id: string;
    last_price: number;
    triggered_at?: string | null;
    active?: boolean;
  }> = [];

  let checked = 0;
  for (const a of activeAlerts) {
    const price = currentPrices.get(a.ticker);
    if (price == null) continue; // ticker non incluso in questo scan
    checked++;

    const prev = a.last_price != null ? Number(a.last_price) : null;
    const threshold = Number(a.threshold);

    let didTrigger = false;
    if (a.direction === 'above') {
      // scatta se passa da <= threshold a > threshold
      didTrigger = prev != null && prev <= threshold && price > threshold;
      // oppure primo check con prezzo già sopra (nessun prev)
      if (prev == null && price > threshold) didTrigger = true;
    } else if (a.direction === 'below') {
      didTrigger = prev != null && prev >= threshold && price < threshold;
      if (prev == null && price < threshold) didTrigger = true;
    } else {
      // cross: in entrambe le direzioni
      didTrigger =
        prev != null &&
        ((prev <= threshold && price > threshold) ||
          (prev >= threshold && price < threshold));
    }

    const update: (typeof alertUpdates)[0] = {
      id: a.id,
      last_price: price,
    };

    if (didTrigger) {
      update.triggered_at = new Date().toISOString();
      if (a.one_shot) update.active = false;
      triggered++;

      const list = byUser.get(a.user_id) ?? [];
      list.push({
        userId: a.user_id,
        ticker: a.ticker,
        threshold,
        direction: a.direction,
        currentPrice: price,
        previousPrice: prev,
        note: a.note,
      });
      byUser.set(a.user_id, list);
    }

    alertUpdates.push(update);
  }

  // Batch update: aggiorniamo last_price (e triggered_at dove serve) su
  // tutti gli alert controllati, non solo quelli triggerati. Così la
  // prossima esecuzione ha il "previous price" corretto per rilevare
  // cross direzionali.
  for (const u of alertUpdates) {
    await admin.from('price_alerts').update(u).eq('id', u.id);
  }

  return { checked, triggered, byUser };
}
