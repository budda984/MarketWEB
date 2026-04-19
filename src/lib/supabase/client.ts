import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client per componenti client-side ("use client").
 * Singleton per evitare ri-creazioni su ogni render.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
