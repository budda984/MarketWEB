-- Migration 008: stato del trend settimanale sulla HMA50
--
-- Una riga per titolo con lo stato corrente. Serve a riconoscere il
-- cambio di stato e a non ripetere la stessa notifica.

create table if not exists public.weekly_trend_state (
  ticker text primary key,
  state text not null check (state in ('above', 'below')),
  close numeric not null,
  hma_value numeric not null,
  distance_pct numeric,
  bar_date date not null,
  flipped_at date,
  previous_state text,
  updated_at timestamptz not null default now()
);

alter table public.weekly_trend_state enable row level security;

drop policy if exists "weekly_state_read" on public.weekly_trend_state;
create policy "weekly_state_read" on public.weekly_trend_state
  for select to authenticated using (true);


-- Storico dei cambi di stato
create table if not exists public.weekly_trend_flips (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  direction text not null check (direction in ('bullish', 'bearish')),
  close numeric not null,
  hma_value numeric not null,
  distance_pct numeric,
  bar_date date not null,
  created_at timestamptz not null default now(),
  unique (ticker, bar_date)
);

create index if not exists weekly_flips_date_idx
  on public.weekly_trend_flips (bar_date desc);
create index if not exists weekly_flips_dir_idx
  on public.weekly_trend_flips (direction, bar_date desc);

alter table public.weekly_trend_flips enable row level security;

drop policy if exists "weekly_flips_read" on public.weekly_trend_flips;
create policy "weekly_flips_read" on public.weekly_trend_flips
  for select to authenticated using (true);
