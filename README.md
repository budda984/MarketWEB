# Market Monitor Pro — Web

Applicazione web personale di analisi azionaria: scanner multi-mercato,
segnali Hull MA 50 + Heikin Ashi, figure grafiche, fair value gap, avvisi
Telegram, insider, valutazioni dai bilanci, volumi, replay per allenamento.

In produzione su https://market-web-iota.vercel.app, con deploy automatico
da `main`.

- **Come funziona**, sezione per sezione: [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md)
- **Regole di lavoro e vincoli tecnici** (per Claude Code e per chiunque
  tocchi il codice): [`CLAUDE.md`](CLAUDE.md)

## Stack

Next.js 14 (App Router) · TypeScript · Supabase (Postgres, Auth, RLS,
Realtime) · Tailwind · lightweight-charts · Vercel (piano Hobby) · dati da
Yahoo Finance, SEC EDGAR e ApeWisdom con `fetch` diretto, senza librerie.

## Avvio in locale (macOS)

Serve Node.js 20 o superiore.

```bash
git clone https://github.com/budda984/MarketWEB.git
cd MarketWEB
npm install
cp .env.example .env.local    # poi compila le chiavi, vedi sotto
npm run dev                   # http://localhost:3000
```

Le chiavi in `.env.local` sono le stesse impostate su Vercel
(Project → Settings → Environment Variables):

| Variabile | Dove si trova |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem, chiave "anon public" |
| `SUPABASE_SERVICE_ROLE_KEY` | idem, chiave "service_role". Solo lato server, mai nel browser |
| `CRON_SECRET` | stringa casuale lunga, uguale a quella su Vercel |

Telegram non si configura qui: token del bot e chat id si inseriscono dalla
sezione Settings dell'app e vengono salvati per utente nel database.

Per accedere in locale, in Supabase → Authentication → URL Configuration
deve esserci anche `http://localhost:3000` tra gli indirizzi di
reindirizzamento.

## Lavorare con Claude Code

Dalla cartella del progetto:

```bash
claude
```

Claude Code legge da solo `CLAUDE.md` all'avvio: lì ci sono le regole
(italiano, push diretto su `main`, verifica con `tsc` e `build`, migration da
eseguire a mano), i vincoli tecnici e le decisioni già prese.

Prima di ogni push:

```bash
npx tsc --noEmit
npm run build
```

## Database

Su un progetto Supabase nuovo: eseguire `supabase/schema.sql`, poi tutte le
migration di `supabase/migrations/` in ordine numerico, dall'editor SQL.
Sul progetto esistente le migration sono già state applicate fino alla
`019`; le nuove si eseguono una alla volta, a mano.

## Pianificazione

I cron giornalieri sono in `vercel.json` (il piano Hobby ne consente uno al
giorno per voce). Il motore delle valutazioni gira anche ogni 5 minuti
tramite un job `pg_cron` su Supabase, configurato fuori dal repository:
dettagli in `CLAUDE.md`.
