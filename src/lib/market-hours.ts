/**
 * Sessioni del mercato USA in ora di New York.
 *
 * La sessione va dedotta dall'ORARIO, non dalla presenza di dati: nei
 * primi minuti del pre-market hanno scambiato pochissimi titoli, e
 * contarli per decidere se la sessione e' aperta porta a dichiararla
 * chiusa proprio quando e' appena iniziata.
 *
 * Orari (ora di New York, giorni feriali):
 *   pre-market   04:00 - 09:30
 *   regolare     09:30 - 16:00
 *   after-hours  16:00 - 20:00
 */

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

export type SessionInfo = {
  session: MarketSession;
  /** Minuti trascorsi dall'inizio della sessione corrente */
  minutesIntoSession: number | null;
  /** Ora di New York in formato HH:MM */
  etTime: string;
  /** Data di New York in formato ISO */
  etDate: string;
  isWeekend: boolean;
};

/** Componenti data/ora a New York, gestendo automaticamente l'ora legale. */
function nyParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl puo' restituire "24" a mezzanotte
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday as string] ?? 1,
  };
}

export function getMarketSession(now: Date = new Date()): SessionInfo {
  const p = nyParts(now);
  const mins = p.hour * 60 + p.minute;
  const etTime = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const etDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const isWeekend = p.weekday === 0 || p.weekday === 6;

  const PRE_START = 4 * 60;
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  const POST_END = 20 * 60;

  if (isWeekend) {
    return { session: 'closed', minutesIntoSession: null, etTime, etDate, isWeekend };
  }

  let session: MarketSession = 'closed';
  let minutesIntoSession: number | null = null;

  if (mins >= PRE_START && mins < OPEN) {
    session = 'pre';
    minutesIntoSession = mins - PRE_START;
  } else if (mins >= OPEN && mins < CLOSE) {
    session = 'regular';
    minutesIntoSession = mins - OPEN;
  } else if (mins >= CLOSE && mins < POST_END) {
    session = 'post';
    minutesIntoSession = mins - CLOSE;
  }

  // Nota: non e' incluso il calendario delle festivita' di borsa. In un
  // giorno festivo la sessione risultera' aperta ma nessun titolo avra'
  // scambiato, e la vista lo segnala.
  return { session, minutesIntoSession, etTime, etDate, isWeekend };
}

/** Etichetta leggibile della sessione. */
export function sessionLabel(s: MarketSession): string {
  return {
    pre: 'Pre-market',
    regular: 'Sessione regolare',
    post: 'After-hours',
    closed: 'Mercato chiuso',
  }[s];
}

/** Minuti dalla mezzanotte di New York per un istante dato. */
export function etMinutesOfDay(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  );
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

/**
 * A quale sessione appartiene un istante, in base all'ora di New York.
 * Usata per classificare le candele delle sessioni estese.
 */
export function sessionOfTimestamp(tsSeconds: number): MarketSession {
  const mins = etMinutesOfDay(new Date(tsSeconds * 1000));
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'post';
  return 'closed';
}
