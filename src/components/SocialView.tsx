'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  MessagesSquare,
  RefreshCw,
  Loader2,
  ExternalLink,
  Flame,
  Info,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { SOCIAL_FILTERS, type SocialFilter } from '@/lib/social';

type Mention = {
  rank: number;
  ticker: string;
  name: string | null;
  mentions: number;
  mentions24hAgo: number | null;
  rank24hAgo: number | null;
  upvotes: number | null;
  mentionsChangePct: number | null;
  rankChange: number | null;
  tracked: boolean;
  market: string | null;
};

type Props = {
  onOpenTicker: (ticker: string) => void;
};

export default function SocialView({ onOpenTicker }: Props) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [filter, setFilter] = useState<SocialFilter>('all-stocks');
  const [sortBy, setSortBy] = useState<'rank' | 'surge'>('rank');
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(
          `/api/social?filter=${filter}&pages=1${force ? '&force=1' : ''}`
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
        setMentions(d.mentions ?? []);
        setFetchedAt(d.fetchedAt ?? null);
        setCached(Boolean(d.cached));
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    load();
  }, [load]);

  let rows = onlyTracked ? mentions.filter((m) => m.tracked) : mentions;
  if (sortBy === 'surge') {
    rows = [...rows].sort((a, b) => {
      const av = a.mentionsChangePct ?? -Infinity;
      const bv = b.mentionsChangePct ?? -Infinity;
      return bv - av;
    });
  } else {
    rows = [...rows].sort((a, b) => a.rank - b.rank);
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-brand-green" />
            <span className="font-semibold">Menzioni social</span>
            <span className="text-xs text-brand-muted hidden sm:inline">
              community Reddit
            </span>
          </div>
          <div className="flex items-center gap-2">
            {fetchedAt && (
              <span className="text-xs text-brand-muted">
                {new Date(fetchedAt).toLocaleTimeString('it-IT')}
                {cached && ' (in cache)'}
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="btn-ghost text-xs"
              title="Forza aggiornamento"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Community:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as SocialFilter)}
              className="input text-xs py-1"
            >
              {SOCIAL_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-brand-muted">Ordina per:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'rank' | 'surge')}
              className="input text-xs py-1"
            >
              <option value="rank">Più menzionati</option>
              <option value="surge">Maggiore aumento 24h</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={onlyTracked}
              onChange={(e) => setOnlyTracked(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Solo titoli già nel sistema
          </label>
        </div>
      </div>

      {err && (
        <div className="card p-4 border border-brand-down/40 text-sm text-brand-down">
          {err}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="card p-10 text-center text-brand-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Caricamento…
        </div>
      )}

      {!loading && rows.length === 0 && !err && (
        <div className="card p-8 text-center text-sm text-brand-muted">
          Nessun risultato per questa community.
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 bg-brand-panel/40 border-b border-brand-border flex items-center gap-2">
            <span className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
              Classifica ({rows.length})
            </span>
          </div>
          <div className="divide-y divide-brand-border">
            {rows.map((m) => (
              <div
                key={m.ticker}
                className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5"
              >
                <span className="font-mono text-xs text-brand-muted w-6 flex-shrink-0 text-right">
                  {m.rank}
                </span>

                <button
                  onClick={() => m.tracked && onOpenTicker(m.ticker)}
                  disabled={!m.tracked}
                  className={`flex-1 min-w-0 text-left ${
                    m.tracked ? 'group cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span
                      className={`font-bold text-sm ${
                        m.tracked ? 'group-hover:text-brand-green transition' : ''
                      }`}
                    >
                      {m.ticker}
                    </span>
                    {m.market && (
                      <span className="tag bg-brand-panel text-brand-muted text-xs">
                        {m.market}
                      </span>
                    )}
                    {m.rankChange != null && m.rankChange !== 0 && (
                      <span
                        className={`text-xs flex items-center ${
                          m.rankChange > 0 ? 'text-brand-up' : 'text-brand-down'
                        }`}
                      >
                        {m.rankChange > 0 ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : (
                          <ArrowDown className="w-3 h-3" />
                        )}
                        {Math.abs(m.rankChange)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-brand-muted truncate">
                    {m.name ?? '—'}
                    {m.upvotes != null && <> · {m.upvotes} voti</>}
                  </div>
                </button>

                <div className="text-right flex-shrink-0 w-14">
                  <div className="font-mono text-sm font-bold">{m.mentions}</div>
                  <div className="text-xs text-brand-muted">menzioni</div>
                </div>

                <div className="text-right flex-shrink-0 w-16">
                  {m.mentionsChangePct != null ? (
                    <div
                      className={`font-mono text-sm font-semibold flex items-center justify-end gap-0.5 ${
                        m.mentionsChangePct >= 0
                          ? 'text-brand-up'
                          : 'text-brand-down'
                      }`}
                    >
                      {m.mentionsChangePct >= 100 && (
                        <Flame className="w-3 h-3" />
                      )}
                      {m.mentionsChangePct >= 0 ? '+' : ''}
                      {m.mentionsChangePct.toFixed(0)}%
                    </div>
                  ) : (
                    <div className="text-xs text-brand-muted">nuovo</div>
                  )}
                </div>

                {m.tracked ? (
                  <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
                ) : (
                  <span className="w-3.5 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> Da sapere
        </div>
        <p>
          <strong>La fonte è Reddit, non Twitter.</strong> Da febbraio 2026 X
          non ha più un piano gratuito e fattura circa 0,005 $ per post
          letto: contare le menzioni costerebbe oltre mille dollari al mese.
          Qui sono aggregate le community Reddit dedicate al trading, un
          pubblico diverso ma vicino allo stesso tipo di discussione.
        </p>
        <p>
          I dati si aggiornano circa due volte l&apos;ora. I ticker sono
          riconosciuti dal formato maiuscolo o dal prefisso $, quindi
          possono comparire falsi positivi: sigle come <span className="font-mono">A</span>,{' '}
          <span className="font-mono">IT</span> o{' '}
          <span className="font-mono">ALL</span> vengono scambiate per titoli.
        </p>
        <p>
          Le menzioni misurano <strong>attenzione, non qualità</strong>. Un
          picco può nascere da entusiasmo collettivo, ironia o promozione
          coordinata, e storicamente arriva spesso dopo che il movimento di
          prezzo è già avvenuto.
        </p>
      </div>
    </div>
  );
}
