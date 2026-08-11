-- Migration 006: cache per i dati statici della SEC
--
-- La mappa ticker -> CIK non cambia quasi mai, ma va scaricata da
-- www.sec.gov/files/company_tickers.json che e' protetto e restituisce
-- 403 quando l'IP e' sotto limitazione. Salvandola qui la scarichiamo
-- una volta al mese invece che a ogni sincronizzazione.

create table if not exists public.sec_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.sec_cache enable row level security;

drop policy if exists "sec_cache_read" on public.sec_cache;
create policy "sec_cache_read"
  on public.sec_cache for select to authenticated using (true);
