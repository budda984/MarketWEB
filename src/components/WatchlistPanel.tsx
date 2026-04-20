'use client';

import { useState } from 'react';
import {
  Plus,
  X,
  Check,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { DbWatchlist } from '@/types/db';

type Props = {
  watchlists: DbWatchlist[];
  onChange: (w: DbWatchlist[]) => void;
  onOpenTicker?: (t: string) => void;
};

/**
 * Pannello watchlist nella sidebar.
 * - Expand/collapse per vedere i ticker di una watchlist
 * - Crea nuova watchlist con nome
 * - Aggiungi ticker singolo o multipli (separati da virgola/spazio)
 * - Rimuovi ticker
 * - Rinomina o elimina watchlist
 */
export default function WatchlistPanel({
  watchlists,
  onChange,
  onOpenTicker,
}: Props) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createWatchlist() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tickers: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      onChange([...watchlists, data.watchlist]);
      setNewName('');
      setCreatingNew(false);
      setExpandedId(data.watchlist.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteWatchlist(id: string) {
    if (!confirm('Eliminare questa watchlist?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/watchlists', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Errore');
      }
      onChange(watchlists.filter((w) => w.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function renameWatchlist(id: string, newName: string) {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch('/api/watchlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      onChange(watchlists.map((w) => (w.id === id ? data.watchlist : w)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateTickers(id: string, tickers: string[]) {
    setBusy(true);
    try {
      const res = await fetch('/api/watchlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, tickers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Errore');
      onChange(watchlists.map((w) => (w.id === id ? data.watchlist : w)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-2 space-y-1 pb-2">
      {/* Bottone + crea */}
      {!creatingNew ? (
        <button
          onClick={() => {
            setCreatingNew(true);
            setErr(null);
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-brand-muted hover:text-brand-green hover:bg-brand-card rounded transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Nuova watchlist
        </button>
      ) : (
        <div className="px-2 py-1.5 bg-brand-card rounded space-y-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createWatchlist();
              if (e.key === 'Escape') {
                setCreatingNew(false);
                setNewName('');
              }
            }}
            placeholder="Nome…"
            autoFocus
            className="input w-full text-xs py-1"
          />
          <div className="flex gap-1">
            <button
              onClick={createWatchlist}
              disabled={busy || !newName.trim()}
              className="flex-1 btn-primary py-1 px-2 text-xs justify-center disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Crea
            </button>
            <button
              onClick={() => {
                setCreatingNew(false);
                setNewName('');
              }}
              className="btn-ghost py-1 px-2 text-xs"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {err && (
        <p className="text-xs text-brand-down bg-brand-down/10 p-1.5 rounded">
          {err}
        </p>
      )}

      {/* Lista watchlist */}
      {watchlists.length === 0 && !creatingNew && (
        <p className="text-xs text-brand-muted px-3 py-2">
          Nessuna watchlist. Creane una!
        </p>
      )}

      {watchlists.map((w) => (
        <WatchlistItem
          key={w.id}
          watchlist={w}
          expanded={expandedId === w.id}
          onToggle={() => setExpandedId(expandedId === w.id ? null : w.id)}
          onRename={(name) => renameWatchlist(w.id, name)}
          onDelete={() => deleteWatchlist(w.id)}
          onUpdateTickers={(t) => updateTickers(w.id, t)}
          onOpenTicker={onOpenTicker}
        />
      ))}
    </div>
  );
}

function WatchlistItem({
  watchlist,
  expanded,
  onToggle,
  onRename,
  onDelete,
  onUpdateTickers,
  onOpenTicker,
}: {
  watchlist: DbWatchlist;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateTickers: (t: string[]) => void;
  onOpenTicker?: (t: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(watchlist.name);
  const [newTicker, setNewTicker] = useState('');

  function addTickers() {
    const raw = newTicker.trim();
    if (!raw) return;
    // Accetta separatori virgola, spazio, newline
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const merged = Array.from(new Set([...watchlist.tickers, ...parts]));
    onUpdateTickers(merged);
    setNewTicker('');
  }

  function removeTicker(t: string) {
    onUpdateTickers(watchlist.tickers.filter((x) => x !== t));
  }

  return (
    <div className="rounded border border-transparent hover:border-brand-border transition">
      {/* Header della watchlist */}
      <div className="px-2 py-1.5 flex items-center gap-1 group">
        {!renaming ? (
          <>
            <button
              onClick={onToggle}
              className="flex items-center gap-1.5 flex-1 min-w-0 text-sm text-brand-text hover:text-brand-green"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
              )}
              <span className="truncate">{watchlist.name}</span>
            </button>
            <span className="text-xs font-mono text-brand-muted flex-shrink-0">
              {watchlist.tickers.length}
            </span>
            <button
              onClick={() => {
                setRenameValue(watchlist.name);
                setRenaming(true);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-brand-muted hover:text-brand-text transition"
              title="Rinomina"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-brand-muted hover:text-brand-down transition"
              title="Elimina"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        ) : (
          <div className="flex gap-1 flex-1">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRename(renameValue);
                  setRenaming(false);
                }
                if (e.key === 'Escape') setRenaming(false);
              }}
              autoFocus
              className="input flex-1 text-xs py-1"
            />
            <button
              onClick={() => {
                onRename(renameValue);
                setRenaming(false);
              }}
              className="btn-primary py-1 px-2 text-xs"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="btn-ghost py-1 px-2 text-xs"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Contenuto espanso: ticker + aggiungi */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {/* Input aggiungi ticker */}
          <div className="flex gap-1">
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTickers();
              }}
              placeholder="AAPL, BTC-USD…"
              className="input flex-1 text-xs py-1 font-mono"
              autoCapitalize="characters"
            />
            <button
              onClick={addTickers}
              disabled={!newTicker.trim()}
              className="btn-primary py-1 px-2 text-xs disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Lista ticker */}
          {watchlist.tickers.length === 0 ? (
            <p className="text-xs text-brand-muted px-2 py-1">
              Nessun ticker. Aggiungine uno!
            </p>
          ) : (
            <div className="space-y-0.5">
              {watchlist.tickers.map((t) => (
                <div
                  key={t}
                  className="flex items-center gap-1 px-2 py-1 rounded hover:bg-brand-card text-xs group"
                >
                  <button
                    onClick={() => onOpenTicker?.(t)}
                    className="flex-1 text-left font-mono text-brand-text hover:text-brand-green truncate"
                    title={`Apri chart ${t}`}
                  >
                    {t}
                  </button>
                  <button
                    onClick={() => removeTicker(t)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-brand-muted hover:text-brand-down"
                    title="Rimuovi"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
