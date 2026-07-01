alter table public.cards
add column if not exists iban text;

comment on column public.cards.iban is
  'Banka hesapları için paylaşılabilir IBAN. SMS hesap numarası eşleştirmesindeki account_number alanından ayrıdır.';
