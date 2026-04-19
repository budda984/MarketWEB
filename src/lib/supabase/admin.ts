import { createClient } from '@supabase/supabase-js';

/**
 * Client service-role: bypassa RLS.
 * USARE SOLO in Route Handlers server-side, MAI nel browser.
 * Richiede SUPABASE_SERVICE_ROLE_KEY nelle env.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
