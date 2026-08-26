'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CalendarClock,
  Loader2,
  Play,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Info,
} from 'lucide-react';

type Flip = {
  id: string;
  ticker: string;
  direction: 'bullish' | 'bearish';
  close: number;
  hma_value: number;
  distance_pct: number | null;
  bar_date: string;
};

type Summary = {
  above: number;
  below: number;
  lastBarDate: string | null;
  lastUpdate: string | null;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function WeeklyTrendView({ onOpenTicker }: Props) {
  const [flips, setFlips] = useState<Flip[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [direction, setDirection] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/weekly-trend?weeks=${weeks}&direction=${direction}`
      );
      const d = await r.json();
      if (d.error) setErr(d.error);
      else {
        setFlips(d.flips ?? []);
        setSummary(d.summary ?? null);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [weeks, direction]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * La scansione di ~400 titoli non sta in una sola chiamata: la route
   * restituisce nextOffset e qui si prosegue finche' non e' completata.
   */
  async function run() {
    setRunning(true);
    setErr(null);
    setProgress('Avvio…');
    let offset = 0;
    let totalNew = 0;
    let guard = 0;

    try {
      while (guard++ < 20) {
        const r = await fetch('/api/weekly-trend/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, notify: true }),
        });
        const text = await r.text();
        if (!text) {
          setErr('Nessuna risposta dal server (timeout).');
          break;
        }
        const d = JSON.parse(text);
        if (d.error) {
          setErr(d.error);
          break;
        }
        const s = d.stats;
        totalNew += s.newFlips;
        setProgress(
          `${s.processedUpTo}/${s.universeSize} titoli · ${totalNew} cambi di stato`
        );
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setProgress(`Completato · ${totalNew} nuovi cambi di stato`);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  const bullish = flips.filter((f) => f.direction === 'bullish');
  const bearish = flips.filter((f) => f.direction === 'bearish');

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Trend settimanale HMA50</span>
            {summary?.lastBarDate && (
              <span className="text-xs text-brand-muted">
                settimana {summary.lastBarDate}
              </span>
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
                <Play className="w-3.5 h-3.5" /> Scansiona ora
              </span>
            )}
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-brand-panel rounded p-2 text-center">
              <div className="font-mono font-bold text-lg text-brand-up">
                {summary.above}
              </div>
              <div className="text-xs text-brand-muted">sopra la media</div>
            </div>
            <div className="bg-brand-panel rounded p-2 text-center">
              <div className="font-mono font-bold text-lg text-brand-down">
                {summary.below}
              </div>
              <div className="text-xs text-brand-muted">sotto la media</div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Periodo:</span>
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={2}>2 settimane</option>
              <option value={4}>4 settimane</option>
              <option value={8}>8 settimane</option>
              <option value={26}>6 mesi</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Direzione:</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="input text-xs py-1"
            >
              <option value="all">Tutte</option>
              <option value="bullish">Solo sopra</option>
              <option value="bearish">Solo sotto</option>
            </select>
          </label>
        </div>

        {progress && (
          <div className="text-xs text-brand-green">{progress}</div>
        )}
        {err && <div className="text-xs text-brand-down">{err}</div>}
      </div>

      {loading && flips.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && flips.length === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">📊</div>
          <div className="text-sm text-brand-muted">
            Nessun cambio di stato nel periodo. Se è la prima volta, premi
            <strong> Scansiona ora</strong>.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(direction === 'all' || direction === 'bullish') && (
          <FlipList
            title="Passati sopra la media"
            icon={<TrendingUp className="w-3.5 h-3.5 text-brand-up" />}
            flips={bullish}
            positive
            onOpenTicker={onOpenTicker}
          />
        )}
        {(direction === 'all' || direction === 'bearish') && (
          <FlipList
            title="Passati sotto la media"
            icon={<TrendingDown className="w-3.5 h-3.5 text-brand-down" />}
            flips={bearish}
            positive={false}
            onOpenTicker={onOpenTicker}
          />
        )}
      </div>

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come funziona
        </div>
        <p>
          Viene valutata sempre l&apos;ultima settimana <strong>chiusa</strong>:
          la settimana in corso non si considera, perché una chiusura sopra
          la media il mercoledì può rientrare entro venerdì. I cambi di
          stato compaiono quindi dal fine settimana.
        </p>
        <p>
          Ogni cambio viene registrato una volta sola per titolo e per
          settimana: rieseguire la scansione non genera notifiche doppie.
        </p>
        <p>
          Universo: S&amp;P 500 e NASDAQ. Un incrocio su media mobile
          arriva per costruzione dopo l&apos;inversione già avvenuta, ed è
          soggetto a falsi segnali nelle fasi laterali.
        </p>
      </div>
    </div>
  );
}

function FlipList({
  title,
  icon,
  flips,
  positive,
  onOpenTicker,
}: {
  title: string;
  icon: React.ReactNode;
  flips: Flip[];
  positive: boolean;
  onOpenTicker: (t: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
          {title}
        </span>
        <span className="text-xs text-brand-muted">({flips.length})</span>
      </div>
      {flips.length === 0 ? (
        <div className="p-6 text-center text-xs text-brand-muted">
          Nessuno nel periodo.
        </div>
      ) : (
        <div className="divide-y divide-brand-border max-h-[32rem] overflow-y-auto">
          {flips.map((f) => (
            <button
              key={f.id}
              onClick={() => onOpenTicker(f.ticker)}
              className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold text-sm">{f.ticker}</span>
                  <span className="text-xs text-brand-muted">{f.bar_date}</span>
                </div>
                <div className="text-xs text-brand-muted font-mono">
                  {Number(f.close).toFixed(2)} · HMA50{' '}
                  {Number(f.hma_value).toFixed(2)}
                </div>
              </div>
              {f.distance_pct != null && (
                <div
                  className={`font-mono text-sm font-bold flex-shrink-0 ${
                    positive ? 'text-brand-up' : 'text-brand-down'
                  }`}
                >
                  {Number(f.distance_pct) >= 0 ? '+' : ''}
                  {Number(f.distance_pct).toFixed(1)}%
                </div>
              )}
              <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
