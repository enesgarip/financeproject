-- Kart son 4 hanesi — SMS/bildirim otomasyonunda kartı eşleştirmek için.
alter table public.cards add column if not exists last_four_digits text;

comment on column public.cards.last_four_digits is
  'Son 4 hane (ör. "9032"). SMS parse edge function kartı bu kolonla eşleştirir.';
