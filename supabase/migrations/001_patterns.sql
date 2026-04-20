-- ============================================================================
-- Migration 001: Pattern Recognition support
-- ============================================================================
-- Esegui nel SQL Editor di Supabase per aggiungere il supporto ai pattern
-- (Head & Shoulders, e futuri Wedge/Flag/Cup) senza ricreare il DB.
-- ============================================================================

-- Colonna jsonb per metadati del pattern (keyPoints, neckline, target, SL, ecc)
alter table public.signals
  add column if not exists pattern_data jsonb;

-- Indice per filtrare velocemente per strategy (es. solo PATTERN_HS)
create index if not exists signals_user_strategy_idx
  on public.signals (user_id, strategy);

-- Indice per trovare solo i segnali con pattern
create index if not exists signals_has_pattern_idx
  on public.signals (user_id, signal_at desc)
  where pattern_data is not null;
