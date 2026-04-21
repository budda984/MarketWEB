'use client';

import { useState, useEffect, useRef } from 'react';
import { Star, Plus, Check, Loader2 } from 'lucide-react';

type Watchlist = {
  id: string;
  name: string;
  tickers: string[];
};

type Props = {
  ticker: string;
};

export default function AddToWatchlistButton({ ticker }: Props) {
  const [open, setOpen] = useState(false);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Chiusura al click esterno
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/watchlists');
      const d = await r.json();
      if (r.ok) setWatchlists(d.watchlists ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  const upperTicker = ticker.toUpperCase();
  // È già presente in qualche watchlist?
  const inAnyList = watchlists.some((w) =>
    w.tickers.map((t) => t.toUpperCase()).includes(upperTicker)
  );

  async function toggle(wl: Watchlist) {
    setBusyId(wl.id);
    const currentList = wl.tickers.map((t) => t.toUpperCase());
    const isIn = currentList.includes(upperTicker);
    const newTickers = isIn
      ? wl.tickers.filter((t) => t.toUpperCase() !== upperTicker)
      : [...wl.tickers, upperTicker];
    try {
      const r = await fetch('/api/watchlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: wl.id, tickers: newTickers }),
      });
      if (r.ok) {
        setWatchlists(
          watchlists.map((x) =>
            x.id === wl.id ? { ...x, tickers: newTickers } : x
          )
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function createNew() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tickers: [upperTicker] }),
      });
      const d = await r.json();
      if (r.ok && d.watchlist) {
        setWatchlists([...watchlists, d.watchlist]);
        setNewName('');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition ${
          inAnyList
            ? 'bg-yellow-400/20 text-yellow-400 hover:bg-yellow-400/30'
            : 'bg-brand-panel/60 text-brand-muted hover:bg-brand-card hover:text-brand-text'
        }`}
        title={inAnyList ? 'Già in una watchlist' : 'Aggiungi a watchlist'}
      >
        <Star
          className={`w-3.5 h-3.5 ${inAnyList ? 'fill-yellow-400' : ''}`}
        />
        <span className="hidden sm:inline">Watchlist</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-brand-panel border border-brand-border rounded-md shadow-lg z-30">
          <div className="p-2 border-b border-brand-border">
            <div className="text-xs text-brand-muted font-semibold uppercase tracking-wide">
              Aggiungi {upperTicker} a…
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto">
            {loading && (
              <div className="p-3 text-center text-xs text-brand-muted flex items-center justify-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Caricamento…
              </div>
            )}
            {!loading && watchlists.length === 0 && (
              <div className="p-3 text-center text-xs text-brand-muted">
                Nessuna watchlist. Creane una qui sotto.
              </div>
            )}
            {!loading &&
              watchlists.map((wl) => {
                const isIn = wl.tickers
                  .map((t) => t.toUpperCase())
                  .includes(upperTicker);
                const isBusy = busyId === wl.id;
                return (
                  <button
                    key={wl.id}
                    onClick={() => toggle(wl)}
                    disabled={isBusy}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-card/60 transition disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{wl.name}</div>
                      <div className="text-xs text-brand-muted">
                        {wl.tickers.length}{' '}
                        {wl.tickers.length === 1 ? 'ticker' : 'ticker'}
                      </div>
                    </div>
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-brand-muted flex-shrink-0" />
                    ) : isIn ? (
                      <Check className="w-4 h-4 text-brand-green flex-shrink-0" />
                    ) : (
                      <Plus className="w-4 h-4 text-brand-muted flex-shrink-0" />
                    )}
                  </button>
                );
              })}
          </div>

          <div className="p-2 border-t border-brand-border flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createNew();
                }
              }}
              placeholder="Nuova watchlist…"
              className="input flex-1 text-xs py-1"
              disabled={creating}
            />
            <button
              onClick={createNew}
              disabled={!newName.trim() || creating}
              className="btn-ghost text-xs flex-shrink-0 disabled:opacity-50"
              title="Crea e aggiungi"
            >
              {creating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
