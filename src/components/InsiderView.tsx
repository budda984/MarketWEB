'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Briefcase,
  Loader2,
  RefreshCw,
  ExternalLink,
  Users,
  Info,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

type Trade = {
  id: string;
  ticker: string | null;
  issuer_name: string | null;
  owner_name: string;
  owner_title: string | null;
  is_director: boolean;
  is_officer: boolean;
  is_ten_percent: boolean;
  transaction_date: string | null;
  filed_date: string | null;
  transaction_code: string | null;
  acquired_disposed: string | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  shares_owned_after: number | null;
  filing_url: string | null;
};

type Cluster = {
  ticker: string;
  issuerName: string | null;
  distinctOwners: number;
  transactions: number;
  totalValue: number;
  lastDate: string | null;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

const CODE_LABEL: Record<string, string> = {
  P: 'Acquisto a mercato',
  S: 'Vendita',
  A: 'Assegnazione',
  M: 'Esercizio opzioni',
  F: 'Trattenuta fiscale',
  G: 'Donazione',
};

export default function InsiderView({ onOpenTicker }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [code, setCode] = useState('P');
  const [days, setDays] = useState(90);
  const [minValue, setMinValue] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/insider?days=${days}&code=${code}&minValue=${minValue}`
      );
      const text = await res.text();
      if (!text) {
        setErr('Nessuna risposta dal server.');
        return;
      }
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      setTrades(d.trades ?? []);
      setClusters(d.clusters ?? []);
      setTotalRows(d.totalRows ?? 0);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [days, code, minValue]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/insider/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 3 }),
      });
      const text = await res.text();
      const d = text ? JSON.parse(text) : {};
      if (d.error) {
        setErr(d.error);
        return;
      }
      const s = d.stats;
      setSyncMsg(
        `${s.filingsParsed} depositi elaborati su ${s.filingsMatched} pertinenti · ${s.rowsUpserted} righe · ${(s.elapsedMs / 1000).toFixed(1)}s`
      );
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header + controlli */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Insider SEC</span>
            <span className="text-xs text-brand-muted">
              {totalRows} operazioni archiviate
            </span>
          </div>
          <button
            onClick={sync}
            disabled={syncing}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {syncing ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scarico da SEC…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Aggiorna da SEC
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Tipo:</span>
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input text-xs py-1"
            >
              <option value="P">Acquisti a mercato</option>
              <option value="S">Vendite</option>
              <option value="ALL">Tutti i codici</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Periodo:</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={30}>30 giorni</option>
              <option value={90}>90 giorni</option>
              <option value={180}>6 mesi</option>
              <option value={365}>1 anno</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Importo min:</span>
            <select
              value={minValue}
              onChange={(e) => setMinValue(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={0}>qualsiasi</option>
              <option value={50000}>$50k</option>
              <option value={250000}>$250k</option>
              <option value={1000000}>$1M</option>
            </select>
          </label>
        </div>

        {syncMsg && (
          <div className="text-xs text-brand-green">{syncMsg}</div>
        )}
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down">
          {err}
        </div>
      )}

      {totalRows === 0 && !loading && !err && (
        <div className="card p-6 text-center space-y-2">
          <div className="text-4xl">🗂️</div>
          <div className="text-sm text-brand-muted">
            Archivio vuoto. Premi <strong>Aggiorna da SEC</strong> per
            scaricare gli ultimi giorni di Form 4.
          </div>
          <div className="text-xs text-brand-muted">
            Ogni esecuzione copre 3 giorni lavorativi. Lanciala piu volte per
            costruire lo storico.
          </div>
        </div>
      )}

      {/* Cluster */}
      {clusters.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-brand-green" />
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Acquisti multipli
            </span>
            <span className="text-xs text-brand-muted">
              due o piu insider distinti
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {clusters.map((c) => (
              <button
                key={c.ticker}
                onClick={() => onOpenTicker(c.ticker)}
                className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-sm">{c.ticker}</span>
                    <span className="tag bg-brand-green/20 text-brand-green text-xs">
                      {c.distinctOwners} insider
                    </span>
                  </div>
                  <div className="text-xs text-brand-muted truncate">
                    {c.issuerName} · {c.transactions} operazioni · ultima{' '}
                    {c.lastDate}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono text-sm font-bold text-brand-up">
                    {fmtMoney(c.totalValue)}
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Elenco operazioni */}
      {loading && trades.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          Caricamento…
        </div>
      )}

      {trades.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Operazioni ({trades.length})
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {trades.map((t) => {
              const isBuy = t.acquired_disposed === 'A';
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3"
                >
                  {isBuy ? (
                    <ArrowUpRight className="w-4 h-4 text-brand-up flex-shrink-0" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-brand-down flex-shrink-0" />
                  )}
                  <button
                    onClick={() => t.ticker && onOpenTicker(t.ticker)}
                    className="flex-1 min-w-0 text-left group"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm group-hover:text-brand-green transition">
                        {t.ticker ?? '—'}
                      </span>
                      <span className="text-xs text-brand-muted truncate">
                        {t.owner_name}
                      </span>
                      {t.owner_title && (
                        <span className="tag bg-brand-panel text-brand-muted text-xs">
                          {t.owner_title}
                        </span>
                      )}
                      {t.is_ten_percent && (
                        <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
                          &gt;10%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-muted mt-0.5 font-mono">
                      {t.transaction_date} ·{' '}
                      {CODE_LABEL[t.transaction_code ?? ''] ??
                        t.transaction_code}{' '}
                      · {fmtNum(t.shares)} az. a{' '}
                      {t.price != null ? `$${t.price.toFixed(2)}` : '—'}
                    </div>
                  </button>
                  <div className="text-right flex-shrink-0">
                    <div
                      className={`font-mono text-sm font-bold ${
                        isBuy ? 'text-brand-up' : 'text-brand-down'
                      }`}
                    >
                      {fmtMoney(t.value)}
                    </div>
                    {t.filing_url && (
                      <a
                        href={t.filing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-muted hover:text-brand-green"
                      >
                        deposito
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nota */}
      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come leggerlo
        </div>
        <p>
          Solo il codice <strong>P</strong> è un acquisto vero a mercato. Le
          assegnazioni (A) e gli esercizi di opzioni (M) sono retribuzione,
          non una scommessa sul titolo: per questo il filtro predefinito
          li esclude.
        </p>
        <p>
          Le vendite sono un segnale molto più debole degli acquisti: un
          dirigente vende per mille ragioni personali, mentre compra
          essenzialmente per una sola.
        </p>
        <p>
          I Form 4 arrivano entro due giorni lavorativi dall&apos;operazione.
          L&apos;acquisto da parte di insider ha una capacità predittiva
          documentata ma modesta e rumorosa: è un elemento in più, non una
          ragione sufficiente per operare.
        </p>
      </div>
    </div>
  );
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('it-IT');
}
