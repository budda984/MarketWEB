-- Migration 003: Dedup storico + prevenzione futuri duplicati
--
-- Pulisce lo storico mantenendo solo la riga più recente per ogni coppia
-- (user_id, ticker, strategy) e previene futuri duplicati con un constraint.

-- STEP 1 — Dedup: tieni solo la riga più recente per (user_id, ticker, strategy)
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, ticker, strategy
      order by signal_at desc, id desc
    ) as rn
  from public.signals
)
delete from public.signals
where id in (
  select id from ranked where rn > 1
);

-- STEP 2 — Constraint UNIQUE con NULLS NOT DISTINCT (Postgres 15+)
-- Così due righe con user_id NULL, stesso ticker e stessa strategy sono
-- considerate duplicate (altrimenti null ≠ null le farebbe passare tutte).

alter table public.signals
  drop constraint if exists signals_unique_per_entity;

alter table public.signals
  add constraint signals_unique_per_entity
  unique nulls not distinct (user_id, ticker, strategy);

-- STEP 3 — Verifica
select
  'Post-dedup' as stage,
  count(*) as total_rows,
  count(distinct (user_id::text, ticker, strategy)) as unique_keys
from public.signals;
