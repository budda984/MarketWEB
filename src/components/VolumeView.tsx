'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Loader2,
  RefreshCw,
  Flame,
  ExternalLink,
  Info,
} from 'lucide-react';

type Row = {
  ticker: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  currency: string | null;
  volume: number;
  avgVolume: number | null;
  turnover: number | null;
  volumeRatio: number | null;
};

type SessionInfo = {
  fraction: number;
  session: string;
  etTime: string;
  complete: boolean;
  progressPct: number;
};

type Stats = {
  requested: number;
  answered: number;
  liquid: number;
  widened: boolean;
  minAvgVolume: number;
  elapsedMs: number;
};

type Props = { onOpenTicker: (ticker: string) => void };

const SESSION_LABEL: Record<string, string> = {
  pre: 'Pre-market',
  regular: 'Sessione regolare',
  post: 'After-hours',
  closed: 'Mercato chiuso',
};

export default function VolumeView({ onOpenTicker }: Props) {
  const [byVolume, setByVolume] = useState<Row[]>([]);
  const [byRatio, setByRatio] = useState<Row[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [universe, setUniverse] = useState('both');
  const [minAvg, setMinAvg] = useState(200_000);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/volume?universe=${universe}&minAvg=${minAvg}&limit=25`
      );
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
      setByVolume(d.byVolume ?? []);
      setByRatio(d.byRatio ?? []);
      setSession(d.session ?? null);
      setStats(d.stats ?? null);
      setLastUpdate(new Date());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [universe, minAvg]);

  useEffect(() => {
    load();
  }, [load]);

  // A mercato aperto i volumi crescono di continuo: un dato fermo
  // invecchia in fretta. A mercato chiuso non cambia nulla.
  useEffect(() => {
    if (session?.session !== 'regular') return;
    const id = setInterval(() => load(), 120_000);
    return () => clearInterval(id);
  }, [session?.session, load]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Volumi USA</span>
            {session && (
              <span
                className={`tag text-xs ${
                  session.session === 'regular'
                    ? 'bg-brand-green/20 text-brand-green'
                    : 'bg-brand-panel text-brand-muted'
                }`}
              >
                {SESSION_LABEL[session.session] ?? session.session}
              </span>
            )}
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
              <option value="all">Tutto il mercato USA</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Volume medio min:</span>
            <select
              value={minAvg}
              onChange={(e) => setMinAvg(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={50_000}>50k</option>
              <option value={200_000}>200k</option>
              <option value={1_000_000}>1M</option>
              <option value={5_000_000}>5M</option>
            </select>
          </label>
        </div>

        <SessionNote session={session} />

        {stats && !loading && (
          <div className="text-xs text-brand-muted break-words">
            {stats.answered}/{stats.requested} risposte · {stats.liquid} sopra
            la soglia di liquidità · {(stats.elapsedMs / 1000).toFixed(1)}s
            {stats.widened && ' · inclusi i più scambiati di Yahoo'}
          </div>
        )}
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down break-words">
          {err}
        </div>
      )}

      {loading && byVolume.length === 0 && byRatio.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Lettura dei volumi…
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Volume anomalo"
          subtitle="quante volte il proprio normale, a parità di ora"
          icon={<Flame className="w-3.5 h-3.5 text-brand-green" />}
          rows={byRatio}
          mode="ratio"
          onOpenTicker={onOpenTicker}
        />
        <Section
          title="Volume più alto"
          subtitle="in valore assoluto, senza confronto con lo storico"
          icon={<BarChart3 className="w-3.5 h-3.5 text-brand-muted" />}
          rows={byVolume}
          mode="absolute"
          onOpenTicker={onOpenTicker}
        />
      </div>

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come leggerle
        </div>
        <p className="break-words">
          <strong>Volume anomalo</strong> è la classifica che dice qualcosa
          di nuovo: un titolo che scambia cinque volte il suo normale lo fa
          per una ragione — una trimestrale, una notizia, un declassamento.
          Il volume alto da solo non dice la direzione: sale e scende con la
          stessa intensità.
        </p>
        <p className="break-words">
          <strong>Volume più alto</strong> in assoluto premia sempre i
          soliti giganti, perché scambiano tanto per dimensione. È utile per
          vedere dove si concentra il mercato, non per trovare novità.
        </p>
        <p className="break-words">
          A mercato aperto il confronto tiene conto dell&apos;ora: il volume
          non si distribuisce in modo uniforme nella giornata, si concentra
          in apertura e soprattutto in chiusura. Il rapporto è quindi
          rispetto a quanto un titolo <em>dovrebbe</em> aver già scambiato a
          quest&apos;ora, non rispetto alla giornata intera. Nei primi minuti
          resta comunque approssimativo.
        </p>
        <p className="break-words">
          La soglia sul volume medio serve a tenere fuori i titoli
          illiquidi: uno che di norma scambia diecimila pezzi arriva a dieci
          volte tanto con un ordine solo, e non significherebbe nulla.
        </p>
      </div>
    </div>
  );
}

/** Dice a che punto della giornata siamo e quanto pesa la correzione */
function SessionNote({ session }: { session: SessionInfo | null }) {
  if (!session) return null;

  if (session.session === 'regular') {
    return (
      <div className="space-y-1">
        <div className="h-1.5 bg-brand-border rounded overflow-hidden">
          <div
            className="h-full bg-brand-green transition-all"
            style={{ width: `${Math.min(100, session.progressPct)}%` }}
          />
        </div>
        <div className="text-xs text-brand-muted break-words">
          New York {session.etTime} · a quest&apos;ora una giornata normale ha
          già scambiato circa il {session.progressPct}% del suo volume, ed è
          con quello che si fa il confronto.
        </div>
      </div>
    );
  }

  if (session.session === 'pre') {
    return (
      <div className="text-xs text-yellow-400 break-words border border-yellow-400/40 rounded p-2">
        Pre-market: i volumi mostrati sono ancora quelli della seduta
        precedente, già chiusa. Diventano quelli di oggi all&apos;apertura,
        alle 15:30 ora italiana.
      </div>
    );
  }

  return (
    <div className="text-xs text-brand-muted break-words">
      New York {session.etTime} · volumi di una seduta completa, confronto
      diretto con la media.
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  rows,
  mode,
  onOpenTicker,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: Row[];
  mode: 'ratio' | 'absolute';
  onOpenTicker: (t: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
            {title}
          </span>
          <span className="text-xs text-brand-muted">({rows.length})</span>
        </div>
        <div className="text-xs text-brand-muted break-words">{subtitle}</div>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-brand-muted">
          Nessun titolo da mostrare.
        </div>
      ) : (
        <div className="divide-y divide-brand-border">
          {rows.map((r, i) => (
            <button
              key={r.ticker}
              onClick={() => onOpenTicker(r.ticker)}
              className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
            >
              <span className="font-mono text-xs text-brand-muted w-5 flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-bold text-sm flex-shrink-0">
                    {r.ticker}
                  </span>
                  {r.name && (
                    <span className="text-xs text-brand-muted truncate">
                      {r.name}
                    </span>
                  )}
                </div>
                <div className="text-xs text-brand-muted font-mono">
                  {fmtVol(r.volume)}
                  {r.avgVolume != null && ` · media ${fmtVol(r.avgVolume)}`}
                  {r.turnover != null && ` · ${fmtMoney(r.turnover)}`}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {mode === 'ratio' ? (
                  <>
                    <div className="font-mono text-sm font-bold text-brand-green">
                      {r.volumeRatio != null
                        ? `${r.volumeRatio.toFixed(1)}×`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-brand-muted">
                      del normale
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-mono text-sm font-bold">
                      {fmtVol(r.volume)}
                    </div>
                    {r.volumeRatio != null && (
                      <div className="text-[10px] text-brand-muted">
                        {r.volumeRatio.toFixed(1)}× del normale
                      </div>
                    )}
                  </>
                )}
              </div>
              {r.changePct != null && (
                <div
                  className={`font-mono text-xs w-14 text-right flex-shrink-0 ${
                    r.changePct >= 0 ? 'text-brand-up' : 'text-brand-down'
                  }`}
                >
                  {r.changePct >= 0 ? '+' : ''}
                  {r.changePct.toFixed(1)}%
                </div>
              )}
              <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0 hidden sm:block" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}Mld`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
}

function fmtMoney(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}Mld`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}k`;
}
