'use client';

import { useEffect, useState } from 'react';
import { Scale, Loader2 } from 'lucide-react';

type Valuation = {
  ticker: string;
  verdict_level: string;
  verdict_headline: string;
  verdict_reasons: string[] | null;
  pe_discount_pct: number | null;
  last_report_date: string | null;
  /** Fonte dei bilanci; assente nelle righe salvate prima della 017 */
  source?: string | null;
};

const STYLE: Record<string, string> = {
  occasione: 'border-brand-green/40 text-brand-green',
  sconto_con_riserva: 'border-yellow-400/40 text-yellow-400',
  in_linea: 'border-brand-border text-brand-text',
  caro_ma_in_crescita: 'border-yellow-400/40 text-yellow-400',
  caro: 'border-brand-down/40 text-brand-down',
  non_valutabile: 'border-brand-border text-brand-muted',
};

export default function ValuationCard({ ticker }: { ticker: string }) {
  const [v, setV] = useState<Valuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setV(null);
    setReason(null);
    fetch(`/api/valuation/${encodeURIComponent(ticker)}`)
      .then((r) => r.text())
      .then((text) => {
        if (cancel || !text) return;
        const d = JSON.parse(text);
        if (d.valuation) setV(d.valuation);
        else setReason(d.reason ?? d.error ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [ticker]);

  if (loading) {
    return (
      <div className="card p-3 text-xs text-brand-muted flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Analisi dei bilanci…
      </div>
    );
  }

  if (!v) {
    if (!reason) return null;
    return (
      <div className="card p-3 text-xs text-brand-muted break-words">
        <Scale className="w-3.5 h-3.5 inline mr-1.5" />
        {reason}
      </div>
    );
  }

  const style = STYLE[v.verdict_level] ?? STYLE.in_linea;

  return (
    <div className={`card p-3 sm:p-4 border ${style} space-y-2`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Scale className="w-4 h-4 flex-shrink-0" />
        <span className="font-semibold text-sm">{v.verdict_headline}</span>
        {v.pe_discount_pct != null && (
          <span className="font-mono text-xs">
            {v.pe_discount_pct >= 0 ? '−' : '+'}
            {Math.abs(Number(v.pe_discount_pct)).toFixed(0)}% sul multiplo
            storico
          </span>
        )}
      </div>

      {v.verdict_reasons && v.verdict_reasons.length > 0 && (
        <ul className="space-y-0.5">
          {v.verdict_reasons.map((r, i) => (
            <li key={i} className="text-xs text-brand-muted break-words">
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="text-[10px] text-brand-muted/70 break-words">
        Confronto con la valutazione storica del titolo, da bilanci{' '}
        {v.source === 'yahoo' ? 'Yahoo' : 'SEC'}
        {v.last_report_date && ` · ultimo bilancio ${v.last_report_date}`}. Non
        è una previsione sul prezzo.
      </div>
    </div>
  );
}
