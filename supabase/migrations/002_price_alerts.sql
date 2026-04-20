-- Migration 002: Price alerts
-- Tabella per gli avvisi di prezzo configurabili dall'utente.
--
-- Struttura:
--   direction='cross': scatta in qualsiasi direzione (classico cross-over)
--   direction='above': scatta solo quando prezzo > threshold
--   direction='below': scatta solo quando prezzo < threshold
--   one_shot: se true l'alert si auto-disabilita dopo il trigger
--   triggered_at: timestamp dell'ultimo trigger (null se mai triggered)
--   last_price: ultimo prezzo visto (per detect cross-over)

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  threshold numeric not null,
  direction text not null check (direction in ('above', 'below', 'cross')),
  one_shot boolean not null default false,
  note text,
  active boolean not null default true,
  triggered_at timestamptz,
  last_price numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_user on public.price_alerts (user_id);
create index if not exists idx_alerts_active on public.price_alerts (active) where active = true;
create index if not exists idx_alerts_ticker on public.price_alerts (ticker);

-- RLS
alter table public.price_alerts enable row level security;

drop policy if exists "Users read own alerts" on public.price_alerts;
create policy "Users read own alerts" on public.price_alerts
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own alerts" on public.price_alerts;
create policy "Users insert own alerts" on public.price_alerts
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own alerts" on public.price_alerts;
create policy "Users update own alerts" on public.price_alerts
  for update using (auth.uid() = user_id);

drop policy if exists "Users delete own alerts" on public.price_alerts;
create policy "Users delete own alerts" on public.price_alerts
  for delete using (auth.uid() = user_id);
