'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Crosshair,
  Loader2,
  Play,
  ExternalLink,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type Opp = {
  id: string;
  run_date: string;
  ticker: string;
  market: string | null;
  sector_name: string | null;
  sector_rank: number | null;
  price: number;
  weekly_state: string | null;
  weekly_flip_recent: boolean;
  trend_score: number;
  discount_score: number;
  ha_score: number;
  insider_buyers: number;
  total_score: number;
  rsi14: number | null;
  dist_from_52w_high: number | null;
  dist_from_ma50: number | null;
  perf_3m: number | null;
  ha_flip_bars_ago: number | null;
  trend_checks_passed: number | null;
  reasons: string[] | null;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function OpportunitiesView({ onOpenTicker }: Props) {
  const [results, setResults] = useState<Opp[]>([]);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (date?: string) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ minScore: String(minScore) });
        if (date) q.set('date', date);
        const r = await fetch(`/api/opportunities?${q}`);
        const d = await r.json();
        if (d.error) setErr(d.error);
        else {
          setResults(d.results ?? []);
          setRunDate(d.runDate ?? null);
          setAvailableDates(d.availableDates ?? []);
        }
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    },
    [minScore]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setRunning(true);
    setErr(null);
    setProgress('Avvio…');
    let offset = 0;
    let total = 0;
    let guard = 0;
    try {
      while (guard++ < 20) {
        const r = await fetch('/api/opportunities/run', {
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
        total += s.matches;
        setProgress(
          `${s.processedUpTo}/${s.universeSize} titoli · ${total} candidati`
        );
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setProgress(`Completato · ${total} candidati`);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Radar giornaliero</span>
            {runDate && (
              <span className="text-xs text-brand-muted">{runDate}</span>
            )}
          </div>
          <button
            onClick={run}
            disabled={running}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scansione…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" /> Esegui ora
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {availableDates.length > 1 && (
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-brand-muted">Esecuzione:</span>
              <select
                value={runDate ?? ''}
                onChange={(e) => load(e.target.value)}
                className="input text-xs py-1"
              >
                {availableDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Punteggio minimo:</span>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={0}>tutti</option>
              <option value={55}>55+</option>
              <option value={65}>65+</option>
              <option value={75}>75+</option>
            </select>
          </label>
          <span className="text-xs text-brand-muted">
            {results.length} candidati
          </span>
        </div>

        {progress && <div className="text-xs text-brand-green">{progress}</div>}
        {err && <div className="text-xs text-brand-down">{err}</div>}
      </div>

      {loading && results.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && results.length === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">🎯</div>
          <div className="text-sm text-brand-muted">
            Nessun candidato. Premi <strong>Esegui ora</strong> per una nuova
            scansione.
          </div>
          <div className="text-xs text-brand-muted">
            Il radar si basa sullo stato del trend settimanale: se non è mai
            stato calcolato, esegui prima una scansione in Trend settimanale.
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="divide-y divide-brand-border">
            {results.map((o, idx) => (
              <div key={o.id}>
                <button
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
                >
                  <span className="font-mono text-xs text-brand-muted w-5 flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{o.ticker}</span>
                      {o.sector_name && (
                        <span className="tag bg-brand-panel text-brand-muted text-xs">
                          {o.sector_name}
                        </span>
                      )}
                      {o.weekly_flip_recent && (
                        <span className="tag bg-brand-green/20 text-brand-green text-xs">
                          svolta recente
                        </span>
                      )}
                      {o.insider_buyers >= 2 && (
                        <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
                          {o.insider_buyers} insider
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-muted font-mono mt-0.5">
                      {Number(o.price).toFixed(2)}
                      {o.rsi14 != null && ` · RSI ${Number(o.rsi14).toFixed(0)}`}
                      {o.dist_from_52w_high != null &&
                        ` · −${Number(o.dist_from_52w_high).toFixed(0)}% dal max`}
                    </div>
                  </div>
                  <ScoreBadge value={o.total_score} />
                  {expanded === o.id ? (
                    <ChevronUp className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                  )}
                </button>

                {expanded === o.id && (
                  <div className="px-3 sm:px-4 pb-3 space-y-3 bg-brand-panel/20">
                    <div className="grid grid-cols-3 gap-2">
                      <Mini label="Trend" value={o.trend_score} />
                      <Mini label="Sconto" value={o.discount_score} />
                      <Mini label="Heikin Ashi" value={o.ha_score} />
                    </div>

                    {o.reasons && o.reasons.length > 0 && (
                      <ul className="space-y-0.5">
                        {o.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-brand-muted">
                            · {r}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="text-xs text-brand-muted font-mono">
                      {o.trend_checks_passed != null && (
                        <>criteri trend {o.trend_checks_passed}/8 · </>
                      )}
                      {o.dist_from_ma50 != null && (
                        <>
                          MA50 {Number(o.dist_from_ma50) >= 0 ? '+' : ''}
                          {Number(o.dist_from_ma50).toFixed(1)}%
                        </>
                      )}
                      {o.perf_3m != null && (
                        <> · 3 mesi {Number(o.perf_3m).toFixed(1)}%</>
                      )}
                    </div>

                    <button
                      onClick={() => onOpenTicker(o.ticker)}
                      className="btn-ghost text-xs flex items-center gap-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Apri chart
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come è costruita la lista
        </div>
        <p>
          Tre filtri eliminatori: trend settimanale sopra la HMA50, almeno
          5 criteri di struttura su 8, Heikin Ashi giornaliera rialzista.
          Chi non li supera non entra, qualunque sia il resto.
        </p>
        <p>
          Il punteggio pesa struttura del trend, sconto sul prezzo e
          tempismo Heikin Ashi in parti quasi uguali. Il punteggio Heikin
          Ashi premia il <strong>cambio di colore appena avvenuto</strong>,
          non la serie lunga: una candela rialzista da dieci sedute segnala
          un movimento già avviato.
        </p>
        <p>
          <strong>Questo punteggio non è stato verificato sui dati
          storici.</strong> Serve a ordinare una lista di candidati da
          esaminare, non a stimare la probabilità di guadagno. Insider e
          settore spostano di pochi punti apposta: sono conferme, non
          criteri portanti.
        </p>
      </div>
    </div>
  );
}

function ScoreBadge({ value }: { value: number }) {
  const color =
    value >= 75
      ? 'bg-brand-green/20 text-brand-green'
      : value >= 60
        ? 'bg-yellow-400/20 text-yellow-400'
        : 'bg-brand-panel text-brand-muted';
  return (
    <div
      className={`flex-shrink-0 w-11 text-center py-1 rounded font-mono font-bold text-sm ${color}`}
    >
      {value}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-brand-panel rounded p-2 text-center">
      <div className="font-mono font-bold text-sm">{value}</div>
      <div className="text-xs text-brand-muted">{label}</div>
    </div>
  );
}
