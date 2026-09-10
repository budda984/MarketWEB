-- Migration 014: momento dell'ultimo cambio di stato
--
-- Serve a ordinare per data in modo sensato: per una figura rotta la
-- data che conta e' quella della rottura, non quella in cui la figura
-- e' comparsa per la prima volta.

alter table public.formations
  add column if not exists state_changed_at timestamptz;

-- Per le righe gia' presenti si parte dal primo avvistamento
update public.formations
  set state_changed_at = coalesce(state_changed_at, first_seen);

create index if not exists formations_state_changed_idx
  on public.formations (state, state_changed_at desc);
