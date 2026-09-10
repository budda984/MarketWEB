'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, ExternalLink, Info, AlertTriangle } from 'lucide-react';
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

type Upcoming = {
  ticker: string;
  next_report_estimate: string;
  cadence_days: number | null;
  last_report_date: string | null;
};

type Props = { onOpenTicker: (t: string) => void };

export default function EarningsView({ onOpenTicker }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

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
          {(['upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                tab === t
                  ? 'bg-brand-green text-black'
                  : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              {t === 'upcoming' ? 'In arrivo' : 'Pubblicate'}
            </button>
          ))}
        </div>

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
            Nessun dato. I trimestri si popolano insieme alle valutazioni:
            vai in <strong>Valutazioni</strong> e costruisci l&apos;archivio.
          </div>
        </div>
      )}

      {tab === 'upcoming' && upcoming.length > 0 && (
        <>
          <div className="card p-3 border border-yellow-400/30 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-brand-muted break-words">
              <strong className="text-yellow-400">Date stimate.</strong> Le
              date delle prossime trimestrali sono annunci aziendali e non
              compaiono nei bilanci depositati. Queste sono ricavate dalla
              cadenza dei depositi precedenti: servono a sapere se una
              pubblicazione è vicina, non a segnarsela in agenda. Lo scarto
              può essere di una o due settimane.
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="divide-y divide-brand-border">
              {upcoming.map((u) => {
                const gg = daysTo(u.next_report_estimate);
                const imminente = gg <= 10;
                return (
                  <button
                    key={u.ticker}
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
                      </div>
                      <div className="text-xs text-brand-muted font-mono mt-0.5">
                        ultimo bilancio {u.last_report_date ?? '—'}
                        {u.cadence_days && (
                          <> · ogni {Math.round(Number(u.cadence_days))} giorni</>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className={`font-mono text-sm font-bold ${
                          imminente ? 'text-yellow-400' : ''
                        }`}
                      >
                        {new Date(u.next_report_estimate).toLocaleDateString(
                          'it-IT',
                          { day: '2-digit', month: '2-digit' }
                        )}
                      </div>
                      <div className="text-[10px] text-brand-muted">
                        fra {gg} {gg === 1 ? 'giorno' : 'giorni'}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </>
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
          Le date in arrivo sono <strong>stime</strong>, ricavate dalla
          cadenza dei depositi precedenti scartando gli intervalli anomali.
          Per date confermate servirebbe una fonte esterna con chiave di
          accesso.
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
