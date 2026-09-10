'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ALL_TICKERS, getMarketForTicker } from '@/lib/tickers';
import { localSearch } from '@/lib/ticker-names';

/**
 * Casella di ricerca titoli con suggerimenti.
 *
 * Due fonti affiancate:
 *  - l'universo locale, istantaneo e senza richieste di rete;
 *  - la ricerca Yahoo su tutto il catalogo, con un breve ritardo per
 *    non partire a ogni lettera.
 *
 * I titoli dell'universo vengono prima e mostrano il loro mercato; quelli
 * trovati solo su Yahoo mostrano borsa e tipo di strumento.
 */

type Suggestion = {
  symbol: string;
  name: string;
  /** Mercato dell'universo, se il titolo ne fa parte */
  market: string | null;
  exchangeName: string | null;
  type: string | null;
};

type RemoteResult = {
  symbol: string;
  name: string;
  exchangeName: string | null;
  type: string | null;
};

type Props = {
  /** Chiamata con un solo simbolo, gia' in maiuscolo */
  onSelect: (symbol: string) => void;
  /**
   * Se presente, un testo con virgole o punti e virgola viene trattato
   * come elenco di simboli (per incollarne diversi nella watchlist).
   */
  onSubmitList?: (symbols: string[]) => void;
  /** Valore mostrato all'apertura: per il grafico, il titolo corrente */
  defaultValue?: string;
  /** Svuota la casella dopo la scelta (watchlist) */
  clearOnSelect?: boolean;
  placeholder?: string;
  /** Contenuto del pulsante accanto alla casella */
  submitLabel?: ReactNode;
  /** Variante piu' bassa per la barra laterale */
  compact?: boolean;
};

const LOCAL_LIMIT = 6;
const TOTAL_LIMIT = 12;
const REMOTE_DELAY_MS = 300;

const TYPE_LABELS: Record<string, string> = {
  EQUITY: 'Azione',
  ETF: 'ETF',
  INDEX: 'Indice',
  CRYPTOCURRENCY: 'Crypto',
  CURRENCY: 'Valuta',
  FUTURE: 'Future',
  MUTUALFUND: 'Fondo',
};

export default function TickerSearch({
  onSelect,
  onSubmitList,
  defaultValue = '',
  clearOnSelect = false,
  placeholder = 'Simbolo o nome: AAPL, Ferrari, BTC…',
  submitLabel = 'Apri',
  compact = false,
}: Props) {
  const [v, setV] = useState(defaultValue);
  const [local, setLocal] = useState<Suggestion[]>([]);
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteDown, setRemoteDown] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setV(defaultValue), [defaultValue]);

  const q = v.trim();
  const isList = !!onSubmitList && /[,;]/.test(q);
  // Sul grafico la casella mostra il titolo aperto: finche' non si
  // scrive altro non c'e' niente da cercare.
  const idle =
    q.length === 0 ||
    isList ||
    (defaultValue !== '' && q.toUpperCase() === defaultValue.toUpperCase());

  // Universo locale: a ogni lettera, costa nulla
  useEffect(() => {
    if (idle) {
      setLocal([]);
      return;
    }
    setLocal(
      localSearch(q, ALL_TICKERS, LOCAL_LIMIT).map((r) => ({
        symbol: r.ticker,
        name: r.name,
        market: getMarketForTicker(r.ticker),
        exchangeName: null,
        type: null,
      }))
    );
  }, [q, idle]);

  // Yahoo: dopo una pausa nella scrittura, annullando la richiesta
  // precedente se nel frattempo il testo e' cambiato
  useEffect(() => {
    setRemote([]);
    setRemoteDown(false);
    if (idle || q.length < 2) {
      setRemoteLoading(false);
      return;
    }
    setRemoteLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const text = await r.text();
        if (ctrl.signal.aborted) return;
        const d = text ? JSON.parse(text) : {};
        if (!r.ok || d.unavailable) setRemoteDown(true);
        const list: RemoteResult[] = d.results ?? [];
        setRemote(
          list.map((x) => ({
            symbol: x.symbol,
            name: x.name,
            market: getMarketForTicker(x.symbol),
            exchangeName: x.exchangeName,
            type: x.type,
          }))
        );
      } catch {
        if (!ctrl.signal.aborted) setRemoteDown(true);
      } finally {
        if (!ctrl.signal.aborted) setRemoteLoading(false);
      }
    }, REMOTE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, idle]);

  // Prima l'universo, poi quello che Yahoo aggiunge
  const seen = new Set(local.map((s) => s.symbol));
  const suggestions = [
    ...local,
    ...remote.filter((s) => !seen.has(s.symbol)),
  ].slice(0, TOTAL_LIMIT);

  const showPanel = open && !idle;

  function finish(symbol: string) {
    onSelect(symbol.toUpperCase());
    setV(clearOnSelect ? '' : symbol.toUpperCase());
    setOpen(false);
    setHighlight(-1);
    // Su telefono chiude la tastiera
    inputRef.current?.blur();
  }

  function submit() {
    if (!q) return;
    if (isList && onSubmitList) {
      const parts = q
        .split(/[,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (parts.length > 0) onSubmitList(parts);
      setV('');
      setOpen(false);
      return;
    }
    if (highlight >= 0 && suggestions[highlight]) {
      finish(suggestions[highlight].symbol);
      return;
    }
    // Senza una voce evidenziata: se il testo e' esattamente un simbolo
    // tra i suggerimenti si apre quello; se e' un nome si prende il primo
    // suggerimento; altrimenti si prova il testo come simbolo.
    const upper = q.toUpperCase();
    const exact = suggestions.find((s) => s.symbol === upper);
    if (exact) return finish(exact.symbol);
    if (suggestions.length > 0) return finish(suggestions[0].symbol);
    finish(upper.replace(/\s+/g, ''));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!showPanel || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    }
  }

  const pad = compact ? 'py-1' : 'py-2';

  return (
    <div className="flex items-start gap-1.5 flex-1 min-w-0">
      <div className="flex-1 min-w-0 relative">
        <input
          ref={inputRef}
          type="text"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setHighlight(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          // 16px su telefono: sotto questa misura iOS ingrandisce la
          // pagina quando la casella riceve il focus
          className={`input w-full ${pad} text-base sm:text-sm`}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />

        {showPanel && (suggestions.length > 0 || remoteLoading || q.length >= 2) && (
          // Nella barra laterale, che scorre, i suggerimenti stanno nel
          // flusso e spingono giu' il resto: sovrapposti verrebbero tagliati.
          <div
            className={`${
              compact ? 'mt-1 max-h-64' : 'absolute top-full left-0 right-0 mt-1 z-40 shadow-lg max-h-80'
            } bg-brand-panel border border-brand-border rounded-md overflow-y-auto`}
          >
            {suggestions.map((s, i) => (
              <button
                key={s.symbol}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  finish(s.symbol);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 border-b border-brand-border last:border-b-0 transition ${
                  highlight === i ? 'bg-brand-green/15' : 'hover:bg-brand-card/60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-bold text-sm truncate">
                    {s.symbol}
                  </span>
                  <SuggestionTag s={s} />
                </div>
                <div className="text-xs text-brand-muted truncate">{s.name}</div>
              </button>
            ))}

            {remoteLoading && (
              <div className="px-3 py-2 text-xs text-brand-muted flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Cerco su tutti i mercati…
              </div>
            )}
            {!remoteLoading && remoteDown && (
              <div className="px-3 py-2 text-xs text-brand-muted">
                Ricerca su Yahoo non disponibile ora: vedi solo i titoli
                dell&apos;universo.
              </div>
            )}
            {!remoteLoading && !remoteDown && suggestions.length === 0 && q.length >= 2 && (
              <div className="px-3 py-2 text-xs text-brand-muted">
                Nessun titolo trovato. Con Invio provi «{q.toUpperCase()}»
                come simbolo.
              </div>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!q}
        className={`${compact ? 'btn-primary py-1 px-2 text-xs' : 'btn-ghost text-xs'} flex-shrink-0 disabled:opacity-50`}
      >
        {submitLabel}
      </button>
    </div>
  );
}

/** Mercato dell'universo, oppure borsa e tipo di strumento da Yahoo */
function SuggestionTag({ s }: { s: Suggestion }) {
  if (s.market) {
    return (
      <span className="text-xs text-brand-green/80 flex-shrink-0">{s.market}</span>
    );
  }
  const type = s.type ? TYPE_LABELS[s.type] ?? s.type : null;
  const parts = [s.exchangeName, type].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="text-xs text-brand-muted flex-shrink-0">
      {parts.join(' · ')}
    </span>
  );
}
