'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart as LCIcon, Lock, Loader2, Check } from 'lucide-react';

/**
 * Pagina di reset password.
 * Arriva qui dopo aver cliccato il link di recupero nella mail.
 * Supabase mette l'access token nel hash dell'URL; il client lo legge
 * automaticamente e l'utente è temporaneamente "loggato" per poter
 * chiamare updateUser({ password }).
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    // Verifica che ci sia una sessione valida (token dal link email)
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session);
    });
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La password deve avere almeno 8 caratteri.');
      return;
    }
    if (password !== confirm) {
      setError('Le password non coincidono.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-brand-green flex items-center justify-center">
            <LCIcon className="w-5 h-5 text-black" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Nuova password</h1>
            <p className="text-xs text-brand-muted">Market Monitor Pro</p>
          </div>
        </div>

        {!ready && (
          <div className="text-center py-8 text-brand-muted text-sm">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            Verifica link in corso…
          </div>
        )}

        {ready && done && (
          <div className="text-center py-6">
            <Check className="w-10 h-10 mx-auto text-brand-green mb-3" />
            <p className="text-sm">
              Password aggiornata! Ti reindirizzo…
            </p>
          </div>
        )}

        {ready && !done && (
          <form onSubmit={submit} className="space-y-4">
            <FieldWithIcon label="Nuova password" icon={<Lock className="w-4 h-4" />}>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Almeno 8 caratteri"
                className="input w-full pl-9"
                autoComplete="new-password"
              />
            </FieldWithIcon>

            <FieldWithIcon label="Conferma password" icon={<Lock className="w-4 h-4" />}>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Ripeti la password"
                className="input w-full pl-9"
                autoComplete="new-password"
              />
            </FieldWithIcon>

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
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Salvataggio…' : 'Aggiorna password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function FieldWithIcon({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-brand-muted mb-1">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted">
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}
