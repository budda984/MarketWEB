import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Dashboard from '@/components/Dashboard';
import type { DbSignal } from '@/types/db';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Caricamento bilanciato dei segnali: non vogliamo solo i "primi 200 per data",
  // perché quando migliaia di righe hanno la stessa signal_at la UI mostra solo
  // un tipo (es. solo H&S). Facciamo query separate per categoria e uniamo.
  const [hmaSignals, patternSignals, watchlistsRes] = await Promise.all([
    // HMA: ultimi 150 più recenti
    supabase
      .from('signals')
      .select('*')
      .eq('strategy', 'HMA50_HA')
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(150),
    // Pattern: tutti i breakout (strength 3) + 100 recenti in attesa (strength 2)
    supabase
      .from('signals')
      .select('*')
      .like('strategy', 'PATTERN_%')
      .order('strength', { ascending: false }) // prima strength 3 (breakout)
      .order('signal_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(250),
    supabase.from('watchlists').select('*').order('created_at'),
  ]);

  // Merge + sort finale per data (stabile grazie al tie-breaker su id)
  const allSignals: DbSignal[] = [
    ...(hmaSignals.data ?? []),
    ...(patternSignals.data ?? []),
  ].sort((a, b) => {
    const d = new Date(b.signal_at).getTime() - new Date(a.signal_at).getTime();
    if (d !== 0) return d;
    // Tie-break: strength desc (breakout prima), poi id
    return (b.strength ?? 0) - (a.strength ?? 0);
  });

  return (
    <Dashboard
      userEmail={user.email ?? ''}
      initialSignals={allSignals}
      initialWatchlists={watchlistsRes.data ?? []}
    />
  );
}
