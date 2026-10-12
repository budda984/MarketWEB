# Come funziona Market Monitor Pro

Documento di riferimento sul funzionamento dell'applicazione: da dove
arrivano i dati, quando vengono aggiornati, dove finiscono e cosa fa ogni
sezione del menu. Le regole di lavoro sono in `CLAUDE.md`.

## Il quadro generale

L'applicazione ha due modi di produrre dati.

**In anticipo, con i cron.** Ogni notte, dopo la chiusura di New York, una
serie di rotte `/api/cron/*` scarica i prezzi, calcola segnali, figure, gap,
radar e valutazioni, salva i risultati in Supabase e manda le notifiche
Telegram. Le sezioni che leggono questi archivi si aprono subito, perché
non ricalcolano niente.

**Al momento, su richiesta.** Le sezioni con dati che cambiano durante la
giornata (Top mover, Volumi, Social, Indici, il grafico) interrogano Yahoo
quando le apri. Alcune sezioni hanno anche un pulsante per rifare il
calcolo subito, senza aspettare la notte (Cerca figure, Gap, Radar,
Trend settimanale, Accelera valutazioni).

```
 Yahoo · SEC EDGAR · ApeWisdom
            │
            ▼
   src/lib/*.ts   (logica pura: indicatori, figure, valutazioni…)
            │
     ┌──────┴───────────────┐
     ▼                      ▼
 /api/cron/*            /api/<sezione>
 (notte, Vercel)        (su richiesta dalla vista)
     │                      │
     ▼                      │
 Supabase  ◄────────────────┤  lettura degli archivi
     │                      │
     ▼                      ▼
 Telegram            src/components/*View.tsx
```

La logica di calcolo sta in `src/lib/` ed è separata dalle rotte: lo stesso
modulo serve al cron notturno, al pulsante manuale e al grafico. Per esempio
`src/lib/formations.ts` è usato da `/api/cron/formations`, da
`/api/formations` e dal grafico del singolo titolo.

## Fonti dei dati

| Fonte | Cosa fornisce | Note |
|---|---|---|
| Yahoo `/v8/finance/chart` | Candele storiche e intraday, prezzo, nome | Libero, anche dai datacenter. Base di quasi tutto. |
| Yahoo con sessione (cookie + crumb) | Ricerca titoli, profilo e fondamentali, serie di bilancio, quotazioni a lotti con pre/after-market, classifiche pronte, calendario trimestrali | Senza sessione risponde 401. Tutto passa da `yahooAuthedFetch` in `src/lib/yahoo.ts`. |
| SEC EDGAR | Form 4 degli insider, bilanci XBRL delle società USA | User-Agent con email, max ~5 richieste/s. |
| ApeWisdom | Menzioni dei ticker su Reddit | Gratuito, senza chiave. Sostituisce X/Twitter, diventato a pagamento. |

## Pianificazione

I cron sono in `vercel.json`, orari in UTC. Sul piano Hobby Vercel può
eseguirli in qualunque minuto dell'ora indicata, e ognuno può girare al
massimo una volta al giorno.

| Rotta | Quando (UTC) | In Italia (ora legale) | Cosa fa |
|---|---|---|---|
| `/api/cron/earnings` | 06:00 lun–ven | 08:00 | Aggiorna il calendario delle trimestrali annunciate |
| `/api/cron/formations` | 22:00 lun–ven | 00:00 | Rileva le figure, aggiorna l'archivio, notifica le novità |
| `/api/cron/gaps` | 22:00 lun–ven | 00:00 | Rileva i gap delle ultime sedute, notifica quelli nuovi |
| `/api/cron/opportunities` | 23:00 lun–ven | 01:00 | Calcola il Radar, notifica i primi risultati |
| `/api/cron/scan` | 23:00 ogni giorno | 01:00 | Segnali HMA+HA su tutti i mercati, avvisi di prezzo, regole automatiche |
| `/api/cron/digest` | 01:00 mar–sab | 03:00 | Riepilogo Telegram con il meglio di ogni sezione |
| `/api/cron/valuations` | 03:00 ogni giorno | 05:00 | Un giro del motore delle valutazioni |
| `/api/cron/weekly-trend` | 12:00 sabato | 14:00 | Trend settimanale HMA50 sulla settimana chiusa |

Con l'ora solare (da fine ottobre) gli orari italiani vanno indietro di
un'ora.

Tutti i cron richiedono l'intestazione `Authorization: Bearer <CRON_SECRET>`,
che Vercel aggiunge da sé.

Il motore delle valutazioni ha anche un secondo pianificatore fuori dal
repository: un job `pg_cron` su Supabase che lo chiama ogni 5 minuti. Vedi
la sezione Valutazioni.

## Il database

Lo schema di base è in `supabase/schema.sql`; tutto il resto è stato
aggiunto con le migration in `supabase/migrations/`, eseguite a mano
nell'editor SQL di Supabase.

| Tabella | Contenuto | Scritta da | Migration |
|---|---|---|---|
| `signals` | Segnali HMA+HA (anche le componenti isolate, forza 0) | cron/scan, scan manuale | schema, 001, 003, 018 |
| `scan_runs` | Registro delle scansioni | cron/scan | schema |
| `watchlists` | Watchlist dell'utente | vista | schema |
| `user_settings` | Telegram, soglia minima di notifica, preferenze | Settings | schema |
| `backtest_results` | Scenari di backtest salvati | Backtest | schema |
| `price_alerts` | Avvisi di prezzo manuali | Avvisi, grafico | 002 |
| `user_drawings` | Disegni sul grafico | grafico | 004 |
| `insider_trades`, `insider_sync_log` | Operazioni degli insider dai Form 4 | Insider | 005 |
| `sec_cache` | Mappa ticker → CIK della SEC | moduli SEC | 006 |
| `auto_alert_rules`, `auto_alert_hits` | Regole automatiche sui minimi e loro stato | Avvisi, cron/scan | 007 |
| `weekly_trend_state`, `weekly_trend_flips` | Stato del trend settimanale e cambi | cron/weekly-trend | 008 |
| `opportunities` | Risultati del Radar | cron/opportunities | 009 |
| `price_gaps`, `gap_stats` | Gap di apertura e statistiche di chiusura | cron/gaps | 010, 011 |
| `valuations` | Giudizio di valutazione per titolo | motore valutazioni | 012, 015, 017 |
| `formations` | Archivio delle figure | cron/formations | 013, 014 |
| `earnings_reports` | Trimestrali pubblicate (dai bilanci SEC) | motore valutazioni | 015 |
| `earnings_calendar` | Date annunciate delle trimestrali | cron/earnings | 016 |
| `replay_trades` | Trade chiusi nel Replay | Replay | 019 |

Ultima migration: `019_replay_trades.sql`. La prossima è la `020`.

## L'universo dei titoli

`src/lib/tickers.ts` definisce circa 1.000 ticker divisi per mercato:
S&P 500, NASDAQ, Italia, i mercati europei divisi per nazione (Francia,
Germania, Olanda, UK, Spagna, Svizzera, Svezia, Danimarca, Norvegia,
Finlandia, Austria, Belgio, Portogallo, Polonia, Turchia, Grecia), Giappone,
Forex, Crypto, Commodities, ETF. Non esiste più un mercato `'Europa'`.

`src/lib/ticker-names.ts` associa a ogni ticker il nome della società, per
la ricerca locale istantanea. La ricerca su tutto il catalogo Yahoo
(`/api/search`) si aggiunge a quella locale, così si possono aprire anche
titoli fuori dall'universo.

## Le sezioni

L'ordine è quello del menu laterale (`src/components/Dashboard.tsx`).

### Segnali

**Cosa mostra.** I titoli in cui il prezzo incrocia al rialzo la Hull MA 50
e l'ultima candela Heikin Ashi è verde senza ombra inferiore.

**Come funziona.** `src/lib/signals.ts` calcola per ogni titolo da quante
sedute è avvenuto l'incrocio e da quante sedute dura la serie di Heikin Ashi
verdi pulite. La forza:
- **3, Forte**: incrocio nelle ultime 1–2 sedute e HA verde pulita;
- **2, Medio**: incrocio di 3–5 sedute fa e HA verde;
- **1, Debole**: sopra la Hull e HA verde, incrocio più vecchio;
- **0**: una sola delle due condizioni appena scattata. Non è un segnale, ma
  viene salvato per poterlo vedere nella sezione "Solo una componente".

Il filtro **Componente** separa l'incrocio della Hull dalla prima Heikin Ashi
verde (`ha_flip_bars_ago = 0`) e dalle due insieme. Le notifiche partono solo
dai segnali con forza ≥ 1 e mai sotto quella soglia, indipendentemente dalle
impostazioni.

I segnali arrivano in tempo reale con Supabase Realtime: un nuovo segnale
compare senza ricaricare la pagina.

**File.** `src/components/SignalsView.tsx` · `/api/signals`, `/api/scan`
(scansione manuale dalla barra laterale), `/api/cron/scan` · `src/lib/signals.ts`,
`src/lib/indicators.ts` · tabella `signals`.

### Radar

**Cosa mostra.** Una lista corta di titoli da approfondire, con un punteggio
da 0 a 100.

**Come funziona.** Incrocia quattro criteri che guardano cose diverse: trend
settimanale HMA50 (filtro eliminatorio: senza rialzo settimanale non si
entra), struttura del trend sulle medie, sconto sul prezzo, tempismo delle
Heikin Ashi giornaliere (il massimo è sul cambio di colore appena avvenuto,
non su una lunga serie verde). Gli acquisti multipli degli insider vengono
segnalati a parte. Il punteggio non è stato verificato sui dati storici:
ordina candidati, non misura probabilità.

**File.** `src/components/OpportunitiesView.tsx` · `/api/opportunities`,
`/api/opportunities/run`, `/api/cron/opportunities` · `src/lib/opportunities.ts`
· tabelle `opportunities`, `weekly_trend_state`, `insider_trades`.

### Chart

**Cosa mostra.** Il grafico del singolo titolo e tutto ciò che il sistema sa
di lui.

**Come funziona.**
- Grafico a candele (`lightweight-charts`) con Hull MA 50, intervalli 1h, 4h
  (aggregato dalle candele orarie), 1d, 1w.
- Strumenti di disegno: linea, rettangolo, posizione long e short con
  rapporto rischio/rendimento. Salvati per titolo.
- Sul giornaliero si sovrappongono: la figura in corso (`/api/formations/[ticker]`),
  i gap aperti (`/api/gaps/[ticker]`) e i **fair value gap** aperti
  (`/api/fvg/[ticker]`, pulsante FVG).
- I FVG (`src/lib/fvg.ts`): tre candele con un vuoto in mezzo, ma solo se la
  candela centrale è uno strappo (corpo ampio rispetto all'ATR) e porta a una
  rottura di struttura, cioè a una chiusura oltre l'ultimo massimo o minimo
  significativo. Si cercano su due anni, si mostrano solo quelli ancora mai
  toccati, le zone contigue vengono unite.
- Scheda Fondamentali dal profilo Yahoo: capitalizzazione, P/E attuale e
  atteso, dividendo, range a 52 settimane, margine, crescita dei ricavi, beta.
- Scheda di valutazione (vedi Valutazioni), avvisi di prezzo, aggiunta alla
  watchlist, pannelli Heikin Ashi e volume.
- La ricerca in alto (`src/components/TickerSearch.tsx`) cerca per nome o
  simbolo: prima l'universo locale, poi tutto il catalogo Yahoo.

**File.** `src/components/ChartView.tsx`, `src/components/LightweightChart.tsx`
· `/api/quote/[ticker]`, `/api/fvg/[ticker]`, `/api/gaps/[ticker]`,
`/api/formations/[ticker]`, `/api/drawings`, `/api/search` · tabella
`user_drawings`.

### Avvisi

**Cosa mostra.** Due schede: avvisi manuali e regole automatiche.

**Come funziona.**
- **Avvisi manuali**: soglia fissa su un titolo, sopra, sotto o in
  attraversamento, una volta sola o ripetuti. Valutati dal cron notturno
  (`src/lib/alerts.ts`), che recupera anche i prezzi dei titoli fuori
  dall'universo.
- **Regole automatiche**: si applicano a un intero mercato, per esempio
  "avvisami quando un titolo scende sotto il minimo a 6 mesi +10%". Dopo il
  primo avviso la regola si riarma solo quando il prezzo risale, così non
  arriva una notifica al giorno (`src/lib/auto-alerts.ts`).

**File.** `src/components/AlertsView.tsx`, `AlertsPanel.tsx`,
`AutoRulesPanel.tsx` · `/api/alerts`, `/api/auto-rules`, `/api/auto-rules/run`
· tabelle `price_alerts`, `auto_alert_rules`, `auto_alert_hits`.

### Screener

**Cosa mostra.** Titoli in trend forte, dentro settori forti,
temporaneamente in pausa.

**Come funziona.** Tre livelli calcolati solo dai prezzi: forza dei settori
(ETF settoriali contro SPY), trend template sul titolo (struttura delle
medie alla Minervini), pullback (RSI e distanza dalle medie) per il
tempismo. "Ipervenduto" vale solo dentro un rialzo confermato.

**File.** `src/components/ScreenerView.tsx` · `/api/screener` ·
`src/lib/screener.ts`.

### Insider

**Cosa mostra.** Acquisti e vendite dei dirigenti delle società USA.

**Come funziona.** Invece di interrogare 400 società una per una, scarica
l'indice giornaliero di EDGAR (un file che elenca tutti i depositi del
giorno), tiene solo i Form 4 dei titoli dell'universo e li analizza.
Filtri per periodo, tipo di operazione e valore minimo.

**File.** `src/components/InsiderView.tsx` · `/api/insider`,
`/api/insider/sync` · `src/lib/sec.ts` · tabelle `insider_trades`,
`insider_sync_log`, `sec_cache`.

### Trend settimanale

**Cosa mostra.** I titoli in cui la candela settimanale ha appena chiuso
sopra o sotto la Hull MA 50.

**Come funziona.** Regola binaria: chiusura sopra la HMA50 settimanale è
`above`, sotto è `below`; la notifica parte solo al cambio. Si valuta sempre
l'ultima settimana **chiusa**: la settimana in corso può rientrare prima del
venerdì.

**File.** `src/components/WeeklyTrendView.tsx` · `/api/weekly-trend`,
`/api/weekly-trend/run`, `/api/cron/weekly-trend` · `src/lib/weekly-trend.ts`
· tabelle `weekly_trend_state`, `weekly_trend_flips`.

### Social

**Cosa mostra.** I titoli più citati su Reddit e quelli in crescita di
menzioni.

**Come funziona.** Legge i conteggi di ApeWisdom, che scansiona le community
due volte l'ora.

**File.** `src/components/SocialView.tsx` · `/api/social` · `src/lib/social.ts`.

### Top mover

**Cosa mostra.** Maggiori rialzi e ribassi USA, in sessione regolare, in
pre-market e after-hours.

**Come funziona.** Tre fonti in ordine di preferenza: le classifiche pronte
di Yahoo (solo con "Tutto il mercato USA" in sessione regolare), le
quotazioni a lotti con i prezzi estesi già calcolati (150 titoli per
richiesta), e come ultimo ripiego le candele a 5 minuti titolo per titolo.
La sessione si deduce dall'orologio di New York, non dalla presenza di dati
(`src/lib/market-hours.ts`): nei primi minuti del pre-market hanno scambiato
in pochi, e contarli farebbe credere il mercato chiuso. Yahoo non pubblica
una classifica del pre-market: fuori sessione, con "Tutto il mercato",
l'elenco si allarga ai più scambiati, ai movimenti della seduta precedente e
ai più cercati.

**File.** `src/components/MoversView.tsx` · `/api/movers` ·
`src/lib/yahoo-market.ts`, `src/lib/market-hours.ts`.

### Volumi

**Cosa mostra.** Due classifiche: volume anomalo (quante volte il proprio
normale) e volume più alto in assoluto.

**Come funziona.** A mercato aperto il volume è parziale, e confrontarlo con
la media giornaliera darebbe rapporti tutti sotto 1. Il volume si concentra
in apertura e soprattutto nell'asta di chiusura, quindi il rapporto si
calcola contro quanto un titolo **dovrebbe** aver scambiato a quell'ora,
secondo una curva intraday tipica del mercato USA. Una soglia sul volume
medio e sul controvalore esclude i titoli illiquidi. In pre-market Yahoo
riporta ancora i volumi della seduta precedente, e la vista lo segnala.

**File.** `src/components/VolumeView.tsx` · `/api/volume` · `src/lib/volume.ts`,
`src/lib/yahoo-market.ts`.

### Valutazioni

**Cosa mostra.** Se un titolo costa più o meno di come è stato valutato in
passato, insieme all'andamento dell'azienda. Classifica dei titoli più a
sconto con utili e fatturato in crescita, con filtri su quanti (10/20/30),
sconto minimo e crescita minima.

**Come funziona.**
- Il giudizio confronta il P/E attuale con la mediana dei P/E passati, e lo
  incrocia con crescita degli utili, del fatturato e variazione del margine.
  Un titolo a sconto con i conti in peggioramento finisce in "A sconto, ma con
  riserva", non tra le occasioni (`src/lib/valuation.ts`).
- **Fonti**: prima i bilanci SEC (XBRL); se il titolo non è nell'anagrafica SEC
  o deposita in IFRS (ASML, TSM…), i bilanci Yahoo con lo stesso metodo,
  convertendo le valute e gestendo le quotazioni in centesimi come GBp
  (`src/lib/valuation-row.ts`, `src/lib/valuation-yahoo.ts`). La colonna
  `source` dice da dove arriva.
- **Il motore** (`src/lib/valuation-engine.ts`) non usa un puntatore di
  avanzamento: a ogni giro ricalcola cosa manca (prima i titoli mai
  analizzati, poi quelli più vecchi di 30 giorni) e ne fa quanti ne stanno
  nel tempo concesso. Un giro fallito non lascia buchi. I titoli non
  valutabili ricevono comunque una riga `non_valutabile` con il motivo, così
  escono dalla coda invece di bloccarla.
- **Chi lo fa girare**: il cron giornaliero di Vercel, il job `pg_cron` su
  Supabase ogni 5 minuti, e la sezione stessa finché resta aperta (si ferma
  quando la scheda passa in secondo piano).
- Universo: S&P 500, NASDAQ, mercati europei e Giappone, circa 800 titoli
  (`src/lib/valuation-universe.ts`).

**File.** `src/components/ValuationsView.tsx`, `ValuationCard.tsx` ·
`/api/valuation`, `/api/valuation/[ticker]`, `/api/valuation/catchup`,
`/api/valuation/probe` (diagnostica: mostra i dati grezzi Yahoo di un titolo
senza salvare), `/api/cron/valuations` · tabelle `valuations`,
`earnings_reports`.

### Trimestrali

**Cosa mostra.** Le trimestrali pubblicate e quelle in arrivo.

**Come funziona.** Le date in arrivo sono quelle **annunciate** dalle
società, lette dal calendario di Yahoo con un'unica richiesta per molte
società (`src/lib/earnings-calendar.ts`). Le trimestrali pubblicate vengono
dai bilanci SEC già scaricati per le valutazioni.

**File.** `src/components/EarningsView.tsx` · `/api/earnings`,
`/api/earnings/[ticker]`, `/api/earnings/sync`, `/api/cron/earnings` ·
tabelle `earnings_calendar`, `earnings_reports`.

### Gap

**Cosa mostra.** I gap di apertura e quanto spesso si chiudono.

**Come funziona.** Definizione stretta: un gap esiste solo se l'apertura sta
sopra il massimo precedente o sotto il minimo precedente, senza
sovrapposizione. È chiuso quando il prezzo torna alla chiusura precedente.
La percentuale di chiusura si misura entro 5, 20 e 60 sedute, contando per
ogni orizzonte solo i gap che hanno avuto abbastanza sedute: senza orizzonte
tenderebbe al 100% e non direbbe nulla. Il volume della seduta distingue i
gap da notizia da quelli ordinari.

**File.** `src/components/GapsView.tsx` · `/api/gaps`, `/api/gaps/[ticker]`,
`/api/gaps/run`, `/api/cron/gaps` · `src/lib/gaps.ts` · tabelle `price_gaps`,
`gap_stats`.

### Indici

**Cosa mostra.** Gli indici principali raggruppati per area, con prezzo e
variazione.

**File.** `src/components/IndicesView.tsx` · `/api/quote/[ticker]`.

### Replay

**Cosa mostra.** Un ambiente di allenamento: si riproduce lo storico candela
per candela e si fanno trade simulati, con statistiche.

**Come funziona.**
- Dati base a 1m (ultimi 30 giorni), 5m (60 giorni), 1h (2 anni) o 1d (10
  anni), con i limiti imposti da Yahoo. I timeframe superiori si ricostruiscono
  dalla base (`src/lib/replay-data.ts`).
- Il "cursore" è l'ultima candela visibile: tutto ciò che sta dopo non esiste
  per il grafico, così non si può sbirciare il futuro. I tempi sono già
  spostati sull'ora della borsa (`src/lib/replay-engine.ts`, logica pura).
- Ordini a mercato, limit e stop, con stop e target. Disegno a mano libera.
- Sessioni proposte a partire dai gap di apertura in archivio
  (`/api/replay/gaps`).
- Ogni trade chiuso viene salvato con rendimento in R, escursione avversa e
  favorevole massima (MAE, MFE) e durata; le statistiche si calcolano da lì.

**File.** `src/components/replay/ReplayView.tsx`, `ReplayChart.tsx`,
`ReplayStats.tsx` · `/api/replay/candles`, `/api/replay/gaps`,
`/api/replay/trades` · tabella `replay_trades`.

### Backtest

**Cosa mostra.** La simulazione storica della strategia HMA+HA.

**Come funziona.** Ingresso alla chiusura della candela di segnale, stop
loss (predefinito −5%), take profit (+10%) e uscita a tempo. Restituisce
elenco dei trade, curva del capitale e statistiche; gli scenari si possono
salvare.

**File.** `src/components/BacktestView.tsx` · `/api/backtest` ·
`src/lib/backtest.ts` · tabella `backtest_results`.

### Figure

**Cosa mostra.** Figure grafiche colte mentre si formano, divise per stato.

**Come funziona.** `src/lib/formations.ts` riconosce testa e spalle e testa e
spalle rovesciato, doppio e triplo massimo e minimo, cuneo ascendente e
discendente, bandiera rialzista e ribassista. Servono due soli pivot
confermati: il terzo punto è il prezzo di oggi. Molte figure in formazione
non si completeranno, ed è il costo di vederle presto.

Due famiglie con regole diverse:
- **Testa e spalle, cunei, bandiere**: hanno un livello di conferma (collo o
  retta). Si confermano quando il prezzo lo rompe; la notifica è "Rottura del
  collo".
- **Doppi e tripli massimi e minimi**: **non hanno linea del collo**. Sono
  tocchi ripetuti sullo stesso livello, e la figura è completa quando si
  forma l'ultimo tocco. Il livello mostrato è il supporto o la resistenza
  toccata; l'obiettivo è il primo ostacolo dentro la figura. La figura esiste
  solo se il tocco è degli ultimi 8 giorni e il prezzo è entro il 6% dal
  livello, e la notifica ("Prezzo sul livello") parte alla prima comparsa.

**File.** `src/components/FormationsView.tsx` · `/api/formations`,
`/api/formations/[ticker]`, `/api/formations/recent`, `/api/cron/formations`
· `src/lib/formations.ts` (usa `findPivots` di `src/lib/patterns.ts`) ·
tabella `formations`.

### Settings

**Cosa mostra.** Il collegamento con Telegram (token del bot e chat id), un
pulsante di prova, la forza minima dei segnali da notificare.

**File.** `src/components/SettingsView.tsx` · `/api/settings`,
`/api/telegram/test` · tabella `user_settings`.

### Barra laterale

Selezione dei mercati, pulsante di scansione manuale (`/api/scan`) e
watchlist (`src/components/WatchlistPanel.tsx`, `/api/watchlists`). In fondo
compaiono l'email dell'utente e le prime sette cifre del commit pubblicato:
servono a capire subito se il browser mostra una versione vecchia.

## Notifiche Telegram

Le credenziali del bot sono per utente, in `user_settings`, impostate dalla
sezione Settings. `src/lib/telegram.ts` invia i messaggi in HTML e ignora gli
errori, così un Telegram irraggiungibile non fa fallire un cron.

| Messaggio | Da dove parte |
|---|---|
| Segnali HMA+HA, avvisi di prezzo, regole automatiche | `/api/cron/scan` |
| Figure: "Prezzo sul livello" (doppi/tripli), "Rottura del collo", nuove in formazione | `/api/cron/formations` |
| Gap nuovi | `/api/cron/gaps` |
| Primi risultati del Radar | `/api/cron/opportunities` |
| Cambi del trend settimanale | `/api/cron/weekly-trend` |
| Riepilogo: radar, trend settimanale, figure, gap aperti, titoli a sconto, acquisti insider multipli, crescita sui social | `/api/cron/digest` |

Il riepilogo legge dagli archivi invece di ricalcolare: una sezione il cui
cron non ha girato semplicemente non compare, invece di mostrare numeri
vecchi.

## Moduli condivisi

| File | Ruolo |
|---|---|
| `src/lib/yahoo.ts` | Candele, quotazioni, quotazioni estese, ricerca, sessione cookie + crumb (`getYahooSession`, `yahooAuthedFetch`) |
| `src/lib/yahoo-market.ts` | Quotazioni a lotti, classifiche pronte, titoli più cercati |
| `src/lib/yahoo-fundamentals.ts` | Profilo del titolo e serie di bilancio |
| `src/lib/indicators.ts` | WMA, Hull MA, Heikin Ashi |
| `src/lib/market-hours.ts` | Sessione del mercato USA dall'orologio di New York |
| `src/lib/tickers.ts` | Universo dei titoli per mercato |
| `src/lib/supabase/` | Client per il browser, per il server (con sessione) e admin (service role) |
| `src/middleware.ts` | Reindirizza al login chi non è autenticato; `/login`, `/auth` e `/api/cron` sono pubblici |

## Struttura delle cartelle

```
src/
  app/
    api/            rotte: una cartella per sezione, più cron/
    dashboard/      unica pagina dell'app (la dashboard)
    login/, auth/   accesso con Supabase Auth
  components/       una vista *View.tsx per sezione, più grafico e pannelli
    replay/         modulo Replay
  lib/              logica: indicatori, figure, valutazioni, client delle fonti
  types/db.ts       tipi delle righe del database
supabase/
  schema.sql        schema di base
  migrations/       001–019, da eseguire in ordine
docs/
  ARCHITETTURA.md   questo documento
CLAUDE.md           istruzioni per Claude Code
vercel.json         pianificazione dei cron
```
