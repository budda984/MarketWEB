'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Rows3,
  Loader2,
  Play,
  ExternalLink,
  Info,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

type Gap = {
  id: string;
  ticker: string;
  gap_date: string;
  direction: 'up' | 'down';
  gap_pct: number;
  open_price: number;
  target_price: number;
  filled: boolean;
  fill_date: string | null;
  days_to_fill: number | null;
  days_open: number | null;
  market: string | null;
};

type Stat = {
  ticker: string;
  total_gaps: number;
  open_gaps: number;
  filled_5d: number;
  eligible_5d: number;
  filled_20d: number;
  eligible_20d: number;
  filled_60d: number;
  eligible_60d: number;
  median_days_to_fill: number | null;
};

type Props = { onOpenTicker: (t: string) => void };

export default function GapsView({ onOpenTicker }: Props) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [totalOpen, setTotalOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<'open' | 'filled'>('open');
  const [direction, setDirection] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/gaps?state=${state}&direction=${direction}`);
      const text = await r.text();
      if (!text) {
        setErr('Nessuna risposta dal server.');
        return;
      }
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      setGaps(d.gaps ?? []);
      setTotalOpen(d.totalOpen ?? 0);
      const map: Record<string, Stat> = {};
      for (const s of d.stats ?? []) map[s.ticker] = s;
      setStats(map);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [state, direction]);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setRunning(true);
    setErr(null);
    setProgress('Avvio…');
    let offset = 0;
    let guard = 0;
    try {
      while (guard++ < 25) {
        const r = await fetch('/api/gaps/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset }),
        });
        const text = await r.text();
        if (!text) {
          setErr('Nessuna risposta dal server.');
          break;
        }
        const d = JSON.parse(text);
        if (d.error) {
          setErr(d.error);
          break;
        }
        const s = d.stats;
        setProgress(
          `${s.processedUpTo}/${s.universeSize} titoli · ${s.openFound} gap aperti`
        );
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setProgress('Completato');
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  function pct(filled: number, eligible: number): string {
    if (!eligible) return '—';
    return `${Math.round((filled / eligible) * 100)}%`;
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Rows3 className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Gap di apertura</span>
          <span className="text-xs text-brand-muted">
            {totalOpen} aperti · S&amp;P 500 e NASDAQ
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-brand-panel rounded p-0.5">
            {(['open', 'filled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setState(s)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  state === s
                    ? 'bg-brand-green text-black'
                    : 'text-brand-muted hover:text-brand-text'
                }`}
              >
                {s === 'open' ? 'Ancora aperti' : 'Già chiusi'}
              </button>
            ))}
          </div>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="input text-xs py-1"
          >
            <option value="all">Entrambe le direzioni</option>
            <option value="up">Solo al rialzo</option>
            <option value="down">Solo al ribasso</option>
          </select>
        </div>

        <button
          onClick={run}
          disabled={running}
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scansione…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Aggiorna gap
            </span>
          )}
        </button>

        {running && (
          <div className="text-xs text-brand-green flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="break-words">{progress ?? 'Avvio…'}</span>
          </div>
        )}
        {!running && progress && !err && (
          <div className="text-xs text-brand-green break-words">{progress}</div>
        )}
        {err && (
          <div className="text-xs text-brand-down break-words border border-brand-down/40 rounded p-2">
            {err}
          </div>
        )}
      </div>

      {loading && gaps.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && gaps.length === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">📐</div>
          <div className="text-sm text-brand-muted">
            Nessun gap in archivio. Premi <strong>Aggiorna gap</strong> per la
            prima scansione.
          </div>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="card overflow-hidden">
          <div className="divide-y divide-brand-border">
            {gaps.map((g) => {
              const st = stats[g.ticker];
              const up = g.direction === 'up';
              return (
                <div key={g.id}>
                  <button
                    onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                    className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
                  >
                    {up ? (
                      <ArrowUp className="w-4 h-4 text-brand-up flex-shrink-0" />
                    ) : (
                      <ArrowDown className="w-4 h-4 text-brand-down flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-bold text-sm">{g.ticker}</span>
                        <span
                          className={`font-mono text-sm font-semibold ${
                            up ? 'text-brand-up' : 'text-brand-down'
                          }`}
                        >
                          {Number(g.gap_pct) >= 0 ? '+' : ''}
                          {Number(g.gap_pct).toFixed(1)}%
                        </span>
                        {!g.filled && g.days_open != null && (
                          <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
                            aperto da {g.days_open} sedute
                          </span>
                        )}
                        {g.filled && g.days_to_fill != null && (
                          <span className="tag bg-brand-panel text-brand-muted text-xs">
                            chiuso in {g.days_to_fill}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-brand-muted font-mono mt-0.5">
                        {g.gap_date} · chiude a{' '}
                        {Number(g.target_price).toFixed(2)}
                      </div>
                    </div>
                  </button>

                  {expanded === g.id && (
                    <div className="px-3 sm:px-4 pb-3 space-y-2 bg-brand-panel/20">
                      {st ? (
                        <>
                          <div className="text-xs text-brand-muted font-semibold uppercase tracking-wide">
                            Storico di {g.ticker} · {st.total_gaps} gap
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Mini
                              label="entro 5 sedute"
                              value={pct(st.filled_5d, st.eligible_5d)}
                              sub={`su ${st.eligible_5d}`}
                            />
                            <Mini
                              label="entro 20"
                              value={pct(st.filled_20d, st.eligible_20d)}
                              sub={`su ${st.eligible_20d}`}
                            />
                            <Mini
                              label="entro 60"
                              value={pct(st.filled_60d, st.eligible_60d)}
                              sub={`su ${st.eligible_60d}`}
                            />
                          </div>
                          {st.median_days_to_fill != null && (
                            <div className="text-xs text-brand-muted">
                              Tempo mediano di chiusura:{' '}
                              <strong className="text-brand-text">
                                {Number(st.median_days_to_fill).toFixed(0)} sedute
                              </strong>
                              {st.open_gaps > 0 && (
                                <> · {st.open_gaps} gap tuttora aperti</>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-xs text-brand-muted">
                          Statistiche non disponibili per questo titolo.
                        </div>
                      )}
                      <button
                        onClick={() => onOpenTicker(g.ticker)}
                        className="btn-ghost text-xs flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Apri chart
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come sono calcolati
        </div>
        <p className="break-words">
          Definizione stretta: apertura oltre il massimo del giorno prima
          (rialzo) o sotto il minimo (ribasso), quindi senza sovrapposizione
          fra le due sedute. Soglia minima 2% rispetto alla chiusura
          precedente. Il gap è chiuso quando il prezzo torna a toccare
          quella chiusura.
        </p>
        <p className="break-words">
          <strong>Le percentuali sono sempre riferite a un orizzonte.</strong>{' '}
          Senza indicarlo tenderebbero al 100%: con abbastanza tempo quasi
          ogni livello viene ritoccato, il che rende il dato vero e inutile
          insieme. Qui trovi la percentuale entro 5, 20 e 60 sedute.
        </p>
        <p className="break-words">
          Ogni percentuale è calcolata solo sui gap che hanno avuto almeno
          quel numero di sedute successive: contare i gap recenti fra i non
          chiusi abbasserebbe il dato per il solo fatto che sono recenti.
        </p>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-brand-panel rounded p-2 text-center">
      <div className="font-mono font-bold text-sm">{value}</div>
      <div className="text-xs text-brand-muted">{label}</div>
      {sub && <div className="text-[10px] text-brand-muted/70">{sub}</div>}
    </div>
  );
}
