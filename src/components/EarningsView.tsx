'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CalendarDays,
  ExternalLink,
  Info,
  Search,
  Loader2,
} from 'lucide-react';
import LastScan from './LastScan';

type Report = {
  id: string;
  ticker: string;
  period_end: string;
  filed_date: string | null;
  eps: number | null;
  revenue: number | null;
  form: string | null;
};

type CalendarEvent = {
  id: string;
  ticker: string;
  report_date: string;
  company_name: string | null;
  timing: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
};

const TIMING_LABEL: Record<string, string> = {
  BMO: 'prima apertura',
  AMC: 'dopo chiusura',
  TAS: 'durante seduta',
  TNS: 'orario non comunicato',
};

type Props = { onOpenTicker: (t: string) => void };

export default function EarningsView({ onOpenTicker }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [justReported, setJustReported] = useState<CalendarEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'reported' | 'past'>('upcoming');
  const [query, setQuery] = useState('');
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/earnings');
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
      setReports(d.reports ?? []);
      setUpcoming(d.upcoming ?? []);
      setJustReported(d.justReported ?? []);
      setLastScan(d.lastScan ?? null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncCalendar() {
    setSyncing(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch('/api/earnings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const text = await r.text();
      const d = text ? JSON.parse(text) : {};
      if (d.error) {
        setErr(d.error);
        return;
      }
      setMsg(`${d.saved} date caricate, dal ${d.from} al ${d.to}`);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSyncing(false);
    }
  }

  // Scarica i trimestri di un singolo titolo senza attendere la
  // costruzione dell'intero archivio
  async function fetchOne() {
    const t = query.trim().toUpperCase();
    if (!t) return;
    setFetching(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await fetch(`/api/earnings/${encodeURIComponent(t)}`);
      const text = await r.text();
      const d = text ? JSON.parse(text) : {};
      if (d.error) {
        setErr(d.error);
        return;
      }
      if (!d.reports || d.reports.length === 0) {
        setMsg(d.reason ?? `Nessun trimestre trovato per ${t}.`);
        return;
      }
      setMsg(
        `${d.reports.length} trimestri caricati per ${t}` +
          (d.nextReportEstimate
            ? ` · prossimo atteso ${d.nextReportEstimate}`
            : '')
      );
      setTab('past');
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setFetching(false);
    }
  }

  function daysTo(dateStr: string): number {
    return Math.round(
      (new Date(dateStr).getTime() - Date.now()) / 86400000
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Trimestrali</span>
          <span className="text-xs text-brand-muted">
            {reports.length} pubblicate · {upcoming.length} attese
          </span>
        </div>

        <LastScan at={lastScan} staleAfterHours={480} />

        <div className="flex items-center gap-1 bg-brand-panel rounded p-0.5 w-fit">
          {(['upcoming', 'reported', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                tab === t
                  ? 'bg-brand-green text-black'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              {t === 'upcoming'
                ? 'In arrivo'
                : t === 'reported'
                  ? 'Appena uscite'
                  : 'Storico'}
            </button>
          ))}
        </div>

        <button
          onClick={syncCalendar}
          disabled={syncing}
          className="btn-primary w-full py-2 text-xs disabled:opacity-50"
        >
          {syncing ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aggiorno il
              calendario…
            </span>
          ) : (
            'Aggiorna calendario'
          )}
        </button>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-brand-muted absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchOne();
              }}
              placeholder="Carica un titolo (es. IBM)"
              className="input w-full text-xs py-1.5 pl-7 font-mono"
              autoCapitalize="characters"
            />
          </div>
          <button
            onClick={fetchOne}
            disabled={fetching || !query.trim()}
            className="btn-ghost text-xs flex-shrink-0 disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              'Carica'
            )}
          </button>
        </div>

        {msg && (
          <div className="text-xs text-brand-green break-words">{msg}</div>
        )}
        {err && (
          <div className="text-xs text-brand-down break-words border border-brand-down/40 rounded p-2">
            {err}
          </div>
        )}
      </div>

      {loading && reports.length === 0 && upcoming.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && reports.length === 0 && upcoming.length === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">📅</div>
          <div className="text-sm text-brand-muted break-words">
            Archivio vuoto. Puoi caricare un titolo alla volta con la
            ricerca qui sopra, oppure popolare tutto insieme costruendo
            l&apos;archivio in <strong>Valutazioni</strong>.
          </div>
        </div>
      )}

      {tab === 'upcoming' && upcoming.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Date annunciate dalle società
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {upcoming.map((u) => {
              const gg = daysTo(u.report_date);
              const imminente = gg <= 7;
              return (
                <button
                  key={u.id}
                  onClick={() => onOpenTicker(u.ticker)}
                  className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{u.ticker}</span>
                      {imminente && (
                        <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
                          imminente
                        </span>
                      )}
                      {u.timing && (
                        <span className="text-xs text-brand-muted">
                          {TIMING_LABEL[u.timing] ?? u.timing}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-muted truncate mt-0.5">
                      {u.company_name ?? ''}
                      {u.eps_estimate != null && (
                        <> · atteso {Number(u.eps_estimate).toFixed(2)}</>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`font-mono text-sm font-bold ${
                        imminente ? 'text-yellow-400' : ''
                      }`}
                    >
                      {new Date(u.report_date).toLocaleDateString('it-IT', {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </div>
                    <div className="text-[10px] text-brand-muted">
                      {gg === 0
                        ? 'oggi'
                        : `fra ${gg} ${gg === 1 ? 'giorno' : 'giorni'}`}
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'reported' && justReported.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Pubblicate di recente · scarto rispetto alle attese
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {justReported.map((r) => {
              const sur = r.surprise_pct != null ? Number(r.surprise_pct) : null;
              return (
                <button
                  key={r.id}
                  onClick={() => onOpenTicker(r.ticker)}
                  className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{r.ticker}</span>
                      <span className="text-xs text-brand-muted">
                        {new Date(r.report_date).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="text-xs text-brand-muted font-mono mt-0.5">
                      {r.eps_actual != null && (
                        <>pubblicato {Number(r.eps_actual).toFixed(2)}</>
                      )}
                      {r.eps_estimate != null && (
                        <> · atteso {Number(r.eps_estimate).toFixed(2)}</>
                      )}
                    </div>
                  </div>
                  {sur != null && (
                    <div className="text-right flex-shrink-0">
                      <div
                        className={`font-mono text-sm font-bold ${
                          sur >= 0 ? 'text-brand-up' : 'text-brand-down'
                        }`}
                      >
                        {sur >= 0 ? '+' : ''}
                        {sur.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-brand-muted">
                        sulle attese
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'past' && reports.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Ultime pubblicate · date di deposito reali
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenTicker(r.ticker)}
                className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-sm">{r.ticker}</span>
                    {r.form && (
                      <span className="tag bg-brand-panel text-brand-muted text-xs">
                        {r.form}
                      </span>
                    )}
                    <span className="text-xs text-brand-muted">
                      trimestre al {r.period_end}
                    </span>
                  </div>
                  <div className="text-xs text-brand-muted font-mono mt-0.5">
                    depositato {r.filed_date ?? '—'}
                    {r.revenue != null && (
                      <> · ricavi {fmtMoney(Number(r.revenue))}</>
                    )}
                  </div>
                </div>
                {r.eps != null && (
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`font-mono text-sm font-bold ${
                        Number(r.eps) >= 0 ? 'text-brand-up' : 'text-brand-down'
                      }`}
                    >
                      {Number(r.eps).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-brand-muted">
                      utile per azione
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Da dove arrivano
        </div>
        <p className="break-words">
          I trimestri pubblicati vengono dai bilanci depositati alla SEC, gli
          stessi già scaricati per le valutazioni: nessuna richiesta in più.
          Le date di deposito sono quelle reali.
        </p>
        <p className="break-words">
          Le date in arrivo sono quelle <strong>annunciate dalle
          società</strong>, prese dal calendario di Yahoo. Accanto trovi
          quando pubblicano — prima dell&apos;apertura o dopo la chiusura —
          e l&apos;utile atteso dagli analisti.
        </p>
        <p className="break-words">
          Utile soprattutto per un motivo: un segnale tecnico a pochi giorni
          dalla pubblicazione conta poco, perché il prezzo si muoverà per la
          notizia e non per il grafico.
        </p>
      </div>
    </div>
  );
}

function fmtMoney(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} mld`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)} mln`;
  return v.toFixed(0);
}
