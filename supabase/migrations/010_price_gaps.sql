-- Migration 010: gap di apertura

create table if not exists public.price_gaps (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  gap_date date not null,
  direction text not null check (direction in ('up', 'down')),
  gap_pct numeric not null,
  open_price numeric not null,
  target_price numeric not null,
  edge_price numeric,
  filled boolean not null default false,
  fill_date date,
  days_to_fill int,
  days_open int,
  market text,
  updated_at timestamptz not null default now(),
  unique (ticker, gap_date)
);

create index if not exists price_gaps_open_idx
  on public.price_gaps (filled, gap_date desc);
create index if not exists price_gaps_ticker_idx
  on public.price_gaps (ticker, gap_date desc);

alter table public.price_gaps enable row level security;

drop policy if exists "price_gaps_read" on public.price_gaps;
create policy "price_gaps_read" on public.price_gaps
  for select to authenticated using (true);


create table if not exists public.gap_stats (
  ticker text primary key,
  total_gaps int not null default 0,
  open_gaps int not null default 0,
  filled_5d int default 0,
  eligible_5d int default 0,
  filled_20d int default 0,
  eligible_20d int default 0,
  filled_60d int default 0,
  eligible_60d int default 0,
  median_days_to_fill numeric,
  updated_at timestamptz not null default now()
);

alter table public.gap_stats enable row level security;

drop policy if exists "gap_stats_read" on public.gap_stats;
create policy "gap_stats_read" on public.gap_stats
  for select to authenticated using (true);
