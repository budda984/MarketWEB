/**
 * L'universo dei titoli che entrano nell'archivio delle valutazioni.
 *
 * Solo azioni: crypto, cambi, materie prime e indici non hanno un
 * bilancio, e gli ETF nemmeno. Definito una volta qui perche' lo usano
 * sia il riempimento manuale sia il motore in sottofondo, e se i due
 * lavorassero su liste diverse la copertura non tornerebbe mai.
 */

import { MARKETS } from './tickers';

const US_EQUITY = ['S&P 500', 'NASDAQ'] as const;

const NON_US_EQUITY = [
  'Italia', 'Francia', 'Germania', 'Olanda', 'UK', 'Spagna', 'Svizzera',
  'Svezia', 'Danimarca', 'Norvegia', 'Finlandia', 'Austria', 'Belgio',
  'Portogallo', 'Polonia', 'Turchia', 'Grecia', 'Giappone',
] as const;

export function valuationUniverse(): string[] {
  return Array.from(
    new Set(
      [...US_EQUITY, ...NON_US_EQUITY].flatMap(
        (m) => (MARKETS[m] as readonly string[] | undefined) ?? []
      )
    )
  );
}
