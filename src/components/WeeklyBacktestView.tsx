'use client';

import { useState } from 'react';
import { History, Loader2, Play, Info, AlertTriangle } from 'lucide-react';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import {
  emptyAccumulator,
  mergeAccumulators,
  summarize,
  type BacktestAccumulator,
  type BacktestSummary,
} from '@/lib/weekly-backtest';

type SampleTrade = {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string | null;
  exitPrice: number | null;
  returnPct: number | null;
  weeks: number;
  open: boolean;
};

export default function WeeklyBacktestView() {
  const [selectedMarkets, setSelectedMarkets] = useState<MarketKey[]>([
    'S&P 500' as MarketKey,
  ]);
  const [period, setPeriod] = useState<'5y' | 'max'>('5y');
  const [hmaPeriod, setHmaPeriod] = useState(50);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [samples, setSamples] = useState<SampleTrade[]>([]);

  const totalTickers = selectedMarkets.reduce(
    (s, m) => s + ((MARKETS[m] as readonly string[])?.length ?? 0),
    0
  );

  function toggleMarket(m: MarketKey) {
    setSelectedMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  async function run() {
    setRunning(true);
    setErr(null);
    setSummary(null);
    setSamples([]);

    let acc: BacktestAccumulator = emptyAccumulator();
    const allSamples: SampleTrade[] = [];
    let offset = 0;
    let guard = 0;

    try {
      while (guard++ < 25) {
        const r = await fetch('/api/weekly-backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markets: selectedMarkets,
            offset,
            period,
            hmaPeriod,
          }),
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

        acc = mergeAccumulators(acc, d.accumulator);
        for (const s of d.sampleTrades ?? []) {
          if (allSamples.length < 40) allSamples.push(s);
        }
        setProgress(
          `${d.processedUpTo}/${d.universeSize} titoli · ${acc.closedTrades} operazioni`
        );

        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }

      setSummary(summarize(acc));
      setSamples(
        allSamples
          .filter((s) => !s.open)
          .sort((a, b) => (b.exitDate ?? '').localeCompare(a.exitDate ?? ''))
          .slice(0, 20)
      );
      setProgress(`Completato · ${acc.closedTrades} operazioni chiuse`);
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
            <History className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Backtest HMA50 settimanale</span>
          </div>
          <button
            onClick={run}
            disabled={running || selectedMarkets.length === 0}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> In corso…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" /> Esegui backtest
              </span>
            )}
          </button>
        </div>

        <div>
          <div className="text-xs text-brand-muted font-semibold uppercase tracking-wide mb-1.5">
            Mercati ({totalTickers} ticker)
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(MARKETS) as MarketKey[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleMarket(m)}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  selectedMarkets.includes(m)
                    ? 'bg-brand-green text-black'
                    : 'bg-brand-panel/40 text-brand-muted hover:bg-brand-card'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Storico:</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as '5y' | 'max')}
              className="input text-xs py-1"
            >
              <option value="5y">5 anni</option>
              <option value="max">Tutto il disponibile</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Periodo HMA:</span>
            <select
              value={hmaPeriod}
              onChange={(e) => setHmaPeriod(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={30}>30</option>
              <option value={40}>40</option>
              <option value={50}>50</option>
              <option value={60}>60</option>
            </select>
          </label>
        </div>

        {progress && <div className="text-xs text-brand-green">{progress}</div>}
        {err && <div className="text-xs text-brand-down">{err}</div>}
      </div>

      {summary && (
        <>
          {/* Confronto con il comprare e tenere */}
          <div className="card p-3 sm:p-4 space-y-2">
            <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Il confronto che conta
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-brand-panel rounded p-3 text-center">
                <div className="text-xs text-brand-muted">Seguendo la regola</div>
                <div
                  className={`font-mono font-bold text-xl ${
                    summary.avgStrategyReturn >= 0
                      ? 'text-brand-up'
                      : 'text-brand-down'
                  }`}
                >
                  {summary.avgStrategyReturn >= 0 ? '+' : ''}
                  {summary.avgStrategyReturn.toFixed(1)}%
                </div>
                <div className="text-xs text-brand-muted">
                  in posizione il {summary.avgExposure.toFixed(0)}% del tempo
                </div>
              </div>
              <div className="bg-brand-panel rounded p-3 text-center">
                <div className="text-xs text-brand-muted">Comprare e tenere</div>
                <div
                  className={`font-mono font-bold text-xl ${
                    summary.avgBuyHoldReturn >= 0
                      ? 'text-brand-up'
                      : 'text-brand-down'
                  }`}
                >
                  {summary.avgBuyHoldReturn >= 0 ? '+' : ''}
                  {summary.avgBuyHoldReturn.toFixed(1)}%
                </div>
                <div className="text-xs text-brand-muted">
                  sempre investito
                </div>
              </div>
            </div>
            <div className="text-xs text-brand-muted">
              La regola ha battuto il comprare e tenere su{' '}
              <strong className="text-brand-text">
                {summary.beatBuyHoldPct.toFixed(0)}%
              </strong>{' '}
              dei titoli analizzati ({summary.tickers} titoli).
            </div>
          </div>

          {/* Statistiche operazioni */}
          <div className="card p-3 sm:p-4 space-y-3">
            <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Operazioni · {summary.closedTrades} chiuse
              {summary.openTrades > 0 && `, ${summary.openTrades} aperte`}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat
                label="Operazioni vinte"
                value={`${summary.winRate.toFixed(1)}%`}
                good={summary.winRate >= 50}
              />
              <Stat
                label="Guadagno medio"
                value={`+${summary.avgWin.toFixed(1)}%`}
                good
              />
              <Stat
                label="Perdita media"
                value={`${summary.avgLoss.toFixed(1)}%`}
                good={false}
              />
              <Stat
                label="Fattore di profitto"
                value={
                  summary.profitFactor != null
                    ? summary.profitFactor.toFixed(2)
                    : '—'
                }
                good={(summary.profitFactor ?? 0) > 1}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat
                label="Risultato medio"
                value={`${summary.avgReturn >= 0 ? '+' : ''}${summary.avgReturn.toFixed(2)}%`}
                good={summary.avgReturn > 0}
              />
              <Stat
                label="Durata media"
                value={`${summary.avgWeeks.toFixed(0)} sett.`}
              />
              <Stat
                label="Migliore"
                value={`+${summary.bestTrade.toFixed(0)}%`}
                good
              />
              <Stat
                label="Peggiore"
                value={`${summary.worstTrade.toFixed(0)}%`}
                good={false}
              />
            </div>
            <div className="bg-brand-panel rounded p-2.5">
              <div className="text-xs text-brand-muted">
                Perdite consecutive massime
              </div>
              <div className="font-mono font-bold text-lg">
                {summary.maxConsecutiveLosses}
              </div>
              <div className="text-xs text-brand-muted">
                È il numero che conta per sapere se riusciresti a restare
                fedele alla regola dopo una serie negativa.
              </div>
            </div>
          </div>

          {/* Esempi */}
          {samples.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
                <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                  Alcune operazioni recenti
                </span>
              </div>
              <div className="divide-y divide-brand-border">
                {samples.map((t, i) => (
                  <div
                    key={`${t.ticker}-${t.entryDate}-${i}`}
                    className="flex items-center gap-3 px-3 sm:px-4 py-2"
                  >
                    <span className="font-bold text-sm w-16 flex-shrink-0">
                      {t.ticker}
                    </span>
                    <div className="flex-1 min-w-0 text-xs text-brand-muted font-mono truncate">
                      {t.entryDate} → {t.exitDate} · {t.weeks} sett.
                    </div>
                    <span
                      className={`font-mono text-sm font-bold flex-shrink-0 ${
                        (t.returnPct ?? 0) >= 0
                          ? 'text-brand-up'
                          : 'text-brand-down'
                      }`}
                    >
                      {(t.returnPct ?? 0) >= 0 ? '+' : ''}
                      {(t.returnPct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-3 space-y-2 border border-yellow-400/30">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-yellow-400">
              <AlertTriangle className="w-3.5 h-3.5" /> Prima di trarre
              conclusioni
            </div>
            <p className="text-xs text-brand-muted">
              <strong>Il periodo testato è stato prevalentemente
              rialzista.</strong> Una regola che segue il trend al rialzo
              parte avvantaggiata in questo contesto: il risultato dice poco
              su come si comporterebbe in un mercato laterale o in discesa
              prolungata.
            </p>
            <p className="text-xs text-brand-muted">
              <strong>Bias di sopravvivenza:</strong> l&apos;universo sono i
              titoli che oggi fanno parte degli indici. Le aziende uscite o
              fallite non ci sono, e su quelle la regola avrebbe subito le
              perdite peggiori.
            </p>
            <p className="text-xs text-brand-muted">
              Non sono inclusi commissioni, spread né tasse. L&apos;ingresso
              è calcolato sulla chiusura della settimana del segnale: nella
              realtà entreresti il lunedì a un prezzo diverso.
            </p>
          </div>
        </>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> La regola testata
        </div>
        <p>
          Ingresso quando la candela settimanale chiude sopra la HMA50,
          uscita quando chiude sotto. Simmetrica, senza altri filtri: è la
          regola così com&apos;è, non una versione ottimizzata sui dati
          passati.
        </p>
        <p>
          La settimana in corso viene sempre scartata, perché la sua
          chiusura non è definitiva.
        </p>
        <p>
          Il <strong>fattore di profitto</strong> è la somma dei guadagni
          divisa per quella delle perdite: sotto 1 la regola perde denaro,
          per quanto alta possa essere la percentuale di operazioni vinte.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  const color =
    good === undefined
      ? ''
      : good
        ? 'text-brand-up'
        : 'text-brand-down';
  return (
    <div className="bg-brand-panel rounded p-2">
      <div className="text-xs text-brand-muted">{label}</div>
      <div className={`font-mono font-bold text-sm ${color}`}>{value}</div>
    </div>
  );
}
