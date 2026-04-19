import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Carica dati iniziali (tutto lato server per primo render veloce)
  const [signalsRes, watchlistsRes] = await Promise.all([
    supabase
      .from('signals')
      .select('*')
      .order('signal_at', { ascending: false })
      .limit(200),
    supabase.from('watchlists').select('*').order('created_at'),
  ]);

  return (
    <Dashboard
      userEmail={user.email ?? ''}
      initialSignals={signalsRes.data ?? []}
      initialWatchlists={watchlistsRes.data ?? []}
    />
  );
}
