'use client';

import { Clock } from 'lucide-react';

/**
 * Data dell'ultima scansione.
 *
 * Le sezioni che conservano i risultati mostrano dati raccolti in
 * passato: senza questa indicazione un archivio di una settimana fa
 * sembra aggiornato, ed e' peggio di un archivio vuoto.
 */
export default function LastScan({
  at,
  staleAfterHours = 24,
}: {
  at: string | null | undefined;
  staleAfterHours?: number;
}) {
  if (!at) {
    return (
      <div className="text-xs text-brand-muted flex items-center gap-1.5">
        <Clock className="w-3 h-3 flex-shrink-0" />
        Mai eseguita
      </div>
    );
  }

  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;

  const hours = (Date.now() - d.getTime()) / 3600000;
  const stale = hours > staleAfterHours;

  const quando = d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  let eta: string;
  if (hours < 1) eta = 'meno di un\u2019ora fa';
  else if (hours < 24) eta = `${Math.round(hours)} ore fa`;
  else {
    const g = Math.round(hours / 24);
    eta = g === 1 ? 'ieri' : `${g} giorni fa`;
  }

  return (
    <div
      className={`text-xs flex items-center gap-1.5 ${
        stale ? 'text-yellow-400' : 'text-brand-muted'
      }`}
    >
      <Clock className="w-3 h-3 flex-shrink-0" />
      <span className="break-words">
        Ultima scansione {quando} ({eta})
      </span>
    </div>
  );
}
