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
  margin_change_pct: number | null;
  verdict_level: string;
  verdict_headline: string;
  verdict_reasons: string[] | null;
  last_report_date: string | null;
  source?: string | null;
};

const TOP_CHOICES = [10, 20, 30] as const;
const DISCOUNT_CHOICES = [10, 15, 25, 40] as const;
const GROWTH_CHOICES = [0, 5, 10] as const;

type Props = { onOpenTicker: (t: string) => void };

export default function ValuationsView({ onOpenTicker }: Props) {
  const [solid, setSolid] = useState<Row[]>([]);
  const [solidTotal, setSolidTotal] = useState(0);
  const [topN, setTopN] = useState<number>(20);
  const [minDiscount, setMinDiscount] = useState<number>(15);
  const [minGrowth, setMinGrowth] = useState<number>(0);
  const [opportunities, setOpportunities] = useState<Row[]>([]);
  const [withCaution, setWithCaution] = useState<Row[]>([]);
  const [analyzed, setAnalyzed] = useState(0);
  const [universeSize, setUniverseSize] = useState(0);
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
      const r = await fetch(
        `/api/valuation?limit=${topN}&minDiscount=${minDiscount}&minGrowth=${minGrowth}`
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
      setSolid(d.solid ?? []);
      setSolidTotal(d.solidTotal ?? 0);
      setOpportunities(d.opportunities ?? []);
      setWithCaution(d.withCaution ?? []);
      setAnalyzed(d.analyzed ?? 0);
      setUniverseSize(d.universeSize ?? 0);
      setLastScan(d.lastScan ?? null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [topN, minDiscount, minGrowth]);

  useEffect(() => {
    load();
  }, [load]);

  async function fill() {
    setFilling(true);
    setErr(null);
    setProgress('Avvio…');
    let saved = 0;
    let guard = 0;
    try {
      // Ogni giro riparte dai titoli ancora scoperti, quindi basta
      // richiamarlo finche' non dice di aver finito. Il limite serve a
      // non lasciare un ciclo infinito se qualcosa va storto.
      while (guard++ < 60) {
        const r = await fetch('/api/valuation/catchup', { method: 'POST' });
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
        saved += d.saved ?? 0;
        setAnalyzed(d.covered ?? 0);
        setUniverseSize(d.universeSize ?? 0);
        setProgress(
          d.done
            ? `Completato · ${saved} titoli valutati`
            : `${d.covered}/${d.universeSize} titoli · ${d.remaining} da fare`
        );
        if (d.done) break;
      }
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
            {universeSize > 0
              ? `${analyzed} titoli su ${universeSize}`
              : `${analyzed} titoli in archivio`}
          </span>
        </div>

        <LastScan at={lastScan} staleAfterHours={480} />

        {universeSize > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 bg-brand-border rounded overflow-hidden">
              <div
                className="h-full bg-brand-green transition-all"
                style={{
                  width: `${Math.min(100, (analyzed / universeSize) * 100)}%`,
                }}
              />
            </div>
            <div className="text-xs text-brand-muted break-words">
              {analyzed >= universeSize
                ? 'Archivio completo: si aggiorna da solo ogni ora.'
                : `L'archivio si riempie da solo a ogni giro del motore. Il pulsante qui sotto serve ad accelerare.`}
            </div>
          </div>
        )}

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
              {analyzed === 0 ? 'Costruisci subito' : 'Accelera ora'}
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
            La SEC limita il ritmo delle richieste, quindi l&apos;analisi dei
            titoli USA procede lentamente; quelli degli altri mercati vanno più
            veloci. Puoi chiudere quando vuoi: il motore riprende da dove sei
            arrivato.
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
            Archivio vuoto. Si riempie da solo nel giro di un paio di
            giorni: bilanci SEC per i titoli USA, Yahoo per gli altri
            mercati. Con <strong>Costruisci subito</strong> lo fai partire
            ora, tenendo la pagina aperta.
          </div>
        </div>
      )}

      {analyzed > 0 && (
        <div className="card p-3 sm:p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-green">
            Filtro della classifica
          </div>
          <Choices
            label="Quanti"
            value={topN}
            choices={TOP_CHOICES}
            onChange={setTopN}
            format={(v) => `Top ${v}`}
          />
          <Choices
            label="Sconto minimo"
            value={minDiscount}
            choices={DISCOUNT_CHOICES}
            onChange={setMinDiscount}
            format={(v) => `${v}%`}
          />
          <Choices
            label="Crescita minima"
            value={minGrowth}
            choices={GROWTH_CHOICES}
            onChange={setMinGrowth}
            format={(v) => (v === 0 ? 'positiva' : `+${v}%`)}
          />
          <div className="text-xs text-brand-muted break-words">
            {solidTotal === 0
              ? 'Nessun titolo supera queste soglie: prova ad abbassarle.'
              : `${solidTotal} titoli superano il filtro in archivio.`}
          </div>
        </div>
      )}

      {solid.length > 0 && (
        <Section
          title={`I ${solid.length} titoli più a sconto con i conti in crescita`}
          subtitle={`sconto di almeno il ${minDiscount}%, utili e fatturato in crescita`}
          rows={solid}
          expanded={expanded}
          setExpanded={setExpanded}
          onOpenTicker={onOpenTicker}
          accent="text-brand-green"
          showMetrics
        />
      )}

      {opportunities.length > 0 && (
        <Section
          title="A sconto, conti non in peggioramento"
          subtitle="filtro più largo: non richiede che entrambe le voci crescano"
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
          La prima classifica chiede tre cose insieme: sconto sul multiplo
          storico, utili in crescita e fatturato in crescita. È il taglio
          più stretto, e un titolo può uscirne per un solo trimestre
          storto.
        </p>
        <p className="break-words">
          Le sezioni successive esistono perché il caso più frequente di
          titolo a sconto è quello in cui il mercato ha ragione: gli utili
          stanno calando e il prezzo li segue. Separarli evita di scambiare
          un problema per un&apos;occasione.
        </p>
        <p className="break-words">
          Uno sconto ampio con i conti in ordine ha quasi sempre una
          spiegazione che i bilanci passati non contengono: un settore
          ciclico al massimo degli utili, una causa in corso, previsioni in
          peggioramento. La classifica serve a scegliere cosa approfondire,
          non a comprare dall&apos;alto in basso.
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
  showMetrics = false,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  expanded: string | null;
  setExpanded: (t: string | null) => void;
  onOpenTicker: (t: string) => void;
  accent: string;
  /** Mostra i numeri chiave sotto il nome, senza dover aprire la riga */
  showMetrics?: boolean;
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
                {showMetrics && <Metrics r={r} />}
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
                <div className="text-xs text-brand-muted break-words">
                  Bilanci {r.source === 'yahoo' ? 'Yahoo' : 'SEC'}
                  {r.last_report_date && ` · ultimo ${r.last_report_date}`}
                </div>
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

/** Riga di scelte a pulsanti: piu' comoda di un menu a tendina sul telefono */
function Choices({
  label,
  value,
  choices,
  onChange,
  format,
}: {
  label: string;
  value: number;
  choices: readonly number[];
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-brand-muted w-28 flex-shrink-0">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {choices.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition border ${
              value === c
                ? 'border-brand-green/60 text-brand-green bg-brand-green/10'
                : 'border-brand-border text-brand-muted'
            }`}
          >
            {format(c)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** I numeri per cui il titolo e' in classifica, senza aprire la riga */
function Metrics({ r }: { r: Row }) {
  const pct = (v: number | null, digits = 0) =>
    v == null ? null : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
  const eps = pct(r.eps_growth_pct);
  const rev = pct(r.revenue_growth_pct);
  const marg = pct(r.margin_change_pct, 1);

  return (
    <div className="flex gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-brand-muted mt-0.5">
      {r.current_pe != null && r.median_pe != null && (
        <span className="font-mono">
          P/E {Number(r.current_pe).toFixed(1)} vs {Number(r.median_pe).toFixed(1)}
        </span>
      )}
      {eps && <span>utili {eps}</span>}
      {rev && <span>ricavi {rev}</span>}
      {marg && <span>margine {marg} punti</span>}
    </div>
  );
}
