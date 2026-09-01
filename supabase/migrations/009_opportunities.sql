-- Migration 009: risultati del radar giornaliero

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  ticker text not null,
  market text,
  sector_name text,
  sector_rank int,

  price numeric not null,
  weekly_state text,
  weekly_flip_recent boolean default false,

  trend_score int not null,
  discount_score int not null,
  ha_score int not null,
  insider_buyers int default 0,
  total_score int not null,

  rsi14 numeric,
  dist_from_52w_high numeric,
  dist_from_ma50 numeric,
  perf_3m numeric,
  ha_flip_bars_ago int,
  trend_checks_passed int,
  reasons jsonb default '[]'::jsonb,

  created_at timestamptz not null default now(),
  unique (run_date, ticker)
);

create index if not exists opportunities_date_score_idx
  on public.opportunities (run_date desc, total_score desc);
create index if not exists opportunities_ticker_idx
  on public.opportunities (ticker);

alter table public.opportunities enable row level security;

drop policy if exists "opportunities_read" on public.opportunities;
create policy "opportunities_read" on public.opportunities
  for select to authenticated using (true);
