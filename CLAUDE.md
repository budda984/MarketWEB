# Market Monitor Pro — istruzioni per Claude Code

Applicazione web personale di analisi azionaria di Andrea (budda984). Scanner
multi-mercato, segnali Hull MA 50 + Heikin Ashi, figure grafiche, avvisi
Telegram, valutazioni da bilanci, replay per allenamento.

- Produzione: https://market-web-iota.vercel.app (deploy automatico da `main`)
- Repository: `budda984/MarketWEB`, privato
- Funzionamento dettagliato di ogni sezione: `docs/ARCHITETTURA.md`

## Stack

Next.js 14.2 (App Router, route handler in `src/app/api`), TypeScript,
Supabase (Postgres + Auth + RLS + Realtime), Tailwind, `lightweight-charts`
4.x per il grafico principale, `recharts` per i pannelli secondari,
`lucide-react` per le icone. Hosting Vercel, piano **Hobby** (gratuito).
Nessuna libreria per i dati di mercato: Yahoo, SEC e ApeWisdom sono
interrogati con `fetch` diretto.

## Comandi

```bash
npm install
npm run dev              # http://localhost:3000, richiede .env.local
npx tsc --noEmit         # verifica dei tipi: obbligatoria prima di ogni commit
npm run build            # build di produzione: obbligatoria prima di ogni push
```

`npm run build` senza `.env.local` fallisce sul prerender di `/login` perché
mancano le chiavi Supabase. Non è un errore del codice. Se serve verificare
il build senza chiavi vere:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build
```

## Come lavorare con Andrea

- **Lingua**: commenti nel codice, messaggi di commit, testi dell'interfaccia
  e risposte in italiano.
- **Branch**: si lavora e si pusha direttamente su `main`. Niente branch né
  pull request: le preview di Vercel non sono raggiungibili dal suo
  dispositivo, quindi l'unico modo di provare è il deploy di produzione.
- **Verifica prima del push**: `npx tsc --noEmit` e `npm run build` puliti.
- **Migration**: le esegue Andrea a mano nell'editor SQL di Supabase. Ogni
  modifica allo schema va in un nuovo file `supabase/migrations/NNN_nome.sql`
  (numerazione progressiva, ultima: `020`) e il testo SQL va riportato anche
  nella risposta. Mai dare per scontato che una migration sia stata eseguita:
  il codice deve dare un errore leggibile se manca una colonna o una tabella
  (vedi `valuationDbErrorMessage` in `src/lib/valuation-row.ts`).
- **Ambito**: Andrea conferma l'ambito prima di cominciare (meglio una domanda
  a scelta multipla che un'ipotesi). Le funzioni grandi si consegnano a fasi,
  e la fase 1 va validata prima di proseguire.
- **Semplicità**: Andrea considera l'app già troppo complessa. Nuove funzioni
  solo se restano leggibili; preferire una scheda dentro una sezione esistente
  a una nuova voce di menu. Ha già rifiutato per questo motivo un agente AI di
  analisi notizie e l'integrazione dei 13F.
- **Mobile**: prova soprattutto da telefono. Ogni interfaccia deve funzionare
  a 375 px: righe che vanno a capo, caselle di testo a 16 px su mobile (sotto
  iOS ingrandisce la pagina), niente sovrapposizioni.
- **Correzioni**: quando Andrea corregge una regola (es. "il doppio massimo non
  ha linea del collo"), è un vincolo fermo da lì in avanti.
- **Ambiente**: dal 2026-10-08 lavora su Mac, terminale macOS. Cartella del
  progetto in precedenza su Windows: `C:\Lello\MarketMonitorWeb\market-monitor-web\`.
- **Onestà sui metodi**: quando una tecnica ha poca evidenza (pattern a
  candele isolati, FVG presi da soli, previsioni settoriali) dirlo, e proporre
  di misurarla sul suo universo prima di trasformarla in avviso.

## Vincoli tecnici da rispettare

**Vercel Hobby**
- Funzioni con limite di 60 secondi. I lavori lunghi si spezzano in lotti
  (tipicamente 40 titoli) con un controllo del tempo a 42–48 s e un
  `nextOffset` restituito al client, oppure una coda ricalcolata a ogni giro
  (vedi `src/lib/valuation-engine.ts`).
- I cron in `vercel.json` possono girare **al massimo una volta al giorno**.
  Un'espressione più frequente fa fallire l'intero deploy. Per cadenze più
  fitte si usa `pg_cron` + `pg_net` su Supabase (vedi sotto).

**Yahoo Finance**
- `/v8/finance/chart/` funziona senza autenticazione anche dai datacenter.
- Tutti gli altri endpoint (quoteSummary, ricerca, quotazioni v7 a lotti,
  screener, timeseries dei bilanci, calendario trimestrali) rispondono
  `401 Invalid Crumb` senza sessione. Usare sempre `yahooAuthedFetch` di
  `src/lib/yahoo.ts`, che gestisce cookie + crumb, rinnovo su 401 e richieste
  concorrenti. Non creare una sessione parallela.
- Non usare `yfinance` né altre librerie: sono state abbandonate per
  incompatibilità.

**SEC EDGAR**
- `User-Agent` con email obbligatorio, massimo ~5 richieste al secondo
  (`SEC_DELAY_MS = 200`). Altrimenti 403.
- La mappa ticker → CIK è in cache nella tabella `sec_cache`: non
  riscaricare `company_tickers.json` a ogni richiesta.

**Supabase**
- Prima di ogni `upsert` deduplicare le righe sulla chiave di conflitto,
  altrimenti Postgres risponde "ON CONFLICT DO UPDATE command cannot affect
  row a second time".
- In un upsert a lotti le colonne sono l'unione di quelle presenti nelle
  righe: un campo omesso in una riga diventa `NULL`, non il valore
  predefinito. Le colonne `NOT NULL` vanno valorizzate in ogni riga.
- Le scritture dai cron usano il client admin (`src/lib/supabase/admin.ts`,
  service role). Le letture dalle viste usano il client server con la
  sessione dell'utente e passano per RLS.

**Next.js**
- I file di rotta con segmento dinamico (`[ticker]/route.ts`) devono
  esportare solo i gestori HTTP (`GET`, `POST`…): altre funzioni esportate
  rompono il build.
- Le rotte API restituiscono sempre JSON, anche in caso di errore, con un
  messaggio leggibile in italiano. Il client legge con `r.text()` e poi
  `JSON.parse` per non rompersi su risposte vuote.

**Interfaccia**
- Il mercato predefinito in `Dashboard.tsx` è `'Italia'`. Mai `'Europa'`:
  dopo la divisione dei mercati europei per nazione non è più una `MarketKey`
  valida. Bug ricorrente.
- I componenti si renderizzano nell'area dei contenuti, mai dentro la barra
  dell'intestazione.
- Messaggi di avanzamento ed errore stanno sotto il pulsante d'azione, non
  sopra.

## Decisioni prese: non riproporre

- **Doppi e tripli massimi/minimi non hanno linea del collo.** La figura è
  completa alla formazione del secondo (o terzo) tocco sul livello, ed è lì
  che parte l'avviso. Valida solo se il tocco è recente (≤ 8 sedute) e il
  prezzo è entro il 6% dal livello.
- **Pattern a candele sul grafico** (engulfing, outside, harami, martello,
  pin bar, doji, marubozu): provati e rimossi subito. Grafico illeggibile.
- **Backtest del trend settimanale HMA50**: provato, ~19,5% contro ~94,6% del
  buy & hold, rimosso. Non serve come filtro.
- **Notifiche delle figure dallo scan**: il radar dei pattern è stato tolto
  da cron e scan per scarsa qualità. Le figure si notificano solo da
  `/api/cron/formations`.
- **FVG**: solo giornaliero, solo quelli aperti, chiusi al primo tocco.
  Andrea non vuole l'intraday.
- **Agente AI su notizie/settori e 13F dei fondi**: rifiutati, troppo
  complessi per lo scopo.
- **Segnale HMA+HA**: resta la combinazione delle due condizioni ed è l'unica
  che genera notifiche. Le due componenti sono visibili e filtrabili
  separatamente nella sezione Segnali, ma non notificano da sole.

## Configurazione fuori dal repository

- **Variabili d'ambiente su Vercel**: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `CRON_SECRET`. Telegram non usa variabili d'ambiente: token e chat id sono
  per utente, nella tabella `user_settings`, impostati dalla sezione Settings.
- **pg_cron su Supabase**: il motore delle valutazioni è pensato per essere
  chiamato ogni 5 minuti da un job `valutazioni` che fa `net.http_get` su
  `/api/cron/valuations?budget=20000&max=15` con `timeout_milliseconds := 30000`
  e l'intestazione `Authorization: Bearer <CRON_SECRET>`. Il timeout
  predefinito di `pg_net` è 2 secondi e annulla il giro: va sempre alzato.
  Verificare se esiste con `select jobid, jobname, schedule, active from cron.job;`.
- **App GitHub di Claude** installata sul repository: serve per i push dalle
  sessioni cloud di Claude. Da Claude Code in locale si pusha con le
  credenziali git di Andrea.

## Problemi noti, non ancora sistemati

- Next.js è fermo alla linea 14.2 (ultima: 14.2.35), che non riceve più
  correzioni di sicurezza. Le vulnerabilità aperte riguardano soprattutto
  funzioni non usate (next/image, server actions, rewrites, i18n); per
  chiuderle tutte serve il passaggio a Next 15.5 con React 19.
- `/api/scan` accetta ancora `includePatterns: true` e calcola le vecchie
  figure del radar, ma nessuna vista lo chiede più.

Prima di sistemarli, chiedere ad Andrea: alcuni possono essere voluti.
