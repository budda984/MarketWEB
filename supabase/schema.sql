-- ============================================================================
-- Market Monitor Pro — Supabase schema
-- ============================================================================
-- Esegui nel SQL Editor di Supabase. Richiede auth.users abilitato (default).
-- ============================================================================

-- Abilita pgcrypto per gen_random_uuid (in Supabase è già attivo)
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. SIGNALS — storico dei segnali rilevati dallo scanner
-- ============================================================================
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  ticker text not null,
  strategy text not null default 'HMA50_HA',
  strength smallint not null check (strength between 0 and 3),
  price numeric not null,
  hma_value numeric,
  distance_pct numeric,
  crossed_bars_ago int,
  change_pct numeric,
  ha_bullish boolean,
  details text,
  signal_at timestamptz not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'TP_HIT', 'SL_HIT', 'TIME_STOP', 'CLOSED')),
  entry_price numeric,
  exit_price numeric,
  exit_at timestamptz,
  pnl_percent numeric,
  market text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signals_user_signal_at_idx
  on public.signals (user_id, signal_at desc);
create index if not exists signals_user_ticker_idx
  on public.signals (user_id, ticker);
create index if not exists signals_user_status_idx
  on public.signals (user_id, status);

-- ============================================================================
-- 2. PRICE_HISTORY — cache candele (condivisa fra utenti, key ticker+day)
-- ============================================================================
create table if not exists public.price_history (
  ticker text not null,
  bar_date date not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume bigint,
  created_at timestamptz not null default now(),
  primary key (ticker, bar_date)
);

create index if not exists price_history_ticker_idx
  on public.price_history (ticker, bar_date desc);

-- ============================================================================
-- 3. WATCHLISTS
-- ============================================================================
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tickers text[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ============================================================================
-- 4. ALERTS — allarmi prezzo
-- ============================================================================
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  direction text not null check (direction in ('above', 'below')),
  target_price numeric not null,
  note text,
  active boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists alerts_user_active_idx
  on public.alerts (user_id, active);

-- ============================================================================
-- 5. BACKTEST_RESULTS — risultati di backtest salvati
-- ============================================================================
create table if not exists public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  strategy text not null default 'HMA50_HA',
  params jsonb not null,
  universe text[] not null,
  date_from date,
  date_to date,
  total_trades int,
  win_rate numeric,
  total_pnl numeric,
  max_drawdown numeric,
  avg_bars_held numeric,
  trades jsonb,
  equity jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backtest_results_user_idx
  on public.backtest_results (user_id, created_at desc);

-- ============================================================================
-- 6. SCAN_RUNS — log delle scansioni del cron
-- ============================================================================
create table if not exists public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tickers_scanned int,
  signals_found int,
  errors int,
  triggered_by text -- 'cron' | 'manual'
);

-- ============================================================================
-- 7. USER_SETTINGS
-- ============================================================================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_bot_token text,
  telegram_chat_id text,
  default_markets text[] not null default array['S&P 500','NASDAQ','Crypto','Europa']::text[],
  hma_period int not null default 50,
  lookback_bars int not null default 10,
  min_strength smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.signals           enable row level security;
alter table public.watchlists        enable row level security;
alter table public.alerts            enable row level security;
alter table public.backtest_results  enable row level security;
alter table public.user_settings     enable row level security;
alter table public.price_history     enable row level security;
alter table public.scan_runs         enable row level security;

-- Signals: ogni utente vede solo i propri (oltre a quelli "pubblici" user_id null)
drop policy if exists "signals_select" on public.signals;
create policy "signals_select" on public.signals
  for select using (user_id = auth.uid() or user_id is null);
drop policy if exists "signals_insert" on public.signals;
create policy "signals_insert" on public.signals
  for insert with check (user_id = auth.uid() or user_id is null);
drop policy if exists "signals_update" on public.signals;
create policy "signals_update" on public.signals
  for update using (user_id = auth.uid());
drop policy if exists "signals_delete" on public.signals;
create policy "signals_delete" on public.signals
  for delete using (user_id = auth.uid());

-- Watchlists
drop policy if exists "watchlists_all" on public.watchlists;
create policy "watchlists_all" on public.watchlists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Alerts
drop policy if exists "alerts_all" on public.alerts;
create policy "alerts_all" on public.alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Backtest results
drop policy if exists "backtests_all" on public.backtest_results;
create policy "backtests_all" on public.backtest_results
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- User settings
drop policy if exists "settings_all" on public.user_settings;
create policy "settings_all" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Price history: leggibile a tutti gli utenti autenticati, scrittura solo service role
drop policy if exists "price_history_read" on public.price_history;
create policy "price_history_read" on public.price_history
  for select using (auth.role() = 'authenticated');

-- Scan runs: leggibile a tutti gli utenti autenticati
drop policy if exists "scan_runs_read" on public.scan_runs;
create policy "scan_runs_read" on public.scan_runs
  for select using (auth.role() = 'authenticated');

-- ============================================================================
-- Trigger: updated_at automatico
-- ============================================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists signals_updated_at on public.signals;
create trigger signals_updated_at before update on public.signals
  for each row execute function public.handle_updated_at();

drop trigger if exists watchlists_updated_at on public.watchlists;
create trigger watchlists_updated_at before update on public.watchlists
  for each row execute function public.handle_updated_at();

drop trigger if exists settings_updated_at on public.user_settings;
create trigger settings_updated_at before update on public.user_settings
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- Function: statistiche aggregate per l'utente
-- ============================================================================
create or replace function public.get_signal_stats(p_user_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where status = 'ACTIVE'),
    'tp_hits', count(*) filter (where status = 'TP_HIT'),
    'sl_hits', count(*) filter (where status = 'SL_HIT'),
    'win_rate', round(
      count(*) filter (where status = 'TP_HIT')::numeric /
      nullif(count(*) filter (where status in ('TP_HIT','SL_HIT')), 0) * 100,
      1
    ),
    'total_pnl', coalesce(round(sum(pnl_percent) filter (where status != 'ACTIVE'), 2), 0),
    'by_strength', (
      select jsonb_object_agg(strength::text, cnt) from (
        select strength, count(*) as cnt
        from public.signals
        where user_id = p_user_id
        group by strength
      ) s
    )
  ) into result
  from public.signals
  where user_id = p_user_id;

  return coalesce(result, '{}'::jsonb);
end;
$$;

-- ============================================================================
-- Seed: watchlist di default per nuovi utenti
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.watchlists (user_id, name, tickers, is_default)
  values (new.id, '⭐ I Miei Preferiti', array[]::text[], true)
  on conflict (user_id, name) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Realtime: abilita la tabella signals per la pubblicazione Realtime
-- ============================================================================
alter publication supabase_realtime add table public.signals;
