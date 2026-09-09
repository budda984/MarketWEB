import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/formations/recent — figure in archivio, dalle piu' recenti. */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('formations')
    .select('*')
    .order('last_seen', { ascending: false })
    .limit(200);

  if (error) {
    const missing = /schema cache|does not exist/i.test(error.message);
    return NextResponse.json(
      {
        error: missing
          ? "La tabella 'formations' non esiste ancora: esegui la migration 013_formations.sql."
          : error.message,
      },
      { status: 500 }
    );
  }

  const rows = data ?? [];
  return NextResponse.json({
    formations: rows,
    lastScan: rows.length > 0 ? rows[0].last_seen : null,
  });
}
