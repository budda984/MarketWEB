'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Loader2,
  RefreshCw,
  ExternalLink,
  Info,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

type Row = {
  ticker: string;
  market: string | null;
  date: string;
  volume: number;
  avgVolume: number;
  prevVolume: number;
  ratio: number;
  changePct: number;
  close: number;
  priceChangePct: number;
  turnover: number;
};

type Stats = {
  requested: number;
  answered: number;
  skipped: number;
  liquid: number;
  elapsedMs: number;
};

type Props = { onOpenTicker: (t: string) => void };

export default function VolumeView({ onOpenTicker }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessionDate, setSessionDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [universe, setUniverse] = useState('both');
  const [basis, setBasis] = useState<'avg' | 'prev'>('avg');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/volume?universe=${universe}&basis=${basis}&limit=30`
      );
      const text = await r.text();
      if (!text) {
        setErr('Nessuna risposta dal server: prova con un universo più piccolo.');
        return;
      }
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      setRows(d.results ?? []);
      setStats(d.stats ?? null);
      setSessionDate(d.lastSessionDate ?? '');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [universe, basis]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Volumi anomali</span>
            {sessionDate && (
              <span className="text-xs text-brand-muted">
                seduta {sessionDate}
              </span>
            )}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Universo:</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              className="input text-xs py-1"
            >
              <option value="both">S&amp;P 500 + NASDAQ</option>
              <option value="sp500">Solo S&amp;P 500</option>
              <option value="nasdaq">Solo NASDAQ</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Confronto con:</span>
            <select
              value={basis}
              onChange={(e) => setBasis(e.target.value as 'avg' | 'prev')}
              className="input text-xs py-1"
            >
              <option value="avg">Media 20 sedute</option>
              <option value="prev">Seduta precedente</option>
            </select>
          </label>
        </div>

        {stats && !loading && (
          <div className="text-xs text-brand-muted break-words">
            {stats.answered}/{stats.requested} titoli · {stats.liquid}{' '}
            sufficientemente liquidi · {(stats.elapsedMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down break-words">
          {err}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Analisi dei volumi…
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Primi {rows.length} per aumento di volume
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {rows.map((r, i) => {
              const up = r.priceChangePct >= 0;
              return (
                <button
                  key={r.ticker}
                  onClick={() => onOpenTicker(r.ticker)}
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
                >
                  <span className="font-mono text-xs text-brand-muted w-5 flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{r.ticker}</span>
                      <span className="tag bg-brand-panel text-brand-muted text-xs">
                        {r.ratio.toFixed(1)}× la media
                      </span>
                      <span
                        className={`text-xs font-mono font-semibold flex items-center gap-0.5 ${
                          up ? 'text-brand-up' : 'text-brand-down'
                        }`}
                      >
                        {up ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {r.priceChangePct >= 0 ? '+' : ''}
                        {r.priceChangePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="text-xs text-brand-muted font-mono mt-0.5">
                      {fmtVol(r.volume)} contro {fmtVol(r.avgVolume)} · ${' '}
                      {fmtVol(r.turnover)} scambiati
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono text-sm font-bold text-brand-green">
                      +{r.changePct.toFixed(0)}%
                    </div>
                    <div className="text-xs text-brand-muted">volume</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come leggerlo
        </div>
        <p className="break-words">
          Il confronto predefinito è con la <strong>media delle 20 sedute
          precedenti</strong>, non con il giorno prima: un singolo giorno
          fiacco farebbe esplodere il rapporto senza che sia successo nulla.
        </p>
        <p className="break-words">
          <strong>Il volume da solo non dice la direzione.</strong> Uno stesso
          picco può significare accumulazione o liquidazione: è la variazione
          di prezzo accanto a dirti quale delle due. Volume alto con prezzo in
          forte calo non è un segnale d&apos;acquisto.
        </p>
        <p className="break-words">
          Sono esclusi i titoli con meno di 5 milioni di dollari scambiati:
          su quelli un raddoppio di volume non significa nulla. Attenzione
          anche alle cause tecniche — scadenze dei derivati, revisioni degli
          indici e trimestrali producono picchi che non riflettono un
          interesse duraturo.
        </p>
      </div>
    </div>
  );
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
}
