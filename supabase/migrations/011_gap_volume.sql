-- Migration 011: volume della seduta del gap
--
-- Serve a distinguere i gap da notizia (volume elevato) da quelli
-- ordinari, e a confrontare i rispettivi tassi di chiusura.

alter table public.price_gaps
  add column if not exists volume numeric,
  add column if not exists avg_volume numeric,
  add column if not exists volume_ratio numeric;

create index if not exists price_gaps_volratio_idx
  on public.price_gaps (volume_ratio desc nulls last);
