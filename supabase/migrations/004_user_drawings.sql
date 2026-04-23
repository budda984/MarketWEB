-- Migration 004: tabella per disegni utente sul chart
--
-- Ogni riga rappresenta una collezione di disegni per un singolo
-- ticker di un singolo utente. drawings_json è un array di oggetti
-- con { id, type, points, options }.

create table if not exists public.user_drawings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  drawings_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);

-- RLS: ogni utente vede solo i suoi disegni
alter table public.user_drawings enable row level security;

drop policy if exists "users_own_drawings_select" on public.user_drawings;
create policy "users_own_drawings_select"
  on public.user_drawings
  for select
  using (auth.uid() = user_id);

drop policy if exists "users_own_drawings_insert" on public.user_drawings;
create policy "users_own_drawings_insert"
  on public.user_drawings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "users_own_drawings_update" on public.user_drawings;
create policy "users_own_drawings_update"
  on public.user_drawings
  for update
  using (auth.uid() = user_id);

drop policy if exists "users_own_drawings_delete" on public.user_drawings;
create policy "users_own_drawings_delete"
  on public.user_drawings
  for delete
  using (auth.uid() = user_id);

-- Index per lookup veloce (oltre alla UNIQUE già creata)
create index if not exists user_drawings_ticker_idx
  on public.user_drawings (ticker);

-- Trigger per aggiornare updated_at automaticamente
create or replace function public.touch_user_drawings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_drawings_touch on public.user_drawings;
create trigger user_drawings_touch
  before update on public.user_drawings
  for each row
  execute function public.touch_user_drawings_updated_at();
