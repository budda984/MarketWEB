'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  LineChart,
  Activity,
  Search,
  LogOut,
  Scan,
  TrendingUp,
  Zap,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import type { DbSignal, DbWatchlist } from '@/types/db';
import ChartView from './ChartView';
import SignalsView from './SignalsView';
import BacktestView from './BacktestView';
import SettingsView from './SettingsView';

type View = 'chart' | 'signals' | 'backtest' | 'settings';

type Props = {
  userEmail: string;
  initialSignals: DbSignal[];
  initialWatchlists: DbWatchlist[];
};

export default function Dashboard({
  userEmail,
  initialSignals,
  initialWatchlists,
}: Props) {
  const [view, setView] = useState<View>('signals');
  const [selectedTicker, setSelectedTicker] = useState<string>('AAPL');
  const [signals, setSignals] = useState<DbSignal[]>(initialSignals);
  const [watchlists] = useState<DbWatchlist[]>(initialWatchlists);
  const [selectedMarkets, setSelectedMarkets] = useState<MarketKey[]>([
    'S&P 500',
    'NASDAQ',
    'Crypto',
    'Europa',
  ]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveCount, setLiveCount] = useState(0);

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('signals-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signals',
        },
        (payload) => {
          const newSignal = payload.new as DbSignal;
          setSignals((prev) => {
            // Evita duplicati (potrebbe già essere caricato dalla scansione manuale)
            if (prev.some((s) => s.id === newSignal.id)) return prev;
            return [newSignal, ...prev].slice(0, 500);
          });
          setLiveCount((c) => c + 1);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'signals',
        },
        (payload) => {
          const upd = payload.new as DbSignal;
          setSignals((prev) =>
            prev.map((s) => (s.id === upd.id ? upd : s))
          );
        }
      )
      .subscribe((status) => {
        setLiveConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const onOpenTicker = useCallback((ticker: string) => {
    setSelectedTicker(ticker);
    setView('chart');
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setScanMsg('Scansione in corso…');
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets: selectedMarkets,
          minStrength: 1,
          persist: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
     setScanMsg(
        `✓ ${data.count} segnali su ${data.scanned} ticker in ${(data.elapsedMs / 1000).toFixed(1)}s`
      );
      // Fetch esplicito: funziona anche se Realtime è disconnesso.
      // Realtime resta attivo per gli aggiornamenti dal cron in background.
      const r = await fetch('/api/signals?limit=200');
      const d = await r.json();
      if (d.signals) setSignals(d.signals);
    } catch (e) {
      setScanMsg(`✗ ${(e as Error).message}`);
    } finally {
      setScanning(false);
      setTimeout(() => setScanMsg(null), 6000);
    }
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const stats = useMemo(() => {
    const forti = signals.filter((s) => s.strength === 3).length;
    const medi = signals.filter((s) => s.strength === 2).length;
    const deboli = signals.filter((s) => s.strength === 1).length;
    return { forti, medi, deboli, tot: signals.length };
  }, [signals]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-64 bg-brand-panel border-r border-brand-border flex flex-col">
        <div className="p-4 border-b border-brand-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-green flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-black" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-sm">Market Monitor</div>
              <div className="text-xs text-brand-muted">Pro · Web</div>
            </div>
            <LiveDot connected={liveConnected} />
          </div>
        </div>

        <nav className="p-2 space-y-1">
          <NavButton
            active={view === 'signals'}
            onClick={() => setView('signals')}
            icon={<Activity className="w-4 h-4" />}
            label="Segnali"
            badge={stats.tot}
          />
          <NavButton
            active={view === 'chart'}
            onClick={() => setView('chart')}
            icon={<LineChart className="w-4 h-4" />}
            label="Chart"
          />
          <NavButton
            active={view === 'backtest'}
            onClick={() => setView('backtest')}
            icon={<Zap className="w-4 h-4" />}
            label="Backtest"
          />
          <NavButton
            active={view === 'settings'}
            onClick={() => setView('settings')}
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
          />
        </nav>

        <div className="px-4 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide mt-2">
          Scan mercati
        </div>
        <div className="px-2 space-y-1">
          {(Object.keys(MARKETS) as MarketKey[]).map((m) => {
            const on = selectedMarkets.includes(m);
            return (
              <button
                key={m}
                onClick={() =>
                  setSelectedMarkets((prev) =>
                    prev.includes(m)
                      ? prev.filter((x) => x !== m)
                      : [...prev, m]
                  )
                }
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-sm transition ${
                  on
                    ? 'bg-brand-green/15 text-brand-green'
                    : 'text-brand-muted hover:bg-brand-card'
                }`}
              >
                <span>{m}</span>
                <span className="text-xs font-mono">
                  {MARKETS[m].length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-3 mt-2">
          <button
            onClick={handleScan}
            disabled={scanning || selectedMarkets.length === 0}
            className="btn-primary w-full justify-center disabled:opacity-50"
          >
            {scanning ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Scan className="w-4 h-4" />
            )}
            {scanning ? 'Scansione…' : 'Scansiona ora'}
          </button>
          {scanMsg && (
            <p className="text-xs mt-2 text-brand-muted">{scanMsg}</p>
          )}
        </div>

        <div className="px-4 pb-2 text-xs font-semibold text-brand-muted uppercase tracking-wide mt-2">
          Watchlist
        </div>
        <div className="px-2 space-y-1 overflow-y-auto flex-1">
          {watchlists.length === 0 && (
            <p className="text-xs text-brand-muted px-3">Nessuna watchlist</p>
          )}
          {watchlists.map((w) => (
            <div
              key={w.id}
              className="px-3 py-1.5 text-sm text-brand-muted hover:bg-brand-card rounded flex items-center justify-between"
            >
              <span className="truncate">{w.name}</span>
              <span className="text-xs font-mono">{w.tickers.length}</span>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-brand-border">
          <div className="text-xs text-brand-muted truncate mb-2">
            {userEmail}
          </div>
          <button onClick={signOut} className="btn-ghost w-full justify-center">
            <LogOut className="w-4 h-4" /> Esci
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="h-14 border-b border-brand-border flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-sm">
            {view === 'chart' && (
              <span className="font-semibold">
                <LineChart className="w-4 h-4 inline mr-1.5" />
                Chart — {selectedTicker}
              </span>
            )}
            {view === 'signals' && (
              <span className="font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Segnali ({stats.tot})
                {liveCount > 0 && (
                  <span className="tag bg-brand-green/20 text-brand-green">
                    +{liveCount} live
                  </span>
                )}
              </span>
            )}
            {view === 'backtest' && (
              <span className="font-semibold">
                <Zap className="w-4 h-4 inline mr-1.5" />
                Backtest
              </span>
            )}
            {view === 'settings' && (
              <span className="font-semibold">
                <Settings className="w-4 h-4 inline mr-1.5" />
                Settings
              </span>
            )}
          </div>

          {view === 'chart' && (
            <TickerSearch
              value={selectedTicker}
              onChange={(t) => setSelectedTicker(t.toUpperCase())}
            />
          )}

          <div className="flex items-center gap-3 text-xs">
            <Stat label="Forti" value={stats.forti} color="text-brand-up" />
            <Stat label="Medi" value={stats.medi} color="text-yellow-400" />
            <Stat label="Deboli" value={stats.deboli} color="text-brand-muted" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {view === 'chart' && <ChartView ticker={selectedTicker} />}
          {view === 'signals' && (
            <SignalsView signals={signals} onOpenTicker={onOpenTicker} />
          )}
          {view === 'backtest' && (
            <BacktestView initialMarkets={selectedMarkets} />
          )}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}

function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span
      className="relative flex h-2 w-2"
      title={connected ? 'Live connected' : 'Offline'}
    >
      {connected && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${
          connected ? 'bg-brand-green' : 'bg-brand-muted'
        }`}
      />
    </span>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm transition ${
        active
          ? 'bg-brand-green text-black font-semibold'
          : 'text-brand-text hover:bg-brand-card'
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {badge != null && badge > 0 && (
        <span
          className={`text-xs font-mono ${
            active ? 'text-black' : 'text-brand-muted'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function TickerSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(v);
      }}
      className="flex items-center gap-2"
    >
      <Search className="w-4 h-4 text-brand-muted" />
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="AAPL, BTC-USD, ENI.MI…"
        className="input w-56"
      />
      <button type="submit" className="btn-ghost">
        Apri
      </button>
    </form>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="px-2 py-1 rounded bg-brand-panel border border-brand-border">
      <span className="text-brand-muted mr-1">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}
