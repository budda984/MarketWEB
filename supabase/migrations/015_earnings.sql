-- Migration 015: trimestrali pubblicate
--
-- I dati arrivano dai bilanci SEC gia' scaricati per le valutazioni:
-- nessuna richiesta aggiuntiva.

create table if not exists public.earnings_reports (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  period_end date not null,
  filed_date date,
  eps numeric,
  revenue numeric,
  form text,
  updated_at timestamptz not null default now(),
  unique (ticker, period_end)
);

create index if not exists earnings_filed_idx
  on public.earnings_reports (filed_date desc);
create index if not exists earnings_ticker_idx
  on public.earnings_reports (ticker, period_end desc);

alter table public.earnings_reports enable row level security;

drop policy if exists "earnings_read" on public.earnings_reports;
create policy "earnings_read" on public.earnings_reports
  for select to authenticated using (true);

-- Stima del prossimo deposito, ricavata dalla cadenza storica
alter table public.valuations
  add column if not exists next_report_estimate date,
  add column if not exists cadence_days numeric;
