-- Migration 016: calendario delle trimestrali annunciate
--
-- A differenza della stima ricavata dalla cadenza dei depositi, queste
-- sono le date dichiarate dalle aziende.

create table if not exists public.earnings_calendar (
  ticker text not null,
  event_date date not null,
  company text,
  timing text,
  eps_estimate numeric,
  eps_actual numeric,
  surprise_pct numeric,
  updated_at timestamptz not null default now(),
  primary key (ticker, event_date)
);

create index if not exists earnings_calendar_date_idx
  on public.earnings_calendar (event_date);

alter table public.earnings_calendar enable row level security;

drop policy if exists "earnings_calendar_read" on public.earnings_calendar;
create policy "earnings_calendar_read" on public.earnings_calendar
  for select to authenticated using (true);
