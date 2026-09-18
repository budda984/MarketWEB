-- Migration 018: componente Heikin Ashi separata nei segnali
--
-- Serve a distinguere, nella scheda Segnali, i titoli che hanno appena
-- incrociato la Hull da quelli la cui prima Heikin Ashi verde senza
-- ombra inferiore e' comparsa oggi. Il segnale resta la combinazione
-- delle due, ma le due componenti diventano filtrabili.
--
-- Sedute dalla prima candela verde pulita della serie in corso:
-- 0 = il cambio da rosso a verde e' avvenuto con l'ultima candela.

alter table public.signals
  add column if not exists ha_flip_bars_ago integer;

create index if not exists signals_ha_flip_idx
  on public.signals (ha_flip_bars_ago);
