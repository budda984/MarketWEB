'use client';

import { useMemo, useState } from 'react';
import {
  Flame,
  AlertTriangle,
  Pin,
  ArrowUpRight,
  Filter,
  Activity,
  Target as TargetIcon,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { DbSignal } from '@/types/db';

type Props = {
  signals: DbSignal[];
  onOpenTicker: (ticker: string) => void;
};

type StrengthFilter = 'all' | '3' | '2' | '1';
type StatusFilter = 'all' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT' | 'TIME_STOP' | 'CLOSED';
type StrategyFilter =
  | 'all'
  | 'HMA50_HA'
  | 'PATTERN_HS'
  | 'PATTERN_IHS'
  | 'PATTERN_BULL_FLAG'
  | 'PATTERN_BEAR_FLAG'
  | 'PATTERN_RISING_WEDGE'
  | 'PATTERN_FALLING_WEDGE'
  | 'PATTERN_CUP_HANDLE'
  | 'PATTERNS_ALL';

type PatternData = {
  type?: string;
  confidence?: number;
  target?: number;
  stopLoss?: number;
  breakoutLevel?: number;
  breakoutConfirmed?: boolean;
  direction?: 'up' | 'down';
  poleChangePct?: number;
};

export default function SignalsView({ signals, onOpenTicker }: Props) {
  const [strength, setStrength] = useState<StrengthFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [strategy, setStrategy] = useState<StrategyFilter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    // Dedup: per ogni coppia (ticker, strategy) tengo solo il segnale più
    // recente. I segnali arrivano già ordinati per data desc (+ tie-break
    // su strength), quindi il primo visto è il più recente.
    const seen = new Map<string, DbSignal>();
    for (const s of signals) {
      const key = `${s.ticker}|${s.strategy}`;
      if (!seen.has(key)) seen.set(key, s);
    }
    const deduped = Array.from(seen.values());

    return deduped.filter((s) => {
      if (strength !== 'all' && s.strength !== Number(strength)) return false;
      if (status !== 'all' && s.status !== status) return false;
      if (strategy !== 'all') {
        if (strategy === 'PATTERNS_ALL') {
          if (!s.strategy.startsWith('PATTERN_')) return false;
        } else if (s.strategy !== strategy) {
          return false;
        }
      }
      if (query && !s.ticker.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
  }, [signals, strength, status, strategy, query]);

  const groups = useMemo(() => {
    return {
      forti: filtered.filter((s) => s.strength === 3),
      medi: filtered.filter((s) => s.strength === 2),
      deboli: filtered.filter((s) => s.strength === 1),
    };
  }, [filtered]);

  const patternCount = signals.filter((s) =>
    s.strategy.startsWith('PATTERN_')
  ).length;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Filtri — scroll orizzontale in mobile */}
      <div className="card p-3 sm:p-4 space-y-2 sm:space-y-3">
        {/* Riga 1: search + forza */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Filter className="w-4 h-4 text-brand-muted flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtra per ticker…"
              className="input w-full sm:w-48"
            />
          </div>
          <ScrollRow>
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
          </ScrollRow>
        </div>

        {/* Riga 2: stati */}
        <ScrollRow>
          <span className="text-xs text-brand-muted mr-1 flex-shrink-0 self-center">
            Stato:
          </span>
          <FilterBtn
            active={status === 'all'}
            onClick={() => setStatus('all')}
            label="Tutti"
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
        </ScrollRow>

        {/* Riga 3: strategy */}
        <ScrollRow className="pt-2 border-t border-brand-border">
          <span className="text-xs text-brand-muted mr-1 flex-shrink-0 self-center">
            Strategia:
          </span>
          <FilterBtn
            active={strategy === 'all'}
            onClick={() => setStrategy('all')}
            label={`Tutte (${signals.length})`}
          />
          <FilterBtn
            active={strategy === 'HMA50_HA'}
            onClick={() => setStrategy('HMA50_HA')}
            label={`📊 HMA+HA (${signals.length - patternCount})`}
          />
          <FilterBtn
            active={strategy === 'PATTERNS_ALL'}
            onClick={() => setStrategy('PATTERNS_ALL')}
            label={`🎯 Pattern (${patternCount})`}
          />
          <FilterBtn
            active={strategy === 'PATTERN_HS'}
            onClick={() => setStrategy('PATTERN_HS')}
            label="📉 H&S"
          />
          <FilterBtn
            active={strategy === 'PATTERN_IHS'}
            onClick={() => setStrategy('PATTERN_IHS')}
            label="📈 Inv. H&S"
          />
          <FilterBtn
            active={strategy === 'PATTERN_BULL_FLAG'}
            onClick={() => setStrategy('PATTERN_BULL_FLAG')}
            label="🚩 Bull Flag"
          />
          <FilterBtn
            active={strategy === 'PATTERN_BEAR_FLAG'}
            onClick={() => setStrategy('PATTERN_BEAR_FLAG')}
            label="🏳 Bear Flag"
          />
          <FilterBtn
            active={strategy === 'PATTERN_RISING_WEDGE'}
            onClick={() => setStrategy('PATTERN_RISING_WEDGE')}
            label="🔻 Rising Wedge"
          />
          <FilterBtn
            active={strategy === 'PATTERN_FALLING_WEDGE'}
            onClick={() => setStrategy('PATTERN_FALLING_WEDGE')}
            label="🔺 Falling Wedge"
          />
          <FilterBtn
            active={strategy === 'PATTERN_CUP_HANDLE'}
            onClick={() => setStrategy('PATTERN_CUP_HANDLE')}
            label="☕ Cup & Handle"
          />
        </ScrollRow>
      </div>

      {filtered.length === 0 && (
        <div className="card p-10 sm:p-16 text-center">
          <div className="text-4xl sm:text-5xl mb-3">😴</div>
          <div className="text-brand-muted text-sm">
            Nessun segnale con questi filtri.
          </div>
          <div className="text-xs sm:text-sm text-brand-muted mt-1">
            Prova a lanciare una scansione dalla sidebar.
          </div>
        </div>
      )}

      {groups.forti.length > 0 && (
        <Section
          title="Forti"
          icon={<Flame className="w-4 h-4 text-brand-up" />}
          color="text-brand-up"
          items={groups.forti}
          onOpenTicker={onOpenTicker}
        />
      )}
      {groups.medi.length > 0 && (
        <Section
          title="Medi"
          icon={<AlertTriangle className="w-4 h-4 text-yellow-400" />}
          color="text-yellow-400"
          items={groups.medi}
          onOpenTicker={onOpenTicker}
        />
      )}
      {groups.deboli.length > 0 && (
        <Section
          title="Deboli"
          icon={<Pin className="w-4 h-4 text-brand-muted" />}
          color="text-brand-muted"
          items={groups.deboli}
          onOpenTicker={onOpenTicker}
        />
      )}
    </div>
  );
}

/** Wrapper per righe di filtri scrollabili orizzontalmente su mobile */
function ScrollRow({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1 scrollbar-thin ${className}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      {children}
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
      <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b border-brand-border flex items-center justify-between">
        <div className={`flex items-center gap-2 font-semibold text-sm ${color}`}>
          {icon}
          {title}
        </div>
        <span className="text-xs font-mono text-brand-muted">{items.length}</span>
      </div>
      <div className="divide-y divide-brand-border">
        {items.map((s) =>
          s.strategy.startsWith('PATTERN_') ? (
            <PatternRow
              key={s.id}
              signal={s}
              onOpen={() => onOpenTicker(s.ticker)}
            />
          ) : (
            <SignalRow
              key={s.id}
              signal={s}
              onOpen={() => onOpenTicker(s.ticker)}
            />
          )
        )}
      </div>
    </div>
  );
}

function SignalRow({
  signal,
  onOpen,
}: {
  signal: DbSignal;
  onOpen: () => void;
}) {
  const up = (signal.change_pct ?? 0) >= 0;
  const d = new Date(signal.signal_at);
  const dateLabel = d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const strengthEmoji =
    signal.strength === 3 ? '🔥' : signal.strength === 2 ? '⚠️' : '📌';

  return (
    <button
      onClick={onOpen}
      className="w-full px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-4 hover:bg-brand-card/50 transition text-left group"
    >
      <div className="text-xl sm:text-2xl w-6 sm:w-8 flex-shrink-0">
        {strengthEmoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm sm:text-base">{signal.ticker}</span>
          <span className="tag bg-brand-panel text-brand-muted hidden sm:inline-flex">
            HMA+HA
          </span>
          {signal.status !== 'ACTIVE' && <StatusTag status={signal.status} />}
        </div>
        <div className="text-xs text-brand-muted mt-0.5 truncate">
          <span className="sm:hidden">
            {dateLabel.split(',')[0]}
          </span>
          <span className="hidden sm:inline">
            {signal.details} · {dateLabel}
          </span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm sm:text-base">
          {fmt(signal.price)}
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
        <div className="text-right w-16 sm:w-20 flex-shrink-0 hidden sm:block">
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
      <ArrowUpRight className="w-4 h-4 text-brand-muted group-hover:text-brand-green transition flex-shrink-0" />
    </button>
  );
}

function PatternRow({
  signal,
  onOpen,
}: {
  signal: DbSignal;
  onOpen: () => void;
}) {
  const data = (signal.pattern_data ?? {}) as PatternData;
  const s = signal.strategy;

  // Determina tipo, icona, direzione in base alla strategy
  let typeIcon: string;
  let typeName: string;
  let bullish: boolean;
  if (s === 'PATTERN_HS') {
    typeIcon = '📉';
    typeName = 'Testa e Spalle';
    bullish = false;
  } else if (s === 'PATTERN_IHS') {
    typeIcon = '📈';
    typeName = 'Inv. Testa e Spalle';
    bullish = true;
  } else if (s === 'PATTERN_BULL_FLAG') {
    typeIcon = '🚩';
    typeName = 'Bull Flag';
    bullish = true;
  } else if (s === 'PATTERN_BEAR_FLAG') {
    typeIcon = '🏳';
    typeName = 'Bear Flag';
    bullish = false;
  } else if (s === 'PATTERN_RISING_WEDGE') {
    typeIcon = '🔻';
    typeName = 'Rising Wedge';
    bullish = false;
  } else if (s === 'PATTERN_FALLING_WEDGE') {
    typeIcon = '🔺';
    typeName = 'Falling Wedge';
    bullish = true;
  } else if (s === 'PATTERN_CUP_HANDLE') {
    typeIcon = '☕';
    typeName = 'Cup & Handle';
    bullish = true;
  } else {
    typeIcon = '🎯';
    typeName = 'Pattern';
    bullish = true;
  }

  const d = new Date(signal.signal_at);
  const dateLabel = d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
  });

  const dirColor = bullish ? 'text-brand-up' : 'text-brand-down';
  const DirIcon = bullish ? TrendingUp : TrendingDown;

  return (
    <button
      onClick={onOpen}
      className="w-full px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-4 hover:bg-brand-card/50 transition text-left group"
    >
      <div className="text-xl sm:text-2xl w-6 sm:w-8 flex-shrink-0">
        {typeIcon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm sm:text-base">{signal.ticker}</span>
          <span className="tag bg-brand-green/15 text-brand-green flex items-center gap-1 hidden sm:inline-flex">
            <Activity className="w-3 h-3" />
            {typeName}
          </span>
          {signal.strength === 3 && (
            <span className="tag bg-brand-up/20 text-brand-up">🚨 Break</span>
          )}
          {signal.strength === 2 && (
            <span className="tag bg-yellow-400/20 text-yellow-400">⏳ Attesa</span>
          )}
        </div>
        <div className="text-xs text-brand-muted mt-0.5 flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className={`${dirColor} flex items-center gap-1`}>
            <DirIcon className="w-3 h-3" />
            <span className="sm:hidden">{bullish ? 'rial' : 'rib'}</span>
            <span className="hidden sm:inline">
              {bullish ? 'rialzista' : 'ribassista'}
            </span>
          </span>
          {data.confidence != null && (
            <span>{(data.confidence * 100).toFixed(0)}%</span>
          )}
          {data.breakoutLevel != null && (
            <span className="hidden sm:inline">
              neckline ${Number(data.breakoutLevel).toFixed(2)}
            </span>
          )}
          {data.target != null && (
            <span className="flex items-center gap-1">
              <TargetIcon className="w-3 h-3" />${Number(data.target).toFixed(2)}
            </span>
          )}
          <span className="hidden sm:inline">{dateLabel}</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono font-bold text-sm sm:text-base">
          {fmt(signal.price)}
        </div>
        <div className="text-xs text-brand-muted">last</div>
      </div>
      <ArrowUpRight className="w-4 h-4 text-brand-muted group-hover:text-brand-green transition flex-shrink-0" />
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
      className={`px-2.5 py-1 rounded text-xs font-medium transition whitespace-nowrap flex-shrink-0 ${
        active
          ? 'bg-brand-green text-black'
          : 'text-brand-muted hover:bg-brand-card bg-brand-panel/40'
      }`}
    >
      {label}
    </button>
  );
}

/** Format sicuro: accetta null/undefined e torna '—' se non numerico */
function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}
