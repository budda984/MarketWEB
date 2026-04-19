'use client';

import { useEffect, useState } from 'react';
import { Send, Check, X, Loader2 } from 'lucide-react';

type Settings = {
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  hma_period: number;
  lookback_bars: number;
  min_strength: number;
};

export default function SettingsView() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setS(d.settings))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      setS(data.settings);
      setMsg({ type: 'ok', text: 'Impostazioni salvate.' });
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const testTelegram = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      setMsg({ type: 'ok', text: 'Messaggio di test inviato a Telegram.' });
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message });
    } finally {
      setTesting(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-brand-muted">Caricamento…</div>;
  }
  if (!s) return null;

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Telegram */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Notifiche Telegram</h3>
          <p className="text-xs text-brand-muted mt-1">
            Quando lo scanner automatico trova segnali (18:00/00:00 UTC), te li
            invia via Telegram.
          </p>
        </div>

        <div className="bg-brand-panel border border-brand-border rounded p-3 text-xs text-brand-muted space-y-1">
          <p>
            <b className="text-brand-text">1.</b> Crea un bot con{' '}
            <code className="bg-brand-bg px-1 rounded">@BotFather</code> su Telegram e copia il token
          </p>
          <p>
            <b className="text-brand-text">2.</b> Scrivi almeno un messaggio al tuo bot
          </p>
          <p>
            <b className="text-brand-text">3.</b> Vai su{' '}
            <code className="bg-brand-bg px-1 rounded">
              api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
            </code>{' '}
            e copia il campo <code className="bg-brand-bg px-1 rounded">chat.id</code>
          </p>
        </div>

        <Field label="Bot Token">
          <input
            type="password"
            value={s.telegram_bot_token ?? ''}
            onChange={(e) =>
              setS({ ...s, telegram_bot_token: e.target.value })
            }
            placeholder="123456789:ABC..."
            className="input w-full font-mono"
          />
        </Field>

        <Field label="Chat ID">
          <input
            type="text"
            value={s.telegram_chat_id ?? ''}
            onChange={(e) => setS({ ...s, telegram_chat_id: e.target.value })}
            placeholder="123456789"
            className="input w-full font-mono"
          />
        </Field>

        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salva
          </button>
          <button
            onClick={testTelegram}
            disabled={testing || !s.telegram_bot_token || !s.telegram_chat_id}
            className="btn-ghost disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test invio
          </button>
        </div>
      </div>

      {/* Preferenze strategia */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold">Parametri strategia</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Periodo HMA">
            <input
              type="number"
              min={5}
              max={200}
              value={s.hma_period}
              onChange={(e) =>
                setS({ ...s, hma_period: Number(e.target.value) })
              }
              className="input w-full"
            />
          </Field>
          <Field label="Lookback (barre)">
            <input
              type="number"
              min={1}
              max={50}
              value={s.lookback_bars}
              onChange={(e) =>
                setS({ ...s, lookback_bars: Number(e.target.value) })
              }
              className="input w-full"
            />
          </Field>
          <Field label="Forza minima notifica">
            <select
              value={s.min_strength}
              onChange={(e) =>
                setS({ ...s, min_strength: Number(e.target.value) })
              }
              className="input w-full"
            >
              <option value={1}>1 — Deboli e sopra</option>
              <option value={2}>2 — Medi e sopra</option>
              <option value={3}>3 — Solo forti</option>
            </select>
          </Field>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salva parametri
        </button>
      </div>

      {msg && (
        <div
          className={`p-3 rounded flex items-center gap-2 text-sm ${
            msg.type === 'ok'
              ? 'bg-brand-up/10 text-brand-up'
              : 'bg-brand-down/10 text-brand-down'
          }`}
        >
          {msg.type === 'ok' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-brand-muted mb-1 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
