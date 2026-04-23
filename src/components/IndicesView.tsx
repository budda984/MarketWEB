'use client';

import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';

/**
 * Indici principali raggruppati per area.
 * Symbol: usato per fetch Yahoo Finance.
 * Name: label visibile.
 */
type IndexDef = {
  symbol: string;
  name: string;
  region: 'USA' | 'Europa' | 'Asia' | 'Volatilità' | 'Bond';
};

const INDICES: IndexDef[] = [
  // USA
  { symbol: '^GSPC', name: 'S&P 500', region: 'USA' },
  { symbol: '^IXIC', name: 'NASDAQ Composite', region: 'USA' },
  { symbol: '^DJI', name: 'Dow Jones Industrial', region: 'USA' },
  { symbol: '^RUT', name: 'Russell 2000', region: 'USA' },
  // Europa
  { symbol: 'FTSEMIB.MI', name: 'FTSE MIB (Milano)', region: 'Europa' },
  { symbol: '^GDAXI', name: 'DAX (Francoforte)', region: 'Europa' },
  { symbol: '^FCHI', name: 'CAC 40 (Parigi)', region: 'Europa' },
  { symbol: '^FTSE', name: 'FTSE 100 (Londra)', region: 'Europa' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', region: 'Europa' },
  { symbol: '^IBEX', name: 'IBEX 35 (Madrid)', region: 'Europa' },
  // Asia
  { symbol: '^N225', name: 'Nikkei 225 (Tokyo)', region: 'Asia' },
  { symbol: '^HSI', name: 'Hang Seng (Hong Kong)', region: 'Asia' },
  { symbol: '000001.SS', name: 'Shanghai Composite', region: 'Asia' },
  // Volatilità
  { symbol: '^VIX', name: 'VIX (Volatility Index)', region: 'Volatilità' },
  // Bond yield
  { symbol: '^TNX', name: 'US 10Y Treasury Yield', region: 'Bond' },
  { symbol: '^TYX', name: 'US 30Y Treasury Yield', region: 'Bond' },
];

type IndexData = {
  symbol: string;
  price: number;
  changePct: number;
  currency?: string;
} | null;

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function IndicesView({ onOpenTicker }: Props) {
  const [data, setData] = useState<Map<string, IndexData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    const results = await Promise.all(
      INDICES.map(async (idx) => {
        try {
          const r = await fetch(
            `/api/quote/${encodeURIComponent(idx.symbol)}?tf=1d`
          );
          const text = await r.text();
          if (!text) return { symbol: idx.symbol, data: null };
          const d = JSON.parse(text);
          if (d.error || !d.quote) return { symbol: idx.symbol, data: null };
          return {
            symbol: idx.symbol,
            data: {
              symbol: idx.symbol,
              price: d.quote.price,
              changePct: d.quote.changePct,
              currency: d.quote.currency,
            },
          };
        } catch {
          return { symbol: idx.symbol, data: null };
        }
      })
    );
    const map = new Map<string, IndexData>();
    for (const r of results) {
      map.set(r.symbol, r.data);
    }
    setData(map);
    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Auto-refresh ogni 2 minuti
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, []);

  const byRegion = useMemo(() => {
    const map = new Map<string, IndexDef[]>();
    for (const idx of INDICES) {
      const list = map.get(idx.region) ?? [];
      list.push(idx);
      map.set(idx.region, list);
    }
    return map;
  }, []);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="card p-3 sm:p-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Indici principali</span>
          <span className="text-xs text-brand-muted hidden sm:inline">
            {INDICES.length} indici · aggiornamento ogni 2 min
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
            title="Ricarica"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sezioni per regione */}
      {Array.from(byRegion.entries()).map(([region, items]) => (
        <div key={region} className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              {region}
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {items.map((idx) => {
              const d = data.get(idx.symbol);
              const up = d != null && d.changePct >= 0;
              return (
                <button
                  key={idx.symbol}
                  onClick={() => onOpenTicker(idx.symbol)}
                  className="w-full flex items-center gap-3 p-3 sm:p-4 hover:bg-brand-card/40 transition text-left group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-brand-muted flex-shrink-0">
                        {idx.symbol}
                      </span>
                      <span className="text-sm font-medium truncate group-hover:text-brand-green transition">
                        {idx.name}
                      </span>
                    </div>
                  </div>
                  {d ? (
                    <>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono font-bold text-sm sm:text-base">
                          {d.price.toFixed(2)}
                        </div>
                        {d.currency && (
                          <div className="text-xs text-brand-muted">
                            {d.currency}
                          </div>
                        )}
                      </div>
                      <div
                        className={`flex items-center gap-0.5 font-mono text-sm font-semibold min-w-[70px] justify-end ${
                          up ? 'text-brand-up' : 'text-brand-down'
                        }`}
                      >
                        {up ? (
                          <TrendingUp className="w-3.5 h-3.5" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5" />
                        )}
                        {d.changePct >= 0 ? '+' : ''}
                        {d.changePct.toFixed(2)}%
                      </div>
                    </>
                  ) : loading ? (
                    <span className="text-xs text-brand-muted">…</span>
                  ) : (
                    <span className="text-xs text-brand-muted">n/d</span>
                  )}
                  <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-brand-muted text-center py-2">
        Click su un indice per aprire il chart. Dati Yahoo Finance, ritardo ~15 min.
      </p>
    </div>
  );
}
