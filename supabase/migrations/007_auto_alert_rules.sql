-- Migration 007: regole di alert automatiche
--
-- A differenza di price_alerts (una soglia fissa su un singolo titolo),
-- una regola si applica a un intero mercato e la soglia viene
-- ricalcolata a ogni scansione a partire dal minimo di periodo.
--
-- Esempio: "avvisami quando un titolo dell'S&P 500 scende sotto il
-- minimo a 6 mesi +10%".

create table if not exists public.auto_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text,
  market text not null,

  -- Finestra su cui calcolare il minimo: 126 barre ~ 6 mesi,
  -- 252 ~ 1 anno
  lookback_days int not null default 126,

  -- Percentuale sopra il minimo che definisce il tetto della fascia
  threshold_pct numeric not null default 10,

  -- Percentuale sopra il minimo oltre la quale l'alert si "riarma".
  -- Serve a non ricevere la stessa notifica ogni giorno mentre il
  -- titolo resta nella fascia.
  rearm_pct numeric not null default 18,

  -- Scarta i titoli in caduta libera: se il prezzo e' sceso piu' di
  -- questa percentuale negli ultimi 30 giorni, non avvisa. Un titolo
  -- che sta crollando e' vicino ai minimi per definizione.
  max_drop_30d_pct numeric not null default 25,

  active boolean not null default true,
  notify_telegram boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists auto_alert_rules_user_idx
  on public.auto_alert_rules (user_id);
create index if not exists auto_alert_rules_active_idx
  on public.auto_alert_rules (active) where active = true;

alter table public.auto_alert_rules enable row level security;

drop policy if exists "auto_rules_select" on public.auto_alert_rules;
create policy "auto_rules_select" on public.auto_alert_rules
  for select using (auth.uid() = user_id);

drop policy if exists "auto_rules_insert" on public.auto_alert_rules;
create policy "auto_rules_insert" on public.auto_alert_rules
  for insert with check (auth.uid() = user_id);

drop policy if exists "auto_rules_update" on public.auto_alert_rules;
create policy "auto_rules_update" on public.auto_alert_rules
  for update using (auth.uid() = user_id);

drop policy if exists "auto_rules_delete" on public.auto_alert_rules;
create policy "auto_rules_delete" on public.auto_alert_rules
  for delete using (auth.uid() = user_id);


-- Scatti registrati. Serve sia per mostrarli in interfaccia sia per
-- sapere se un titolo e' gia' stato segnalato e non ripetersi.
create table if not exists public.auto_alert_hits (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.auto_alert_rules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  ticker text not null,
  price numeric not null,
  period_low numeric not null,
  threshold numeric not null,
  pct_above_low numeric not null,
  drop_from_high_pct numeric,

  -- 'armed' = notificato, in attesa che il titolo esca dalla fascia
  -- 'cleared' = risalito sopra rearm_pct, potra' essere ri-notificato
  state text not null default 'armed',

  triggered_at timestamptz not null default now(),
  cleared_at timestamptz,

  unique (rule_id, ticker, state)
);

create index if not exists auto_alert_hits_user_idx
  on public.auto_alert_hits (user_id, triggered_at desc);
create index if not exists auto_alert_hits_rule_idx
  on public.auto_alert_hits (rule_id, ticker);

alter table public.auto_alert_hits enable row level security;

drop policy if exists "auto_hits_select" on public.auto_alert_hits;
create policy "auto_hits_select" on public.auto_alert_hits
  for select using (auth.uid() = user_id);

drop policy if exists "auto_hits_delete" on public.auto_alert_hits;
create policy "auto_hits_delete" on public.auto_alert_hits
  for delete using (auth.uid() = user_id);
