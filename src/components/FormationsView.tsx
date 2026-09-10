'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shapes,
  Loader2,
  Play,
  ExternalLink,
  Info,
} from 'lucide-react';
import LastScan from './LastScan';
import {
  FORMATION_LABELS,
  FORMATION_DIRECTION,
  stateLabel,
  type FormationKind,
  type FormationState,
} from '@/lib/formations';

type Formation = {
  ticker: string;
  kind: FormationKind;
  direction?: 'bullish' | 'bearish';
  state: FormationState;
  neckline: number;
  price: number;
  distanceToNecklinePct: number;
  depthPct: number;
  target: number;
  barsSpan: number;
  lastDate: string;
  market: string | null;
  points: Array<{ time: number; price: number; label: string }>;
  firstSeen?: string;
};

const STATE_STYLE: Record<FormationState, string> = {
  forming: 'bg-brand-panel text-brand-muted',
  right_shoulder: 'bg-yellow-400/20 text-yellow-400',
  confirmed: 'bg-brand-green/20 text-brand-green',
};

type Props = { onOpenTicker: (t: string) => void };

export default function FormationsView({ onOpenTicker }: Props) {
  const [items, setItems] = useState<Formation[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | FormationKind>('all');
  const [dirFilter, setDirFilter] = useState<'all' | 'bullish' | 'bearish'>('all');
  const [stateFilter, setStateFilter] = useState<'all' | FormationState>('all');
  const [lastScan, setLastScan] = useState<string | null>(null);

  // All'apertura mostro l'archivio: le figure viste nelle scansioni
  // precedenti restano disponibili invece di sparire
  const loadStored = useCallback(async () => {
    try {
      const r = await fetch('/api/formations/recent');
      const text = await r.text();
      if (!text) return;
      const d = JSON.parse(text);
      if (d.error) {
        setErr(d.error);
        return;
      }
      const stored = (d.formations ?? []).map(
        (f: Record<string, unknown>) => ({
          ticker: f.ticker,
          kind: f.kind,
          state: f.state,
          neckline: Number(f.neckline),
          price: Number(f.price),
          distanceToNecklinePct: Number(f.distance_to_neckline_pct ?? 0),
          depthPct: Number(f.depth_pct ?? 0),
          target: Number(f.target ?? 0),
          barsSpan: Number(f.bars_span ?? 0),
          lastDate: String(f.last_seen ?? '').slice(0, 10),
          market: (f.market as string) ?? null,
          points: (f.points as Formation['points']) ?? [],
          firstSeen: f.first_seen as string,
        })
      );
      setItems(stored);
      setLastScan(d.lastScan ?? null);
    } catch {
      // archivio non disponibile: si puo' comunque scansionare
    }
  }, []);

  useEffect(() => {
    loadStored();
  }, [loadStored]);

  async function run() {
    setRunning(true);
    setErr(null);
    setItems([]);
    setProgress('Avvio…');
    const all: Formation[] = [];
    let offset = 0;
    let guard = 0;
    try {
      while (guard++ < 25) {
        const r = await fetch('/api/formations', {
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
        all.push(...(d.formations ?? []));
        setProgress(
          `${d.processedUpTo}/${d.universeSize} titoli · ${all.length} figure`
        );
        setItems([...all]);
        if (d.done || d.nextOffset == null) break;
        offset = d.nextOffset;
      }
      setProgress(`Completato · ${all.length} figure`);
      await loadStored();
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  const visible = items
    .filter((f) => (kindFilter === 'all' ? true : f.kind === kindFilter))
    .filter((f) => (stateFilter === 'all' ? true : f.state === stateFilter))
    .filter((f) =>
      dirFilter === 'all'
        ? true
        : (f.direction ?? FORMATION_DIRECTION[f.kind]) === dirFilter
    )
    .sort((a, b) => {
      // Prima le piu' avanzate, poi le piu' vicine alla conferma
      const order: Record<FormationState, number> = {
        confirmed: 0,
        right_shoulder: 1,
        forming: 2,
      };
      const d = order[a.state] - order[b.state];
      if (d !== 0) return d;
      return a.distanceToNecklinePct - b.distanceToNecklinePct;
    });

  const counts = {
    confirmed: items.filter((f) => f.state === 'confirmed').length,
    right_shoulder: items.filter((f) => f.state === 'right_shoulder').length,
    forming: items.filter((f) => f.state === 'forming').length,
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 w-full max-w-full">
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Shapes className="w-5 h-5 text-brand-green" />
          <span className="font-semibold">Figure in formazione</span>
          <span className="text-xs text-brand-muted">
            S&amp;P 500 e NASDAQ
          </span>
        </div>

        <LastScan at={lastScan} />

        <button
          onClick={run}
          disabled={running}
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scansione…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Play className="w-3.5 h-3.5" /> Cerca figure
            </span>
          )}
        </button>

        {running && (
          <div className="text-xs text-brand-green flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
            <span className="break-words">{progress ?? 'Avvio…'}</span>
          </div>
        )}
        {!running && progress && !err && (
          <div className="text-xs text-brand-green break-words">{progress}</div>
        )}
        {err && (
          <div className="text-xs text-brand-down break-words border border-brand-down/40 rounded p-2">
            {err}
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Collo rotto"
                value={counts.confirmed}
                color="text-brand-green"
              />
              <Stat
                label="Struttura completa"
                value={counts.right_shoulder}
                color="text-yellow-400"
              />
              <Stat
                label="In formazione"
                value={counts.forming}
                color="text-brand-muted"
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-brand-muted">Figura:</span>
                <select
                  value={kindFilter}
                  onChange={(e) =>
                    setKindFilter(e.target.value as 'all' | FormationKind)
                  }
                  className="input text-xs py-1"
                >
                  <option value="all">Tutte</option>
                  <option value="IHS">Testa e spalle rovesciato</option>
                  <option value="DOUBLE_BOTTOM">Doppio minimo</option>
                  <option value="HS">Testa e spalle</option>
                  <option value="DOUBLE_TOP">Doppio massimo</option>
                  <option value="FALLING_WEDGE">Cuneo discendente</option>
                  <option value="RISING_WEDGE">Cuneo ascendente</option>
                  <option value="BULL_FLAG">Bandiera rialzista</option>
                  <option value="BEAR_FLAG">Bandiera ribassista</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-brand-muted">Direzione:</span>
                <select
                  value={dirFilter}
                  onChange={(e) =>
                    setDirFilter(
                      e.target.value as 'all' | 'bullish' | 'bearish'
                    )
                  }
                  className="input text-xs py-1"
                >
                  <option value="all">Entrambe</option>
                  <option value="bullish">Rialziste</option>
                  <option value="bearish">Ribassiste</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-brand-muted">Stato:</span>
                <select
                  value={stateFilter}
                  onChange={(e) =>
                    setStateFilter(e.target.value as 'all' | FormationState)
                  }
                  className="input text-xs py-1"
                >
                  <option value="all">Tutti</option>
                  <option value="confirmed">Collo rotto</option>
                  <option value="right_shoulder">Struttura completata</option>
                  <option value="forming">In formazione</option>
                </select>
              </label>
            </div>
          </>
        )}
      </div>

      {!running && items.length === 0 && !err && (
        <div className="card p-8 text-center space-y-2">
          <div className="text-4xl">📐</div>
          <div className="text-sm text-brand-muted break-words">
            Premi <strong>Cerca figure</strong> per analizzare i grafici
            giornalieri.
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="card overflow-hidden">
          <div className="divide-y divide-brand-border">
            {visible.map((f, i) => (
              <button
                key={`${f.ticker}-${f.kind}-${i}`}
                onClick={() => onOpenTicker(f.ticker)}
                className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-brand-card/40 transition text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-sm">{f.ticker}</span>
                    <span className={`tag text-xs ${STATE_STYLE[f.state]}`}>
                      {stateLabel(f.kind, f.state)}
                    </span>
                    <span className="text-xs text-brand-muted">
                      {FORMATION_LABELS[f.kind]}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        (f.direction ?? FORMATION_DIRECTION[f.kind]) ===
                        'bearish'
                          ? 'text-brand-down'
                          : 'text-brand-up'
                      }`}
                    >
                      {(f.direction ?? FORMATION_DIRECTION[f.kind]) ===
                      'bearish'
                        ? '↓'
                        : '↑'}
                    </span>
                  </div>
                  <div className="text-xs text-brand-muted font-mono mt-0.5 break-words">
                    {Number(f.price).toFixed(2)} · collo{' '}
                    {Number(f.neckline).toFixed(2)}
                    {f.state !== 'confirmed' && (
                      <>
                        {' '}
                        (
                        {f.distanceToNecklinePct >= 0 ? '+' : ''}
                        {f.distanceToNecklinePct.toFixed(1)}%)
                      </>
                    )}{' '}
                    · {f.barsSpan} sedute
                    {f.firstSeen && (
                      <>
                        {' '}
                        · vista dal{' '}
                        {new Date(f.firstSeen).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-mono text-sm font-bold text-brand-up">
                    {Number(f.target).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-brand-muted">obiettivo</div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-3 text-xs text-brand-muted space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Info className="w-3.5 h-3.5" /> I tre stati
        </div>
        <p className="break-words">
          <strong>In formazione:</strong> il prezzo è risalito dal minimo
          principale ed è tornato all&apos;altezza del primo minimo. La
          figura si intravede, ma potrebbe non completarsi.
        </p>
        <p className="break-words">
          <strong>Struttura completata:</strong> il secondo minimo si è
          formato allo stesso livello del primo — spalla destra nel testa e
          spalle, secondo minimo nel doppio minimo — e il prezzo risale
          verso la linea del collo.
        </p>
        <p className="break-words">
          <strong>Collo rotto:</strong> il prezzo ha superato il livello di
          conferma. L&apos;obiettivo indicato è l&apos;altezza della figura
          proiettata oltre il collo — una convenzione, non una previsione.
        </p>
        <p className="break-words">
          Molte figure in formazione non si completeranno: è il costo del
          vederle presto anziché a movimento avvenuto. Aprendo un titolo la
          figura viene disegnata sul grafico giornaliero.
        </p>
        <p className="break-words">
          I <strong>cunei</strong> hanno due rette convergenti invece di una
          linea del collo orizzontale: il livello di conferma si sposta a
          ogni seduta. Nel cuneo discendente entrambe scendono e i massimi
          più in fretta dei minimi, con rottura attesa al rialzo; in quello
          ascendente è il contrario.
        </p>
        <p className="break-words">
          Le <strong>bandiere</strong> sono un&apos;asta — un movimento
          ripido e breve — seguita da un canale stretto che deriva in
          direzione opposta. La rottura avviene nella direzione
          dell&apos;asta, e l&apos;obiettivo è l&apos;altezza dell&apos;asta
          proiettata dal punto di rottura. Se il consolidamento restituisce
          più di metà dell&apos;asta non è più una pausa, è un&apos;inversione,
          e la figura viene scartata.
        </p>
        <p className="break-words">
          Le figure ribassiste — testa e spalle e doppio massimo — seguono
          la logica speculare: richiedono una salita che le precede e si
          confermano rompendo la linea del collo verso il basso. Il colore
          sul grafico distingue la direzione.
        </p>
        <p className="break-words">
          Perché una figura sia considerata valida servono: un movimento che
          la precede, minimi da cui il prezzo è poi risalito in modo
          apprezzabile, una linea del collo pressoché orizzontale fra i due
          picchi intermedi, e due lati di durata confrontabile. Senza questi
          vincoli qualunque oscillazione può somigliare a una figura.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-brand-panel rounded p-2 text-center">
      <div className={`font-mono font-bold text-lg ${color}`}>{value}</div>
      <div className="text-xs text-brand-muted">{label}</div>
    </div>
  );
}
