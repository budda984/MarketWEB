'use client';

import { useState } from 'react';
import {
  Radar,
  Loader2,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Check,
  X,
  Info,
} from 'lucide-react';
import { MARKETS, type MarketKey } from '@/lib/tickers';

type SectorStrength = {
  etf: string;
  name: string;
  perf1m: number | null;
  perf3m: number | null;
  perf6m: number | null;
  rsVsBenchmark: number | null;
  score: number;
  rank: number;
};

type TrendChecks = {
  priceAboveMa150: boolean;
  priceAboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma50AboveMa150: boolean;
  ma200Rising: boolean;
  priceAbove52wLow: boolean;
  priceNear52wHigh: boolean;
  priceAboveMa50: boolean;
};

type ScreenerResult = {
  ticker: string;
  market: string | null;
  sectorEtf: string | null;
  sectorName: string | null;
  sectorRank: number | null;
  price: number;
  ma50: number | null;
  ma200: number | null;
  perf1m: number | null;
  perf3m: number | null;
  rsVsSector: number | null;
  rsi14: number | null;
  distFrom52wHigh: number;
  distFromMa50: number;
  checks: TrendChecks;
  trendScore: number;
  momentumScore: number;
  pullbackScore: number;
  discountScore: number;
  totalScore: number;
  valueInTrendScore: number;
  trendTemplatePass: boolean;
  inPullback: boolean;
};

type Stats = {
  universeSize: number;
  downloaded: number;
  emptyDownloads: number;
  tooShort: number;
  analyzed: number;
  matching: number;
  returned: number;
  elapsedMs: number;
  topSectorNames: string[];
};

type SortMode = 'value' | 'score' | 'momentum';

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function ScreenerView({ onOpenTicker }: Props) {
  const [selectedMarkets, setSelectedMarkets] = useState<MarketKey[]>([
    'S&P 500' as MarketKey,
  ]);
  const [onlyTrendPass, setOnlyTrendPass] = useState(true);
  const [onlyPullback, setOnlyPullback] = useState(false);
  const [topSectors, setTopSectors] = useState(3);
  const [sortBy, setSortBy] = useState<SortMode>('value');
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sectors, setSectors] = useState<SectorStrength[]>([]);
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets: selectedMarkets,
          topSectors,
          sortBy,
          onlyTrendPass,
          onlyPullback,
          limit: 60,
        }),
      });
      const text = await res.text();
      if (!text) {
        setErr('Nessuna risposta dal server (timeout?). Prova con meno mercati.');
        return;
      }
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      setSectors(d.sectors ?? []);
      setResults(d.results ?? []);
      setStats(d.stats ?? null);
      setWarning(d.warning ?? null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleMarket(m: MarketKey) {
    setSelectedMarkets((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  const totalTickers = selectedMarkets.reduce(
    (s, m) => s + ((MARKETS[m] as readonly string[])?.length ?? 0),
    0
  );

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Configurazione */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Screener</span>
          <span className="text-xs text-brand-muted hidden sm:inline">
            trend forte + settore forte + pullback
          </span>
        </div>

        <div>
          <div className="text-xs text-brand-muted font-semibold uppercase tracking-wide mb-1.5">
            Mercati ({totalTickers} ticker)
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(MARKETS) as MarketKey[]).map((m) => (
              <button
                key={m}
                onClick={() => toggleMarket(m)}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  selectedMarkets.includes(m)
                    ? 'bg-brand-green text-black'
                    : 'bg-brand-panel/40 text-brand-muted hover:bg-brand-card'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {totalTickers > 350 && (
            <p className="text-xs text-yellow-400 mt-1.5">
              Con più di ~350 ticker lo screener può superare i 60s di Vercel.
              Meglio procedere per mercati singoli.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Settori in testa:</span>
            <select
              value={topSectors}
              onChange={(e) => setTopSectors(Number(e.target.value))}
              className="input text-xs py-1"
            >
              <option value={2}>primi 2</option>
              <option value={3}>primi 3</option>
              <option value={4}>primi 4</option>
              <option value={5}>primi 5</option>
              <option value={0}>tutti</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Ordina per:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              className="input text-xs py-1"
            >
              <option value="value">Sconto nel trend</option>
              <option value="score">Punteggio totale</option>
              <option value="momentum">Momentum</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={onlyTrendPass}
              onChange={(e) => setOnlyTrendPass(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Solo trend template superato
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={onlyPullback}
              onChange={(e) => setOnlyPullback(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Solo in pullback
          </label>
          <button
            onClick={run}
            disabled={loading || selectedMarkets.length === 0}
            className="btn-primary text-xs ml-auto disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizzo…
              </span>
            ) : (
              'Esegui screening'
            )}
          </button>
        </div>

        {stats && !loading && (
          <div className="text-xs text-brand-muted space-y-0.5">
            <div>
              Settori: {stats.topSectorNames.join(', ') || '—'}
            </div>
            <div>
              {stats.universeSize} titoli nei settori · {stats.analyzed}{' '}
              analizzati · {stats.matching} corrispondenti ·{' '}
              {(stats.elapsedMs / 1000).toFixed(1)}s
              {stats.emptyDownloads > 0 && (
                <span className="text-yellow-400">
                  {' '}· {stats.emptyDownloads} download falliti
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down">
          {err}
        </div>
      )}

      {warning && !err && (
        <div className="card p-3 border border-yellow-400/40 text-xs text-yellow-400">
          {warning}
        </div>
      )}

      {/* Classifica settori */}
      {sectors.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border flex items-center justify-between">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Rotazione settoriale
            </span>
            <span className="text-xs text-brand-muted">vs SPY · 3 mesi</span>
          </div>
          <div className="divide-y divide-brand-border">
            {sectors.map((s) => (
              <button
                key={s.etf}
                onClick={() => onOpenTicker(s.etf)}
                className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-brand-card/40 transition text-left"
              >
                <span
                  className={`font-mono text-xs w-6 flex-shrink-0 ${
                    s.rank <= 3 ? 'text-brand-green font-bold' : 'text-brand-muted'
                  }`}
                >
                  {s.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-brand-muted font-mono">
                    {s.etf}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 w-16">
                  <div className="text-xs text-brand-muted">3m</div>
                  <div
                    className={`font-mono text-sm ${
                      (s.perf3m ?? 0) >= 0 ? 'text-brand-up' : 'text-brand-down'
                    }`}
                  >
                    {fmtPct(s.perf3m)}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 w-16">
                  <div className="text-xs text-brand-muted">vs SPY</div>
                  <div
                    className={`font-mono text-sm ${
                      (s.rsVsBenchmark ?? 0) >= 0
                        ? 'text-brand-up'
                        : 'text-brand-down'
                    }`}
                  >
                    {fmtPct(s.rsVsBenchmark)}
                  </div>
                </div>
                <ScoreBadge value={s.score} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Risultati titoli */}
      {results.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Titoli ({results.length})
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {results.map((r) => (
              <div key={r.ticker}>
                <button
                  onClick={() =>
                    setExpanded(expanded === r.ticker ? null : r.ticker)
                  }
                  className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{r.ticker}</span>
                      {r.sectorName && (
                        <span className="tag bg-brand-panel text-brand-muted text-xs">
                          {r.sectorName}
                          {r.sectorRank ? ` #${r.sectorRank}` : ''}
                        </span>
                      )}
                      {r.inPullback && (
                        <span className="tag bg-yellow-400/20 text-yellow-400 text-xs">
                          pullback
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-brand-muted mt-0.5 font-mono">
                      {r.price.toFixed(2)} · RSI {r.rsi14?.toFixed(0) ?? '—'} ·{' '}
                      <span className="text-yellow-400">
                        −{r.distFrom52wHigh.toFixed(0)}% dal max 52w
                      </span>{' '}
                      · MA50 {r.distFromMa50 >= 0 ? '+' : ''}
                      {r.distFromMa50.toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 hidden sm:block w-16">
                    <div className="text-xs text-brand-muted">3m</div>
                    <div
                      className={`font-mono text-sm ${
                        (r.perf3m ?? 0) >= 0 ? 'text-brand-up' : 'text-brand-down'
                      }`}
                    >
                      {fmtPct(r.perf3m)}
                    </div>
                  </div>
                  <ScoreBadge
                    value={
                      sortBy === 'value'
                        ? r.valueInTrendScore
                        : sortBy === 'momentum'
                          ? r.momentumScore
                          : r.totalScore
                    }
                  />
                </button>

                {expanded === r.ticker && (
                  <div className="px-3 sm:px-4 pb-3 space-y-3 bg-brand-panel/20">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MiniScore label="Trend" value={r.trendScore} />
                      <MiniScore label="Sconto" value={r.discountScore} />
                      <MiniScore label="Momentum" value={r.momentumScore} />
                      <MiniScore label="Pullback" value={r.pullbackScore} />
                    </div>
                    <div className="text-xs text-brand-muted">
                      Sconto nel trend{' '}
                      <span className="font-mono font-bold text-brand-text">
                        {r.valueInTrendScore}
                      </span>{' '}
                      · Totale{' '}
                      <span className="font-mono font-bold text-brand-text">
                        {r.totalScore}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-brand-muted font-semibold uppercase tracking-wide">
                        Trend template
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                        <CheckRow ok={r.checks.priceAboveMa200} label="Prezzo > MA200" />
                        <CheckRow ok={r.checks.priceAboveMa150} label="Prezzo > MA150" />
                        <CheckRow ok={r.checks.ma150AboveMa200} label="MA150 > MA200" />
                        <CheckRow ok={r.checks.ma50AboveMa150} label="MA50 > MA150" />
                        <CheckRow ok={r.checks.ma200Rising} label="MA200 in salita" />
                        <CheckRow ok={r.checks.priceAboveMa50} label="Prezzo > MA50" />
                        <CheckRow ok={r.checks.priceAbove52wLow} label="≥30% dal minimo 52w" />
                        <CheckRow ok={r.checks.priceNear52wHigh} label="≤25% dal massimo 52w" />
                      </div>
                    </div>

                    <div className="text-xs text-brand-muted font-mono">
                      MA50 {r.ma50?.toFixed(2) ?? '—'} · MA200{' '}
                      {r.ma200?.toFixed(2) ?? '—'} · scostamento MA50{' '}
                      {r.distFromMa50.toFixed(1)}%
                      {r.rsVsSector != null && (
                        <> · vs settore {fmtPct(r.rsVsSector)}</>
                      )}
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
      )}

      {!loading && results.length === 0 && stats && (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-brand-muted text-sm">
            Nessun titolo corrisponde ai criteri. Prova a disattivare
            &quot;solo in pullback&quot; o ad aggiungere mercati.
          </div>
        </div>
      )}

      {/* Nota metodologica */}
      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Come leggerlo
        </div>
        <p>
          <strong>&quot;Sconto&quot; qui non significa &quot;sottovalutato&quot;.</strong>{' '}
          Il punteggio Sconto misura quanto un titolo è ritracciato rispetto
          al <em>proprio</em> trend — distanza dal massimo a 52 settimane,
          posizione rispetto alle medie, compressione dell&apos;RSI. La
          sottovalutazione in senso fondamentale richiede utili, debito e
          multipli come il P/E: dati che questo screener non ha.
        </p>
        <p>
          Il filtro sul trend viene <strong>prima</strong> di quello
          sull&apos;RSI: un RSI basso su un titolo sotto la MA200 è un titolo
          che sta scendendo, non un&apos;occasione. Per lo stesso motivo il
          punteggio Sconto non premia i ribassi estremi: il massimo è attorno
          a −15% dal massimo di periodo, mentre −50% viene penalizzato.
        </p>
        <p>
          Un titolo può essere ritracciato per una ragione precisa che il
          prezzo da solo non rivela. Sono spunti da cui partire per
          approfondire, non indicazioni operative.
        </p>
      </div>
    </div>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function ScoreBadge({ value }: { value: number }) {
  const color =
    value >= 75
      ? 'bg-brand-green/20 text-brand-green'
      : value >= 55
        ? 'bg-yellow-400/20 text-yellow-400'
        : 'bg-brand-panel text-brand-muted';
  return (
    <div
      className={`flex-shrink-0 w-11 text-center py-1 rounded font-mono font-bold text-sm ${color}`}
    >
      {value}
    </div>
  );
}

function MiniScore({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-brand-panel rounded p-2 text-center">
      <div className="font-mono font-bold text-sm">{value}</div>
      <div className="text-xs text-brand-muted">{label}</div>
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {ok ? (
        <Check className="w-3 h-3 text-brand-up flex-shrink-0" />
      ) : (
        <X className="w-3 h-3 text-brand-down flex-shrink-0" />
      )}
      <span className={ok ? '' : 'text-brand-muted'}>{label}</span>
    </div>
  );
}
