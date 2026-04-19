# Market Monitor Pro — Web Edition

Versione web del Market Monitor Pro desktop. Stesso motore di analisi (Hull MA 50
+ Heikin Ashi su Yahoo Finance diretto, senza `yfinance`), ora con storico
persistente e backtesting su **Supabase + Vercel**.

## Caratteristiche

- **Scanner automatico** — Vercel Cron invoca `/api/cron/scan` alle 18:00 e 00:00
  (UTC) ogni giorno. Scansione di tutti i mercati definiti in `src/lib/tickers.ts`.
- **Storico segnali persistente** — ogni segnale viene salvato in Supabase.
  Puoi seguirne l'evoluzione (TP hit, SL hit, time stop, chiuso).
- **Backtesting** — simulazione storica con SL/TP/time-stop personalizzabili,
  equity curve, distribuzione P&L, trade log, salvataggio scenari.
- **Grafici** — tre pannelli separati come nella versione desktop:
  candlestick + Hull MA 50, Heikin Ashi, volume.
- **Auth via magic link** — Supabase Auth, nessuna password.
- **Watchlist persistenti** — CRUD completo, salvataggio su DB.

## Stack

- **Next.js 14** (App Router, Server Components, Route Handlers)
- **Supabase** (Postgres, Auth, RLS)
- **Tailwind CSS** (tema dark stile Spotify)
- **Recharts** + SVG custom per i grafici
- **Yahoo Finance API** diretta (TypeScript porta di `yahoo_download`)
- **Vercel Cron** per lo scheduler

---

## Quick start

### 1. Clone e install

```bash
git clone <repo>
cd market-monitor-web
npm install
```

### 2. Crea il progetto Supabase

- Vai su [supabase.com](https://supabase.com), crea un nuovo progetto
- Apri **SQL Editor** e incolla tutto il contenuto di `supabase/schema.sql`,
  poi esegui. Crea tutte le tabelle, RLS, trigger e function
  `get_signal_stats`
- In **Authentication → Providers** assicurati che **Email** sia abilitato
- In **Authentication → URL Configuration** aggiungi il tuo URL locale
  (`http://localhost:3000`) e quello di produzione Vercel come redirect URLs

### 3. Configura le env

```bash
cp .env.example .env.local
```

Compila `.env.local` con:

- `NEXT_PUBLIC_SUPABASE_URL` — da Supabase → Settings → API
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — idem, "anon public"
- `SUPABASE_SERVICE_ROLE_KEY` — idem, "service_role" (⚠️ solo server-side)
- `CRON_SECRET` — stringa random lunga che proteggerà il cron endpoint

Telegram è opzionale e non viene usato dal cron in questa versione (può
essere aggiunto in una iterazione successiva).

### 4. Avvia in locale

```bash
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000). Ti verrà chiesto di
autenticarti via magic link.

### 5. Primo test manuale

Dopo login:

- Seleziona i mercati dalla sidebar
- Clicca **Scansiona ora**
- I segnali compariranno nella tab **Segnali**
- Clicca un segnale per aprire il suo **Chart** (candlestick + HMA + HA)
- Apri la tab **Backtest** per simulare la strategia sullo storico

---

## Deploy su Vercel

### 1. Push del repo su GitHub

### 2. Importa su Vercel

- Vai su [vercel.com/new](https://vercel.com/new)
- Importa il repo
- Framework preset: **Next.js** (auto-detected)

### 3. Env vars

In Vercel → Project → Settings → Environment Variables, aggiungi **tutte** le
stesse variabili di `.env.local`. Applica a Production + Preview.

### 4. Redeploy

Dopo aver aggiunto le env, triggera un redeploy (Deployments → ... → Redeploy).

### 5. Cron automatico

`vercel.json` contiene già lo schedule:

```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "0 18 * * *" },
    { "path": "/api/cron/scan", "schedule": "0 0 * * *" }
  ]
}
```

Vercel Cron chiamerà automaticamente l'endpoint con header
`Authorization: Bearer $CRON_SECRET`. I cron sono disponibili solo sul **piano
Hobby (1 cron/giorno) o Pro**. Con il piano Hobby dovrai scegliere un solo
orario.

> **Nota sui fusi orari**: Vercel Cron usa UTC. Se vuoi scansioni alle 18:00
> e 00:00 ora italiana (CET), usa `0 17 * * *` e `0 23 * * *` (sottrai 1h
> in inverno, 2h in estate — o metti solo il crono invernale e accetta uno
> slittamento di un'ora d'estate).

---

## Struttura del progetto

```
market-monitor-web/
├── supabase/
│   └── schema.sql              ← eseguire nel SQL Editor
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── scan/           ← scansione manuale
│   │   │   ├── cron/scan/      ← scheduler Vercel
│   │   │   ├── signals/        ← CRUD segnali
│   │   │   ├── backtest/       ← esegui/salva backtest
│   │   │   ├── watchlists/     ← CRUD watchlist
│   │   │   └── quote/[ticker]/ ← quote + candele
│   │   ├── auth/callback/      ← callback magic link
│   │   ├── dashboard/          ← pagina principale (auth-gated)
│   │   ├── login/              ← magic link login
│   │   ├── page.tsx            ← redirect
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Dashboard.tsx       ← sidebar + routing viste
│   │   ├── ChartView.tsx       ← 3 pannelli grafico
│   │   ├── SignalsView.tsx     ← lista segnali filtrabile
│   │   └── BacktestView.tsx    ← form + equity + trade log
│   ├── lib/
│   │   ├── yahoo.ts            ← porta TS di yahoo_download
│   │   ├── indicators.ts       ← WMA, HMA, Heikin Ashi
│   │   ├── signals.ts          ← engine detection HMA+HA
│   │   ├── backtest.ts         ← simulator SL/TP/time-stop
│   │   ├── tickers.ts          ← liste mercati
│   │   └── supabase/
│   │       ├── client.ts       ← browser
│   │       ├── server.ts       ← SSR / API routes
│   │       └── admin.ts        ← service-role (cron)
│   ├── types/db.ts
│   └── middleware.ts           ← refresh sessione + redirect auth
├── vercel.json                 ← cron schedule
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Strategia (invariata dal desktop)

**Segnale**: incrocio al rialzo tra prezzo e Hull MA 50, confermato da una
candela Heikin Ashi verde senza wick inferiore.

**Forza**:
- **3 (forte)** — incrocio nelle ultime 1-2 candele + HA bullish pulita
- **2 (medio)** — incrocio recente (3-5 candele) con HA bullish
- **1 (debole)** — prezzo sopra HMA con HA bullish, incrocio più vecchio

**Backtest**: entry su close della candela di segnale (strength ≥ 2),
exit al primo di: stop loss (−5% default), take profit (+10% default), time
stop (20 giorni default). Priorità SL > TP se entrambi toccati nella stessa
candela.

---

## Espansioni suggerite

- **Alert monitoring**: aggiungi un secondo cron che controlla gli `alerts`
  attivi ogni 5 minuti.
- **Portfolio tracking**: tabella `positions` che si aggiorna quando lo scanner
  detecta un TP/SL hit.
- **Più indicatori**: RSI, MACD, volumi anomali.

---

## Costi stimati (piano Hobby)

- **Supabase Free**: 500 MB DB + 50k MAU → ok per uso personale
- **Vercel Hobby**: 1 cron al giorno gratuito; per 2 cron serve Pro ($20/mese)
- **Dominio**: opzionale

Per uso personale strettamente, il piano Hobby + Supabase Free costa **€0**
se ti accontenti di un unico orario di scan al giorno.
