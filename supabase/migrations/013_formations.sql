-- Migration 013: archivio delle figure rilevate
--
-- Serve a non perdere le figure fra una scansione e l'altra e a sapere
-- da quando una figura e' sotto osservazione.

create table if not exists public.formations (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  kind text not null,
  state text not null,
  neckline numeric not null,
  price numeric not null,
  distance_to_neckline_pct numeric,
  depth_pct numeric,
  target numeric,
  bars_span int,
  points jsonb default '[]'::jsonb,
  market text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  -- Stato al primo avvistamento: permette di riconoscere le figure che
  -- sono progredite da 'in formazione' a 'collo rotto'
  first_state text,
  unique (ticker, kind)
);

create index if not exists formations_last_seen_idx
  on public.formations (last_seen desc);
create index if not exists formations_state_idx
  on public.formations (state, last_seen desc);

alter table public.formations enable row level security;

drop policy if exists "formations_read" on public.formations;
create policy "formations_read" on public.formations
  for select to authenticated using (true);
