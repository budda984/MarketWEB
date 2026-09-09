'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Scale,
  Loader2,
  Play,
  ExternalLink,
  Info,
  AlertTriangle,
} from 'lucide-react';
import LastScan from './LastScan';

type Row = {
  ticker: string;
  price: number | null;
  current_pe: number | null;
  median_pe: number | null;
  pe_discount_pct: number | null;
  eps_growth_pct: number | null;
  revenue_growth_pct: number | null;
  verdict_level: string;
  verdict_headline: string;
  verdict_reasons: string[] | null;
  last_report_date: string | null;
};

type Props = { onOpenTicker: (t: string) => void };

export default function ValuationsView({ onOpenTicker }: Props) {
  const [opportunities, setOpportunities] = useState<Row[]>([]);
  const [withCaution, setWithCaution] = useState<Row[]>([]);
  const [analyzed, setAnalyzed] = useState(0);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/valuation?limit=10');
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
      setOpportunities(d.opportunities ?? []);
      setWithCaution(d.withCaution ?? []);
      setAnalyzed(d.analyzed ?? 0);
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

  async function fill() {
    setFilling(true);
    setErr(null);
    setProgress('Avvio…');
    let offset = 0;
    let guard = 0;
    let saved = 0;
    try {
      // I limiti della SEC impongono un ritmo lento: servono molte
      // chiamate, e l'archivio si costruisce progressivamente
      while (guard++ < 60) {
        const r = await fetch('/api/valuation/fill', {
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
        saved += d.stats.saved ?? 0;
        setProgress(
          `${d.stats.processedUpTo}/${d.stats.universeSize} titoli · ${saved} valutati`
        );
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setProgress(`Completato · ${saved} titoli valutati`);
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setFilling(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Scale className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Occasioni per valutazione</span>
          <span className="text-xs text-brand-muted">
            {analyzed} titoli in archivio
          </span>
        </div>

        <LastScan at={lastScan} staleAfterHours={480} />

        <button
          onClick={fill}
          disabled={filling}
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
        >
          {filling ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisi bilanci…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Play className="w-3.5 h-3.5" />
              {analyzed === 0 ? 'Costruisci archivio' : 'Aggiorna archivio'}
            </span>
          )}
        </button>

        {filling && (
          <div className="text-xs text-brand-green flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="break-words">{progress ?? 'Avvio…'}</span>
          </div>
        )}
        {!filling && progress && !err && (
          <div className="text-xs text-brand-green break-words">{progress}</div>
        )}
        {err && (
          <div className="text-xs text-brand-down break-words border border-brand-down/40 rounded p-2">
            {err}
          </div>
        )}
        {filling && (
          <div className="text-xs text-brand-muted break-words">
            La SEC limita il ritmo delle richieste, quindi l&apos;analisi
            procede lentamente: puoi lasciarla lavorare e tornare più tardi.
          </div>
        )}
      </div>

      {loading && analyzed === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {!loading && analyzed === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">⚖️</div>
          <div className="text-sm text-brand-muted break-words">
            Archivio vuoto. Premi <strong>Costruisci archivio</strong> per
            analizzare i bilanci depositati alla SEC.
          </div>
        </div>
      )}

      {opportunities.length > 0 && (
        <Section
          title="Le prime dieci occasioni"
          subtitle="a sconto sulla propria storia, senza deterioramento dei conti"
          rows={opportunities}
          expanded={expanded}
          setExpanded={setExpanded}
          onOpenTicker={onOpenTicker}
          accent="text-brand-green"
        />
      )}

      {withCaution.length > 0 && (
        <Section
          title="A sconto, ma con riserva"
          subtitle="costano poco perché i conti stanno peggiorando"
          rows={withCaution}
          expanded={expanded}
          setExpanded={setExpanded}
          onOpenTicker={onOpenTicker}
          accent="text-yellow-400"
        />
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Cosa significa &quot;a sconto&quot;
        </div>
        <p className="break-words">
          Il confronto è fra quanto il titolo costa oggi in rapporto ai suoi
          utili e quanto è costato mediamente negli ultimi anni. È un
          giudizio sul <strong>prezzo relativo alla sua storia</strong>, non
          una previsione: dice che è più economico del solito, non che
          salirà.
        </p>
        <p className="break-words">
          La seconda sezione esiste perché il caso più frequente di titolo a
          sconto è quello in cui il mercato ha ragione: gli utili stanno
          calando e il prezzo li segue. Separarli evita di scambiare un
          problema per un&apos;occasione.
        </p>
        <p className="break-words">
          Le aziende in perdita non sono valutabili con questo metodo e non
          compaiono. Restano fuori anche i multipli storici costruiti su
          pochi trimestri, dove la mediana non sarebbe affidabile.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  expanded,
  setExpanded,
  onOpenTicker,
  accent,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  expanded: string | null;
  setExpanded: (t: string | null) => void;
  onOpenTicker: (t: string) => void;
  accent: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
        <div className={`text-xs font-semibold uppercase tracking-wide ${accent}`}>
          {title}
        </div>
        <div className="text-xs text-brand-muted break-words">{subtitle}</div>
      </div>
      <div className="divide-y divide-brand-border">
        {rows.map((r, i) => (
          <div key={r.ticker}>
            <button
              onClick={() => setExpanded(expanded === r.ticker ? null : r.ticker)}
              className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
            >
              <span className="font-mono text-xs text-brand-muted w-5 flex-shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{r.ticker}</div>
                <div className="text-xs text-brand-muted break-words">
                  {r.verdict_headline}
                </div>
              </div>
              {r.pe_discount_pct != null && (
                <div className="text-right flex-shrink-0">
                  <div className={`font-mono text-sm font-bold ${accent}`}>
                    −{Math.abs(Number(r.pe_discount_pct)).toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-brand-muted">
                    sul suo storico
                  </div>
                </div>
              )}
            </button>

            {expanded === r.ticker && (
              <div className="px-3 sm:px-4 pb-3 space-y-2 bg-brand-panel/20">
                {r.verdict_reasons?.map((reason, k) => (
                  <div key={k} className="text-xs text-brand-muted break-words">
                    {reason}
                  </div>
                ))}
                <button
                  onClick={() => onOpenTicker(r.ticker)}
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
  );
}
