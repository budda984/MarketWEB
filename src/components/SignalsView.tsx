'use client';

import { useMemo, useState } from 'react';
import { Flame, AlertTriangle, Pin, ArrowUpRight, Filter } from 'lucide-react';
import type { DbSignal } from '@/types/db';

type Props = {
  signals: DbSignal[];
  onOpenTicker: (ticker: string) => void;
};

type StrengthFilter = 'all' | '3' | '2' | '1';
type StatusFilter = 'all' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'TIME_STOP' | 'CLOSED';

export default function SignalsView({ signals, onOpenTicker }: Props) {
  const [strength, setStrength] = useState<StrengthFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      if (strength !== 'all' && s.strength !== Number(strength)) return false;
      if (status !== 'all' && s.status !== status) return false;
      if (query && !s.ticker.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
  }, [signals, strength, status, query]);

  const groups = useMemo(() => {
    return {
      forti: filtered.filter((s) => s.strength === 3),
      medi: filtered.filter((s) => s.strength === 2),
      deboli: filtered.filter((s) => s.strength === 1),
    };
  }, [filtered]);

  return (
    <div className="p-6 space-y-6">
      {/* Filtri */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-brand-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtra per ticker…"
          className="input w-48"
        />
        <div className="flex items-center gap-1">
          <FilterBtn
            active={strength === 'all'}
            onClick={() => setStrength('all')}
            label="Tutte"
          />
          <FilterBtn
            active={strength === '3'}
            onClick={() => setStrength('3')}
            label="🔥 Forti"
          />
          <FilterBtn
            active={strength === '2'}
            onClick={() => setStrength('2')}
            label="⚠️ Medi"
          />
          <FilterBtn
            active={strength === '1'}
            onClick={() => setStrength('1')}
            label="📌 Deboli"
          />
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <FilterBtn
            active={status === 'all'}
            onClick={() => setStatus('all')}
            label="Tutti stati"
          />
          <FilterBtn
            active={status === 'ACTIVE'}
            onClick={() => setStatus('ACTIVE')}
            label="Attivi"
          />
          <FilterBtn
            active={status === 'TP_HIT'}
            onClick={() => setStatus('TP_HIT')}
            label="TP"
          />
          <FilterBtn
            active={status === 'SL_HIT'}
            onClick={() => setStatus('SL_HIT')}
            label="SL"
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card p-16 text-center">
          <div className="text-5xl mb-3">😴</div>
          <div className="text-brand-muted">Nessun segnale con questi filtri.</div>
          <div className="text-sm text-brand-muted mt-1">
            Prova a lanciare una scansione dalla sidebar.
          </div>
        </div>
      )}

      {groups.forti.length > 0 && (
        <Section
          title="Segnali Forti"
          icon={<Flame className="w-4 h-4 text-brand-up" />}
          color="text-brand-up"
          items={groups.forti}
          onOpenTicker={onOpenTicker}
        />
      )}
      {groups.medi.length > 0 && (
        <Section
          title="Segnali Medi"
          icon={<AlertTriangle className="w-4 h-4 text-yellow-400" />}
          color="text-yellow-400"
          items={groups.medi}
          onOpenTicker={onOpenTicker}
        />
      )}
      {groups.deboli.length > 0 && (
        <Section
          title="Segnali Deboli"
          icon={<Pin className="w-4 h-4 text-brand-muted" />}
          color="text-brand-muted"
          items={groups.deboli}
          onOpenTicker={onOpenTicker}
        />
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  color,
  items,
  onOpenTicker,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  items: DbSignal[];
  onOpenTicker: (t: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-brand-border flex items-center justify-between">
        <div className={`flex items-center gap-2 font-semibold text-sm ${color}`}>
          {icon}
          {title}
        </div>
        <span className="text-xs font-mono text-brand-muted">{items.length}</span>
      </div>
      <div className="divide-y divide-brand-border">
        {items.map((s) => (
          <SignalRow key={s.id} signal={s} onOpen={() => onOpenTicker(s.ticker)} />
        ))}
      </div>
    </div>
  );
}

function SignalRow({ signal, onOpen }: { signal: DbSignal; onOpen: () => void }) {
  const up = (signal.change_pct ?? 0) >= 0;
  const d = new Date(signal.signal_at);
  const dateLabel = d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const strengthEmoji = signal.strength === 3 ? '🔥' : signal.strength === 2 ? '⚠️' : '📌';

  return (
    <button
      onClick={onOpen}
      className="w-full px-5 py-3 flex items-center gap-4 hover:bg-brand-card/50 transition text-left group"
    >
      <div className="text-2xl w-8">{strengthEmoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-base">{signal.ticker}</span>
          <span className="tag bg-brand-panel text-brand-muted">
            {signal.strategy}
          </span>
          {signal.status !== 'ACTIVE' && (
            <StatusTag status={signal.status} />
          )}
        </div>
        <div className="text-xs text-brand-muted mt-0.5">
          {signal.details} · {dateLabel}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-bold">
          {signal.price.toFixed(2)}
        </div>
        <div
          className={`text-xs font-mono ${
            up ? 'text-brand-up' : 'text-brand-down'
          }`}
        >
          {up ? '+' : ''}
          {(signal.change_pct ?? 0).toFixed(2)}%
        </div>
      </div>
      {signal.pnl_percent != null && (
        <div className="text-right w-20">
          <div className="text-xs text-brand-muted">P&L</div>
          <div
            className={`font-mono font-bold ${
              signal.pnl_percent >= 0 ? 'text-brand-up' : 'text-brand-down'
            }`}
          >
            {signal.pnl_percent >= 0 ? '+' : ''}
            {signal.pnl_percent.toFixed(1)}%
          </div>
        </div>
      )}
      <ArrowUpRight className="w-4 h-4 text-brand-muted group-hover:text-brand-green transition" />
    </button>
  );
}

function StatusTag({ status }: { status: DbSignal['status'] }) {
  const map: Record<DbSignal['status'], { label: string; cls: string }> = {
    ACTIVE: { label: 'Attivo', cls: 'bg-brand-green/20 text-brand-green' },
    TP_HIT: { label: 'TP', cls: 'bg-brand-up/20 text-brand-up' },
    SL_HIT: { label: 'SL', cls: 'bg-brand-down/20 text-brand-down' },
    TIME_STOP: { label: 'Time', cls: 'bg-yellow-400/20 text-yellow-400' },
    CLOSED: { label: 'Chiuso', cls: 'bg-brand-panel text-brand-muted' },
  };
  const cfg = map[status];
  return <span className={`tag ${cfg.cls}`}>{cfg.label}</span>;
}

function FilterBtn({
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
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
        active
          ? 'bg-brand-green text-black'
          : 'text-brand-muted hover:bg-brand-card'
      }`}
    >
      {label}
    </button>
  );
}
