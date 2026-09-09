'use client';

import { useState } from 'react';
import { FlaskConical, Loader2, Play, Info, AlertTriangle } from 'lucide-react';
import { MARKETS, type MarketKey } from '@/lib/tickers';
import {
  emptyAcc,
  mergeAcc,
  statsOf,
  tStat,
  HORIZONS,
  PATTERN_LABELS,
  type Acc,
  type PatternKind,
  type PatternSample,
} from '@/lib/pattern-test';

const KINDS: PatternKind[] = ['IHS', 'DOUBLE_BOTTOM'];

export default function PatternTestView() {
  const [markets, setMarkets] = useState<MarketKey[]>(['S&P 500' as MarketKey]);
  const [years, setYears] = useState<'2y' | '5y'>('5y');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [signal, setSignal] = useState<Record<
    PatternKind,
    Record<number, Acc>
  > | null>(null);
  const [baseline, setBaseline] = useState<Record<number, Acc> | null>(null);
  const [events, setEvents] = useState<Record<PatternKind, number> | null>(null);
  const [samples, setSamples] = useState<PatternSample[]>([]);
  const [analyzed, setAnalyzed] = useState(0);

  function toggle(m: MarketKey) {
    setMarkets((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  }

  async function run() {
    setRunning(true);
    setErr(null);
    setSignal(null);
    setBaseline(null);

    const sig = {} as Record<PatternKind, Record<number, Acc>>;
    for (const k of KINDS) {
      sig[k] = {};
      for (const h of HORIZONS) sig[k][h] = emptyAcc();
    }
    const base: Record<number, Acc> = {};
    for (const h of HORIZONS) base[h] = emptyAcc();
    const ev: Record<PatternKind, number> = { IHS: 0, DOUBLE_BOTTOM: 0 };
    const samp: PatternSample[] = [];
    let tickers = 0;
    let offset = 0;
    let guard = 0;

    try {
      while (guard++ < 25) {
        const r = await fetch('/api/pattern-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markets, offset, years }),
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
        tickers += d.analyzed;
        for (const k of KINDS) {
          ev[k] += d.events[k] ?? 0;
          for (const h of HORIZONS) {
            sig[k][h] = mergeAcc(sig[k][h], d.signal[k][h]);
          }
        }
        for (const h of HORIZONS) base[h] = mergeAcc(base[h], d.baseline[h]);
        for (const s of d.samples ?? []) {
          if (samp.length < 60) samp.push(s);
        }
        setProgress(
          `${d.processedUpTo}/${d.universeSize} titoli · ${ev.IHS + ev.DOUBLE_BOTTOM} figure`
        );
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setSignal(sig);
      setBaseline(base);
      setEvents(ev);
      setAnalyzed(tickers);
      setSamples(
        samp
          .filter((s) => s.return20 != null)
          .sort((a, b) => b.visibleDate.localeCompare(a.visibleDate))
          .slice(0, 20)
      );
      setProgress(`Completato · ${tickers} titoli`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  const totalTickers = markets.reduce(
    (s, m) => s + ((MARKETS[m] as readonly string[])?.length ?? 0),
    0
  );

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FlaskConical className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Verifica figure grafiche</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'USA', m: ['S&P 500', 'NASDAQ'] as MarketKey[] },
            { label: 'S&P 500', m: ['S&P 500'] as MarketKey[] },
            { label: 'NASDAQ', m: ['NASDAQ'] as MarketKey[] },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setMarkets(p.m)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                markets.length === p.m.length &&
                p.m.every((x) => markets.includes(x))
                  ? 'bg-brand-green text-black'
                  : 'bg-brand-panel/60 text-brand-text hover:bg-brand-card'
              }`}
            >
              {p.label}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs ml-auto">
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
        </div>

        <div className="text-xs text-brand-muted">{totalTickers} ticker</div>

        <button
          onClick={run}
          disabled={running || markets.length === 0}
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifica…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Esegui verifica
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

      {signal && baseline && events && (
        <>
          {KINDS.map((k) => (
            <ResultCard
              key={k}
              kind={k}
              label={PATTERN_LABELS[k]}
              count={events[k]}
              signal={signal[k]}
              baseline={baseline}
              tickers={analyzed}
            />
          ))}

          {samples.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
                <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                  Alcune figure recenti
                </span>
              </div>
              <div className="divide-y divide-brand-border">
                {samples.map((s, i) => (
                  <div
                    key={`${s.ticker}-${s.visibleDate}-${i}`}
                    className="flex items-center gap-3 px-3 sm:px-4 py-2"
                  >
                    <span className="font-bold text-sm w-16 flex-shrink-0">
                      {s.ticker}
                    </span>
                    <div className="flex-1 min-w-0 text-xs text-brand-muted truncate">
                      {PATTERN_LABELS[s.kind]} · visibile dal {s.visibleDate}
                    </div>
                    <span
                      className={`font-mono text-sm font-bold flex-shrink-0 ${
                        (s.return20 ?? 0) >= 0
                          ? 'text-brand-up'
                          : 'text-brand-down'
                      }`}
                    >
                      {(s.return20 ?? 0) >= 0 ? '+' : ''}
                      {(s.return20 ?? 0).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-3 space-y-2 border border-yellow-400/30">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-yellow-400">
              <AlertTriangle className="w-3.5 h-3.5" /> Prima di attivarli
            </div>
            <p className="text-xs text-brand-muted break-words">
              Il test non include commissioni né slippage, e l&apos;universo
              sono i titoli oggi negli indici: mancano quelli usciti o
              falliti, dove le figure ribassiste avrebbero funzionato meglio
              e quelle rialziste peggio.
            </p>
            <p className="text-xs text-brand-muted break-words">
              Un margine che appare su un solo orizzonte e sparisce sugli
              altri è quasi sempre rumore. Quello che conta è la regolarità.
            </p>
          </div>
        </>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come funziona la verifica
        </div>
        <p className="break-words">
          Per ogni figura si misura il rendimento a 5, 10, 20 e 60 sedute e
          lo si confronta con quello di una seduta qualsiasi dello stesso
          titolo. Le figure ci sono sempre in qualunque grafico: quello che
          conta è se dopo succeda qualcosa di diverso dal solito.
        </p>
        <p className="break-words">
          <strong>Il conteggio parte da quando la figura era davvero
          visibile</strong>, non da quando si è formata. Un minimo
          strutturale si riconosce solo dopo dieci sedute di conferma:
          misurare dal minimo userebbe informazioni che allora nessuno
          aveva, e darebbe risultati ottimi e falsi.
        </p>
        <p className="break-words">
          La statistica <strong>t</strong> dice se la differenza è
          distinguibile dal caso. Sotto 2 in valore assoluto non lo è, per
          quanto la media possa sembrare favorevole.
        </p>
      </div>
    </div>
  );
}

function ResultCard({
  kind,
  label,
  count,
  signal,
  baseline,
  tickers,
}: {
  kind: PatternKind;
  label: string;
  count: number;
  signal: Record<number, Acc>;
  baseline: Record<number, Acc>;
  tickers: number;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
        <div className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
          {label}
        </div>
        <div className="text-xs text-brand-muted">
          {count} figure su {tickers} titoli
        </div>
      </div>

      {count === 0 ? (
        <div className="p-6 text-center text-xs text-brand-muted">
          Nessuna figura rilevata con i criteri attuali.
        </div>
      ) : (
        <div className="divide-y divide-brand-border">
          {HORIZONS.map((h) => {
            const s = statsOf(signal[h]);
            const b = statsOf(baseline[h]);
            const t = tStat(s, b);
            const diff = s.mean - b.mean;
            const solid = t != null && Math.abs(t) >= 2;
            return (
              <div key={h} className="p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-sm">
                    Dopo {h} sedute
                  </span>
                  <span
                    className={`text-xs font-mono ${
                      solid ? 'text-brand-green' : 'text-brand-muted'
                    }`}
                  >
                    t = {t != null ? t.toFixed(2) : '—'}
                    {solid ? ' · distinguibile' : ' · nel rumore'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Box
                    label="Dopo la figura"
                    mean={s.mean}
                    rate={s.positiveRate}
                    n={s.n}
                  />
                  <Box
                    label="Giorno qualsiasi"
                    mean={b.mean}
                    rate={b.positiveRate}
                    n={b.n}
                  />
                </div>
                <div className="text-xs">
                  <span className="text-brand-muted">Differenza: </span>
                  <span
                    className={`font-mono font-semibold ${
                      diff >= 0 ? 'text-brand-up' : 'text-brand-down'
                    }`}
                  >
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(3)} punti
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Box({
  label,
  mean,
  rate,
  n,
}: {
  label: string;
  mean: number;
  rate: number;
  n: number;
}) {
  return (
    <div className="bg-brand-panel rounded p-2">
      <div className="text-xs text-brand-muted">{label}</div>
      <div
        className={`font-mono font-bold text-sm ${
          mean >= 0 ? 'text-brand-up' : 'text-brand-down'
        }`}
      >
        {mean >= 0 ? '+' : ''}
        {mean.toFixed(2)}%
      </div>
      <div className="text-xs text-brand-muted">
        {(rate * 100).toFixed(0)}% in salita · n={n}
      </div>
    </div>
  );
}
