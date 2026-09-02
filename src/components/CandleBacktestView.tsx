'use client';

import { useState } from 'react';
import { FlaskConical, Loader2, Play, Info, AlertTriangle } from 'lucide-react';
import {
  mergeAcc,
  emptyAcc,
  statsFrom,
  tStatistic,
  HORIZONS,
  type HorizonAcc,
} from '@/lib/candlesticks';

type AccMap = Record<number, HorizonAcc>;

export default function CandleBacktestView() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signal, setSignal] = useState<AccMap | null>(null);
  const [baseline, setBaseline] = useState<AccMap | null>(null);
  const [meta, setMeta] = useState<{
    tickers: number;
    events: number;
    years: string;
  } | null>(null);

  // parametri
  const [years, setYears] = useState<'2y' | '5y'>('5y');
  const [requireUptrend, setRequireUptrend] = useState(true);
  const [minBodyRatio, setMinBodyRatio] = useState(1.0);

  async function run() {
    setRunning(true);
    setErr(null);
    setSignal(null);
    setBaseline(null);

    const accSig: AccMap = {};
    const accBase: AccMap = {};
    for (const h of HORIZONS) {
      accSig[h] = emptyAcc();
      accBase[h] = emptyAcc();
    }
    let tickers = 0;
    let events = 0;
    let offset = 0;
    let guard = 0;

    try {
      while (guard++ < 25) {
        const r = await fetch('/api/candle-backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset,
            years,
            options: {
              requirePriorUptrend: requireUptrend,
              minBodyRatio,
            },
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

        tickers += d.tickersDone;
        events += d.totalEvents;
        for (const h of HORIZONS) {
          accSig[h] = mergeAcc(accSig[h], d.signal[h]);
          accBase[h] = mergeAcc(accBase[h], d.baseline[h]);
        }

        setProgress(
          `${d.processedUpTo}/${d.universeSize} titoli · ${events} occorrenze`
        );

        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }

      setSignal(accSig);
      setBaseline(accBase);
      setMeta({ tickers, events, years });
      setProgress(`Completato · ${tickers} titoli · ${events} occorrenze`);
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
            <FlaskConical className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Verifica engulfing ribassista</span>
          </div>
          <button
            onClick={run}
            disabled={running}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {running ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> In corso…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" /> Esegui verifica
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Storico:</span>
            <select
              value={years}
              onChange={(e) => setYears(e.target.value as '2y' | '5y')}
              className="input text-xs py-1"
            >
              <option value="2y">2 anni</option>
              <option value="5y">5 anni</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Corpo minimo:</span>
            <select
              value={minBodyRatio}
              onChange={(e) => setMinBodyRatio(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={1.0}>1× il precedente</option>
              <option value={1.5}>1,5×</option>
              <option value={2.0}>2×</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={requireUptrend}
              onChange={(e) => setRequireUptrend(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Richiedi rialzo precedente
          </label>
        </div>

        {progress && <div className="text-xs text-brand-green">{progress}</div>}
        {err && <div className="text-xs text-brand-down">{err}</div>}
      </div>

      {signal && baseline && meta && (
        <>
          <div className="card overflow-hidden">
            <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
              <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                Risultati · {meta.tickers} titoli · {meta.events} occorrenze
              </span>
            </div>
            <div className="divide-y divide-brand-border">
              {HORIZONS.map((h) => {
                const s = statsFrom(signal[h]);
                const b = statsFrom(baseline[h]);
                const t = tStatistic(s, b);
                const diff = s.mean - b.mean;
                const significativo = t != null && Math.abs(t) >= 2;
                return (
                  <div key={h} className="p-3 sm:p-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        Dopo {h} {h === 1 ? 'seduta' : 'sedute'}
                      </span>
                      <span
                        className={`text-xs font-mono ${
                          significativo ? 'text-brand-green' : 'text-brand-muted'
                        }`}
                      >
                        t = {t != null ? t.toFixed(2) : '—'}
                        {significativo ? ' · distinguibile' : ' · nel rumore'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-brand-panel rounded p-2">
                        <div className="text-xs text-brand-muted">
                          Dopo il pattern
                        </div>
                        <div
                          className={`font-mono font-bold text-sm ${
                            s.mean < 0 ? 'text-brand-down' : 'text-brand-up'
                          }`}
                        >
                          {s.mean >= 0 ? '+' : ''}
                          {s.mean.toFixed(2)}%
                        </div>
                        <div className="text-xs text-brand-muted">
                          {(s.negativeRate * 100).toFixed(1)}% in calo · n={s.n}
                        </div>
                      </div>
                      <div className="bg-brand-panel rounded p-2">
                        <div className="text-xs text-brand-muted">
                          Giorno qualsiasi
                        </div>
                        <div
                          className={`font-mono font-bold text-sm ${
                            b.mean < 0 ? 'text-brand-down' : 'text-brand-up'
                          }`}
                        >
                          {b.mean >= 0 ? '+' : ''}
                          {b.mean.toFixed(2)}%
                        </div>
                        <div className="text-xs text-brand-muted">
                          {(b.negativeRate * 100).toFixed(1)}% in calo · n={b.n}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs">
                      <span className="text-brand-muted">Differenza: </span>
                      <span
                        className={`font-mono font-semibold ${
                          diff < 0 ? 'text-brand-down' : 'text-brand-up'
                        }`}
                      >
                        {diff >= 0 ? '+' : ''}
                        {diff.toFixed(3)} punti percentuali
                      </span>
                      <span className="text-brand-muted">
                        {' '}
                        — per uno short serve un valore negativo
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-3 space-y-2 border border-yellow-400/30">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-yellow-400">
              <AlertTriangle className="w-3.5 h-3.5" /> Come leggere questi
              numeri
            </div>
            <p className="text-xs text-brand-muted">
              La colonna <strong>giorno qualsiasi</strong> è il termine di
              paragone. Se dopo il pattern il rendimento medio è −0,1% ma in
              un giorno qualunque è +0,1%, l&apos;effetto vale 0,2 punti: va
              confrontato con commissioni, spread e costo del prestito
              titoli, che su uno short sono la voce dominante.
            </p>
            <p className="text-xs text-brand-muted">
              La statistica <strong>t</strong> dice se la differenza è
              distinguibile dal caso. Sotto 2 in valore assoluto non lo è,
              per quanto la media possa sembrare favorevole.
            </p>
            <p className="text-xs text-brand-muted">
              <strong>Bias di sopravvivenza:</strong> l&apos;universo è
              composto dai titoli che oggi fanno parte degli indici, cioè
              quelli che ce l&apos;hanno fatta. Per un segnale short questo
              peggiora i risultati rispetto alla realtà, perché mancano le
              aziende che sono state escluse o fallite.
            </p>
          </div>
        </>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Cosa viene misurato
        </div>
        <p>
          Engulfing ribassista: candela rialzista seguita da una ribassista
          il cui <strong>corpo</strong> ingloba quello precedente
          (apertura ≥ chiusura precedente, chiusura ≤ apertura precedente).
          Si confrontano i corpi, non le ombre.
        </p>
        <p>
          Per ogni occorrenza si misura il rendimento a 1, 5, 10 e 20
          sedute, e lo si confronta con la distribuzione dei rendimenti
          dello stesso titolo su tutte le sedute. Senza questo confronto un
          pattern frequente nelle fasi deboli sembrerebbe predittivo pur
          limitandosi a descrivere il contesto.
        </p>
        <p>
          Il test non include commissioni, spread, costo del prestito né
          slippage. È una misura dell&apos;effetto grezzo, che va
          confrontata con i costi reali prima di trarne conclusioni
          operative.
        </p>
      </div>
    </div>
  );
}
