-- Migration 017: fonte dei bilanci nelle valutazioni
--
-- Le valutazioni arrivano dalla SEC per i titoli USA e da Yahoo per gli
-- altri mercati. Le righe gia' presenti vengono tutte dalla SEC.

alter table public.valuations
  add column if not exists source text not null default 'sec';

create index if not exists valuations_source_idx
  on public.valuations (source);
