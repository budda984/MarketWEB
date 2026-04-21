'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Trash2,
  Filter,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { MARKETS, type MarketKey, getMarketForTicker } from '@/lib/tickers';

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

type Props = {
  onOpenTicker: (t: string) => void;
};

export default function AlertsView({ onOpenTicker }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState<MarketKey | 'all' | 'unknown'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'triggered'>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      if (res.ok) setAlerts(data.alerts ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function removeAlert(id: string) {
    if (!confirm('Eliminare questo avviso?')) return;
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

  // Arricchisco ogni alert con il mercato di appartenenza
  const alertsWithMarket = useMemo(() => {
    return alerts.map((a) => ({
      ...a,
      market: getMarketForTicker(a.ticker) ?? 'unknown',
    }));
  }, [alerts]);

  const filtered = useMemo(() => {
    return alertsWithMarket.filter((a) => {
      if (marketFilter !== 'all' && a.market !== marketFilter) return false;
      if (statusFilter === 'active' && !a.active) return false;
      if (statusFilter === 'inactive' && a.active) return false;
      if (statusFilter === 'triggered' && !a.triggered_at) return false;
      return true;
    });
  }, [alertsWithMarket, marketFilter, statusFilter]);

  // Conteggi per mercato (per il dropdown filtro)
  const marketCounts = useMemo(() => {
    const counts: Record<string, number> = { all: alerts.length };
    for (const a of alertsWithMarket) {
      counts[a.market] = (counts[a.market] ?? 0) + 1;
    }
    return counts;
  }, [alertsWithMarket, alerts.length]);

  const activeCount = alerts.filter((a) => a.active).length;
  const triggeredCount = alerts.filter((a) => a.triggered_at).length;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header + stats */}
      <div className="card p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Avvisi di prezzo</span>
            <span className="text-sm text-brand-muted">
              ({alerts.length} totali)
            </span>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="btn-ghost text-xs"
            title="Ricarica"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <StatBadge
            label="Attivi"
            value={activeCount}
            color="text-brand-green"
          />
          <StatBadge
            label="Triggerati"
            value={triggeredCount}
            color="text-yellow-400"
          />
          <StatBadge
            label="Disattivi"
            value={alerts.length - activeCount}
            color="text-brand-muted"
          />
        </div>
      </div>

      {/* Filtri */}
      <div className="card p-3 sm:p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-brand-muted" />
          <label className="text-xs text-brand-muted font-semibold uppercase">
            Mercato:
          </label>
          <select
            value={marketFilter}
            onChange={(e) =>
              setMarketFilter(e.target.value as typeof marketFilter)
            }
            className="input text-xs py-1"
          >
            <option value="all">Tutti ({marketCounts.all ?? 0})</option>
            {(Object.keys(MARKETS) as MarketKey[])
              .filter((m) => (marketCounts[m] ?? 0) > 0)
              .map((m) => (
                <option key={m} value={m}>
                  {m} ({marketCounts[m] ?? 0})
                </option>
              ))}
            {(marketCounts.unknown ?? 0) > 0 && (
              <option value="unknown">
                Altri ({marketCounts.unknown})
              </option>
            )}
          </select>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-brand-muted font-semibold uppercase mr-2">
            Stato:
          </span>
          {(['all', 'active', 'inactive', 'triggered'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                statusFilter === s
                  ? 'bg-brand-green text-black'
                  : 'bg-brand-panel/40 text-brand-muted hover:bg-brand-card'
              }`}
            >
              {{
                all: 'Tutti',
                active: 'Attivi',
                inactive: 'Disattivi',
                triggered: 'Triggerati',
              }[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Lista alert */}
      {loading && alerts.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card p-10 sm:p-16 text-center">
          <div className="text-4xl sm:text-5xl mb-3">🔕</div>
          <div className="text-brand-muted text-sm">
            {alerts.length === 0
              ? 'Nessun avviso creato. Vai al Chart di un titolo per crearne uno.'
              : 'Nessun avviso con questi filtri.'}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="card divide-y divide-brand-border">
          {filtered.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              onDelete={() => removeAlert(a.id)}
              onToggle={(active) => toggleActive(a.id, active)}
              onOpenTicker={onOpenTicker}
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
  onOpenTicker,
}: {
  alert: Alert & { market: string };
  onDelete: () => void;
  onToggle: (active: boolean) => void;
  onOpenTicker: (t: string) => void;
}) {
  const directionLabel = {
    above: '↑ sopra',
    below: '↓ sotto',
    cross: '⇅ cross',
  }[alert.direction];

  return (
    <div
      className={`flex items-center gap-2 sm:gap-3 p-3 sm:p-4 ${
        alert.active ? '' : 'opacity-50'
      }`}
    >
      <label className="cursor-pointer flex-shrink-0">
        <input
          type="checkbox"
          checked={alert.active}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4"
          title="Attiva/disattiva"
        />
      </label>
      <button
        onClick={() => onOpenTicker(alert.ticker)}
        className="flex-1 min-w-0 text-left group"
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-bold text-sm sm:text-base group-hover:text-brand-green transition">
            {alert.ticker}
          </span>
          <span className="tag bg-brand-panel text-brand-muted text-xs">
            {alert.market}
          </span>
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
              ⚡ {new Date(alert.triggered_at).toLocaleDateString('it-IT')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-brand-muted mt-0.5">
          {alert.last_price != null && (
            <span>last ${Number(alert.last_price).toFixed(2)}</span>
          )}
          {alert.note && <span className="truncate">· {alert.note}</span>}
        </div>
      </button>
      <button
        onClick={() => onOpenTicker(alert.ticker)}
        className="p-1.5 text-brand-muted hover:text-brand-green flex-shrink-0"
        title="Apri chart"
      >
        <ExternalLink className="w-4 h-4" />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 text-brand-muted hover:text-brand-down flex-shrink-0"
        title="Elimina"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function StatBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-brand-panel rounded p-2 text-center">
      <div className={`text-lg sm:text-xl font-bold font-mono ${color}`}>
        {value}
      </div>
      <div className="text-xs text-brand-muted">{label}</div>
    </div>
  );
}
