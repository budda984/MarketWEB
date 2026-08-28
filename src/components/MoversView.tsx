'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sunrise,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Info,
} from 'lucide-react';

type Quote = {
  ticker: string;
  session: 'pre' | 'post' | 'regular' | 'none';
  price: number;
  previousClose: number;
  changePct: number;
  extendedVolume: number | null;
  currency?: string;
};

type Stats = {
  requested: number;
  answered: number;
  inSession: number;
  aboveThreshold: number;
  truncated: boolean;
  elapsedMs: number;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

const SESSION_LABEL: Record<string, string> = {
  pre: 'Pre-market',
  post: 'After-hours',
  regular: 'Sessione regolare',
  none: 'Mercato chiuso',
};

export default function MoversView({ onOpenTicker }: Props) {
  const [gainers, setGainers] = useState<Quote[]>([]);
  const [losers, setLosers] = useState<Quote[]>([]);
  const [session, setSession] = useState<string>('regular');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [universe, setUniverse] = useState('sp500');
  const [minChange, setMinChange] = useState(1);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [latestQuoteTime, setLatestQuoteTime] = useState<number | null>(null);
  const [serverTime, setServerTime] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/movers?universe=${universe}&minChange=${minChange}&limit=25`
      );
      const text = await r.text();
      if (!text) {
        setErr('Nessuna risposta dal server: probabile timeout, prova con un universo più piccolo.');
        return;
      }
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      setGainers(d.gainers ?? []);
      setLosers(d.losers ?? []);
      setSession(d.session ?? 'regular');
      setStats(d.stats ?? null);
      setLatestQuoteTime(d.latestQuoteTime ?? null);
      setServerTime(d.serverTime ?? null);
      setLastUpdate(new Date());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [universe, minChange]);

  useEffect(() => {
    load();
  }, [load]);

  // Aggiornamento automatico ogni 2 minuti quando una sessione estesa e'
  // in corso: in pre-market i prezzi si muovono e un dato fermo e'
  // fuorviante. A mercato chiuso non serve e si evita di sprecare
  // chiamate.
  useEffect(() => {
    if (session !== 'pre' && session !== 'post') return;
    const id = setInterval(() => load(), 120_000);
    return () => clearInterval(id);
  }, [session, load]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sunrise className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Top mover USA</span>
            <span
              className={`tag text-xs ${
                session === 'pre'
                  ? 'bg-brand-green/20 text-brand-green'
                  : session === 'post'
                    ? 'bg-yellow-400/20 text-yellow-400'
                    : 'bg-brand-panel text-brand-muted'
              }`}
            >
              {SESSION_LABEL[session]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-xs text-brand-muted">
                {lastUpdate.toLocaleTimeString('it-IT')}
              </span>
            )}
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
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Universo:</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              className="input text-xs py-1"
            >
              <option value="sp500">S&amp;P 500</option>
              <option value="nasdaq">NASDAQ</option>
              <option value="both">Entrambi</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Variazione min:</span>
            <select
              value={minChange}
              onChange={(e) => setMinChange(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={0.5}>0,5%</option>
              <option value={1}>1%</option>
              <option value={2}>2%</option>
              <option value={5}>5%</option>
            </select>
          </label>
        </div>

        {stats && !loading && (
          <div className="text-xs text-brand-muted">
            {stats.answered}/{stats.requested} risposte ·{' '}
            {stats.inSession} in sessione · {(stats.elapsedMs / 1000).toFixed(1)}s
            {stats.truncated && (
              <span className="text-yellow-400"> · universo troncato a 320</span>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down">
          {err}
        </div>
      )}

      {!loading && !err && (
        <DataFreshness
          session={session}
          latestQuoteTime={latestQuoteTime}
          serverTime={serverTime}
        />
      )}

      {loading && gainers.length === 0 && losers.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Interrogazione in corso…
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MoverList
          title="In rialzo"
          icon={<TrendingUp className="w-3.5 h-3.5 text-brand-up" />}
          quotes={gainers}
          positive
          onOpenTicker={onOpenTicker}
        />
        <MoverList
          title="In ribasso"
          icon={<TrendingDown className="w-3.5 h-3.5 text-brand-down" />}
          quotes={losers}
          positive={false}
          onOpenTicker={onOpenTicker}
        />
      </div>

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Da tenere presente
        </div>
        <p>
          Yahoo non espone le classifiche pre-market già pronte dai server
          cloud, quindi vengono ricostruite interrogando i titoli uno per
          uno. Sono coperti S&amp;P 500 e NASDAQ, non l&apos;intero mercato
          USA: un titolo minore che si muove molto in pre-market non
          comparirà.
        </p>
        <p>
          Nel pre-market gli scambi sono sottili e il divario denaro-lettera
          è ampio: una variazione del 5% può nascere da poche migliaia di
          azioni e rientrare all&apos;apertura. Guarda il volume prima di
          dare peso al movimento.
        </p>
      </div>
    </div>
  );
}

function MoverList({
  title,
  icon,
  quotes,
  positive,
  onOpenTicker,
}: {
  title: string;
  icon: React.ReactNode;
  quotes: Quote[];
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
        <span className="text-xs text-brand-muted">({quotes.length})</span>
      </div>
      {quotes.length === 0 ? (
        <div className="p-6 text-center text-xs text-brand-muted">
          Nessun titolo oltre la soglia.
        </div>
      ) : (
        <div className="divide-y divide-brand-border">
          {quotes.map((q, i) => (
            <button
              key={q.ticker}
              onClick={() => onOpenTicker(q.ticker)}
              className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
            >
              <span className="font-mono text-xs text-brand-muted w-5 flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{q.ticker}</div>
                <div className="text-xs text-brand-muted font-mono">
                  {q.price.toFixed(2)} · chiusura{' '}
                  {q.previousClose.toFixed(2)}
                  {q.extendedVolume != null && (
                    <> · vol {fmtVol(q.extendedVolume)}</>
                  )}
                </div>
              </div>
              <div
                className={`font-mono text-sm font-bold flex-shrink-0 ${
                  positive ? 'text-brand-up' : 'text-brand-down'
                }`}
              >
                {q.changePct >= 0 ? '+' : ''}
                {q.changePct.toFixed(2)}%
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dice a quando risale il dato mostrato. Serve perche' Yahoo mantiene
 * popolati i campi delle sessioni estese anche quando sono finite: senza
 * questo riscontro non si distingue il pre-market di oggi da quello di
 * ieri.
 */
function DataFreshness({
  session,
  latestQuoteTime,
  serverTime,
}: {
  session: string;
  latestQuoteTime: number | null;
  serverTime: number | null;
}) {
  if (latestQuoteTime == null) {
    return (
      <div className="card p-3 border border-yellow-400/40 text-xs text-yellow-400">
        Nessun dato di sessione estesa disponibile al momento.
      </div>
    );
  }

  const quoteDate = new Date(latestQuoteTime * 1000);
  const ageMin =
    serverTime != null ? Math.round((serverTime - latestQuoteTime) / 60) : null;

  // Il dato e' "di oggi" se cade nella giornata corrente a New York,
  // che e' il fuso in cui vivono queste sessioni
  const nyToday = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  const nyQuoteDay = quoteDate.toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  const isToday = nyToday === nyQuoteDay;

  const orario = quoteDate.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (session === 'regular') {
    return (
      <div className="card p-3 border border-yellow-400/40 text-xs text-yellow-400 space-y-1">
        <div>
          Nessuna sessione estesa in corso: la classifica mostra le variazioni
          della sessione regolare, aggiornate al {orario}.
        </div>
        <div className="text-brand-muted">
          Pre-market USA: 10:00–15:30 ora italiana. After-hours: 22:00–2:00.
        </div>
      </div>
    );
  }

  if (!isToday) {
    return (
      <div className="card p-3 border border-brand-down/40 text-xs text-brand-down">
        Attenzione: i dati più recenti risalgono al {orario}, non alla
        giornata odierna. La sessione probabilmente non è ancora iniziata.
      </div>
    );
  }

  return (
    <div className="card p-2.5 text-xs text-brand-muted flex items-center gap-2 flex-wrap">
      <span className="text-brand-green font-semibold">Dati di oggi</span>
      <span>· ultimo scambio {orario}</span>
      {ageMin != null && ageMin >= 0 && (
        <span>
          ({ageMin < 1 ? 'in tempo reale' : `${ageMin} min fa`})
        </span>
      )}
    </div>
  );
}

function fmtVol(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(v);
}
