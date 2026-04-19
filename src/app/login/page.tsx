'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LineChart as LCIcon, Mail, Lock, Loader2, Check } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'forgot';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const supabase = createClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // Full reload così il middleware server rilegge il cookie
        window.location.href = '/dashboard';
        return;
      }

      if (mode === 'signup') {
        if (password.length < 8) {
          throw new Error('La password deve avere almeno 8 caratteri.');
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;

        if (data.user && !data.session) {
          // Email confirmation attiva: deve cliccare il link
          setInfo(
            'Account creato! Controlla la tua email e clicca il link di conferma per completare la registrazione.'
          );
        } else {
          // Email confirmation disattiva: sei già dentro
          window.location.href = '/dashboard';
          return;
        }
      }

      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (error) throw error;
        setInfo(
          'Se l\'email esiste, riceverai un link per impostare una nuova password.'
        );
      }
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
            <h1 className="text-xl font-bold">Market Monitor Pro</h1>
            <p className="text-xs text-brand-muted">HMA 50 + Heikin Ashi scanner</p>
          </div>
        </div>

        {/* Tab switcher */}
        {mode !== 'forgot' && (
          <div className="flex gap-1 p-1 bg-brand-panel rounded-md mb-6">
            <TabBtn
              active={mode === 'signin'}
              onClick={() => {
                setMode('signin');
                setError(null);
                setInfo(null);
              }}
              label="Accedi"
            />
            <TabBtn
              active={mode === 'signup'}
              onClick={() => {
                setMode('signup');
                setError(null);
                setInfo(null);
              }}
              label="Registrati"
            />
          </div>
        )}

        {mode === 'forgot' && (
          <div className="mb-6">
            <h2 className="font-semibold text-sm">Recupera password</h2>
            <p className="text-xs text-brand-muted mt-1">
              Inserisci la tua email e ti manderemo un link per impostarne una nuova.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" icon={<Mail className="w-4 h-4" />}>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@esempio.com"
              className="input w-full pl-9"
            />
          </Field>

          {mode !== 'forgot' && (
            <Field label="Password" icon={<Lock className="w-4 h-4" />}>
              <input
                type="password"
                required
                autoComplete={
                  mode === 'signin' ? 'current-password' : 'new-password'
                }
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Almeno 8 caratteri' : '••••••••'}
                className="input w-full pl-9"
              />
            </Field>
          )}

          {error && (
            <p className="text-sm text-brand-down bg-brand-down/10 p-2 rounded">
              {error}
            </p>
          )}
          {info && (
            <p className="text-sm text-brand-green bg-brand-green/10 p-2 rounded flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {!loading && mode === 'signin' && 'Accedi'}
            {!loading && mode === 'signup' && 'Crea account'}
            {!loading && mode === 'forgot' && 'Invia email di recupero'}
          </button>

          <div className="flex items-center justify-between text-xs pt-2">
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setInfo(null);
                }}
                className="text-brand-muted hover:text-brand-green transition"
              >
                Password dimenticata?
              </button>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setInfo(null);
                }}
                className="text-brand-muted hover:text-brand-green transition ml-auto"
              >
                ← Torna ad accedere
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

function TabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 rounded text-sm font-medium transition ${
        active
          ? 'bg-brand-green text-black'
          : 'text-brand-muted hover:text-brand-text'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
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
