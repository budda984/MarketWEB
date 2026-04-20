'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  BellPlus,
  X,
  Check,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type Alert = {
  id: string;
  ticker: string;
  threshold: number;
  direction: 'above' | 'below' | 'cross';
  one_shot: boolean;
  note: string | null;
  active: boolean;
  triggered_at: string | null;
  last_price: number | null;
  created_at: string;
};

export default function AlertsPanel({
  ticker,
  currentPrice,
}: {
  ticker: string;
  currentPrice: number | null;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [direction, setDirection] = useState<'above' | 'below' | 'cross'>(
    'cross'
  );
  const [oneShot, setOneShot] = useState(true);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/alerts?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();
      if (res.ok) setAlerts(data.alerts ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // reset form quando cambia ticker
    setAdding(false);
    setThreshold('');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function createAlert() {
    setErr(null);
    const t = parseFloat(threshold);
    if (!Number.isFinite(t) || t <= 0) {
      setErr('Soglia non valida');
      return;
    }
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          threshold: t,
          direction,
          one_shot: oneShot,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      setAlerts([data.alert, ...alerts]);
      setAdding(false);
      setThreshold('');
      setNote('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function removeAlert(id: string) {
    if (!confirm('Elimina questo avviso?')) return;
    try {
      const res = await fetch('/api/alerts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setAlerts(alerts.filter((a) => a.id !== id));
    } catch {
      //
    }
  }

  async function toggleActive(id: string, active: boolean) {
    try {
      const res = await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
      });
      const data = await res.json();
      if (res.ok) {
        setAlerts(alerts.map((a) => (a.id === id ? data.alert : a)));
      }
    } catch {
      //
    }
  }

  const activeCount = alerts.filter((a) => a.active).length;

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-brand-text hover:text-brand-green transition"
        >
          <Bell className="w-4 h-4" />
          <span>Avvisi di prezzo</span>
          {activeCount > 0 && (
            <span className="tag bg-brand-green/20 text-brand-green">
              {activeCount} attivi
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-brand-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-brand-muted" />
          )}
        </button>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              setExpanded(true);
              if (currentPrice != null) setThreshold(currentPrice.toFixed(2));
            }}
            className="btn-primary py-1 px-2 text-xs"
          >
            <BellPlus className="w-3 h-3" />
            Nuovo
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Form nuovo alert */}
          {adding && (
            <div className="p-3 bg-brand-panel rounded space-y-2 border border-brand-border">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">
                    Direzione
                  </label>
                  <select
                    value={direction}
                    onChange={(e) =>
                      setDirection(e.target.value as 'above' | 'below' | 'cross')
                    }
                    className="input w-full text-sm py-1.5"
                  >
                    <option value="cross">Cross (qualsiasi dir.)</option>
                    <option value="above">Sopra (above)</option>
                    <option value="below">Sotto (below)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-brand-muted mb-1 block">
                    Soglia
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder={
                      currentPrice ? currentPrice.toFixed(2) : 'es. 150.00'
                    }
                    className="input w-full text-sm py-1.5 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">
                  Nota (opzionale)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="es. stop loss, target…"
                  className="input w-full text-sm py-1.5"
                />
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={oneShot}
                  onChange={(e) => setOneShot(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>
                  One-shot (si disattiva automaticamente dopo il primo trigger)
                </span>
              </label>
              {err && (
                <div className="text-xs text-brand-down flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {err}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={createAlert}
                  className="btn-primary flex-1 justify-center text-sm py-1.5"
                >
                  <Check className="w-3 h-3" />
                  Crea avviso
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setErr(null);
                  }}
                  className="btn-ghost text-sm py-1.5 px-3"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Lista alert */}
          {loading && alerts.length === 0 && (
            <p className="text-xs text-brand-muted">Caricamento…</p>
          )}

          {!loading && alerts.length === 0 && !adding && (
            <p className="text-xs text-brand-muted py-2">
              Nessun avviso per {ticker}. Creane uno per ricevere notifiche
              Telegram quando il prezzo attraversa un livello.
            </p>
          )}

          {alerts.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              onDelete={() => removeAlert(a.id)}
              onToggle={(active) => toggleActive(a.id, active)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  onDelete,
  onToggle,
}: {
  alert: Alert;
  onDelete: () => void;
  onToggle: (active: boolean) => void;
}) {
  const directionLabel = {
    above: '↑ sopra',
    below: '↓ sotto',
    cross: '⇅ cross',
  }[alert.direction];

  return (
    <div
      className={`flex items-center gap-2 p-2 rounded border ${
        alert.active
          ? 'border-brand-border bg-brand-panel'
          : 'border-transparent bg-brand-panel/40 opacity-60'
      }`}
    >
      <label className="cursor-pointer flex-shrink-0">
        <input
          type="checkbox"
          checked={alert.active}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4"
        />
      </label>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono font-bold text-sm">
            ${Number(alert.threshold).toFixed(2)}
          </span>
          <span className="text-xs text-brand-muted">{directionLabel}</span>
          {alert.one_shot && (
            <span className="tag bg-brand-panel text-brand-muted text-xs">
              one-shot
            </span>
          )}
          {alert.triggered_at && (
            <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
              ⚡ trigger{' '}
              {new Date(alert.triggered_at).toLocaleDateString('it-IT')}
            </span>
          )}
        </div>
        {alert.note && (
          <div className="text-xs text-brand-muted mt-0.5 truncate">
            {alert.note}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        className="p-1 text-brand-muted hover:text-brand-down transition flex-shrink-0"
        title="Elimina"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
