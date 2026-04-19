'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart as LCIcon, Mail } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-brand-green flex items-center justify-center">
            <LCIcon className="w-5 h-5 text-black" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Market Monitor Pro</h1>
            <p className="text-xs text-brand-muted">HMA 50 + Heikin Ashi scanner</p>
          </div>
        </div>

        {sent ? (
          <div className="text-center py-8">
            <Mail className="w-12 h-12 mx-auto text-brand-green mb-4" />
            <h2 className="font-semibold mb-2">Controlla la tua email</h2>
            <p className="text-sm text-brand-muted">
              Ti abbiamo inviato un link magico a <b>{email}</b>. Cliccalo per
              accedere.
            </p>
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@esempio.com"
                className="input w-full"
              />
            </div>
            {error && (
              <p className="text-sm text-brand-down bg-brand-down/10 p-2 rounded">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-50"
            >
              {loading ? 'Invio…' : 'Invia magic link'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
