-- Migration 005: transazioni insider da SEC Form 4
--
-- Dati pubblici (nessun user_id): tutti gli utenti autenticati leggono,
-- solo il service role scrive tramite la route di sincronizzazione.

create table if not exists public.insider_trades (
  id uuid primary key default gen_random_uuid(),

  -- Identificativi del deposito
  accession text not null,
  row_idx int not null default 0,
  filing_url text,

  -- Emittente
  issuer_cik text not null,
  ticker text,
  issuer_name text,

  -- Chi ha operato
  owner_name text not null,
  owner_title text,
  is_director boolean default false,
  is_officer boolean default false,
  is_ten_percent boolean default false,

  -- Operazione
  transaction_date date,
  filed_date date,
  -- Codici SEC: P=acquisto a mercato, S=vendita, A=assegnazione,
  -- M=esercizio opzioni, F=trattenuta fiscale, G=donazione
  transaction_code text,
  -- A=acquisito, D=ceduto
  acquired_disposed text,
  security_title text,
  shares numeric,
  price numeric,
  value numeric,
  shares_owned_after numeric,
  is_derivative boolean default false,

  created_at timestamptz not null default now(),

  unique (accession, row_idx)
);

create index if not exists insider_trades_ticker_idx
  on public.insider_trades (ticker);
create index if not exists insider_trades_txdate_idx
  on public.insider_trades (transaction_date desc);
create index if not exists insider_trades_code_idx
  on public.insider_trades (transaction_code);
create index if not exists insider_trades_ticker_code_date_idx
  on public.insider_trades (ticker, transaction_code, transaction_date desc);

alter table public.insider_trades enable row level security;

-- Lettura per qualsiasi utente autenticato (dato pubblico)
drop policy if exists "insider_trades_read" on public.insider_trades;
create policy "insider_trades_read"
  on public.insider_trades
  for select
  to authenticated
  using (true);

-- Traccia delle sincronizzazioni, per sapere da dove ripartire
create table if not exists public.insider_sync_log (
  id uuid primary key default gen_random_uuid(),
  index_date date not null unique,
  filings_seen int default 0,
  rows_inserted int default 0,
  status text default 'ok',
  note text,
  created_at timestamptz not null default now()
);

alter table public.insider_sync_log enable row level security;

drop policy if exists "insider_sync_log_read" on public.insider_sync_log;
create policy "insider_sync_log_read"
  on public.insider_sync_log
  for select
  to authenticated
  using (true);
