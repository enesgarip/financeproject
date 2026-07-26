-- Allow selling gold by adding a direction column to gold_lots.
-- Existing rows are purchases ('buy'); new rows can be 'sell'.

alter table public.gold_lots
  add column if not exists direction text not null default 'buy'
  check (direction in ('buy', 'sell'));

comment on column public.gold_lots.direction is
  'buy = alım, sell = satım. Satışta quantity stoktan düşer.';
