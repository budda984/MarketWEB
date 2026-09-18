-- Migration 019: trade chiusi nel Replay, base delle statistiche
--
-- I tempi (entry_time, exit_time) sono secondi unix gia' spostati
-- sull'ora della borsa, come li mostra il grafico del replay.

create table if not exists public.replay_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  base_tf text not null,
  timeframe text not null,
  side text not null check (side in ('LONG', 'SHORT')),
  order_type text not null default 'MARKET',
  planned_entry numeric not null,
  entry_price numeric not null,
  stop_price numeric not null,
  target_price numeric not null,
  exit_price numeric not null,
  exit_reason text not null,
  r_multiple numeric not null,
  pnl_pct numeric not null,
  mae_r numeric,
  mfe_r numeric,
  bars_held integer,
  entry_time bigint not null,
  exit_time bigint not null,
  created_at timestamptz not null default now()
);

alter table public.replay_trades enable row level security;

drop policy if exists "replay_trades_select" on public.replay_trades;
create policy "replay_trades_select" on public.replay_trades
  for select using (auth.uid() = user_id);

drop policy if exists "replay_trades_insert" on public.replay_trades;
create policy "replay_trades_insert" on public.replay_trades
  for insert with check (auth.uid() = user_id);

drop policy if exists "replay_trades_delete" on public.replay_trades;
create policy "replay_trades_delete" on public.replay_trades
  for delete using (auth.uid() = user_id);

create index if not exists replay_trades_user_created_idx
  on public.replay_trades (user_id, created_at);
