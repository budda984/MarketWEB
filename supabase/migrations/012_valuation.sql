-- Migration 012: giudizio di valutazione dai bilanci SEC

create table if not exists public.valuations (
  ticker text primary key,
  price numeric,
  ttm_eps numeric,
  ttm_revenue numeric,
  eps_growth_pct numeric,
  revenue_growth_pct numeric,
  net_margin numeric,
  margin_change_pct numeric,
  current_pe numeric,
  median_pe numeric,
  pe_discount_pct numeric,
  verdict_level text,
  verdict_headline text,
  verdict_reasons jsonb default '[]'::jsonb,
  last_report_date date,
  quarters_available int,
  updated_at timestamptz not null default now()
);

create index if not exists valuations_discount_idx
  on public.valuations (pe_discount_pct desc nulls last);
create index if not exists valuations_level_idx
  on public.valuations (verdict_level);

alter table public.valuations enable row level security;

drop policy if exists "valuations_read" on public.valuations;
create policy "valuations_read" on public.valuations
  for select to authenticated using (true);
