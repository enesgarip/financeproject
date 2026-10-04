-- Hesap ve kredi kartlarında kullanıcı kontrollü hızlı erişim sırası.
-- Finansal alanlara/ledger trigger'larına dokunmaz; eski satırlar favori değildir.
alter table public.cards
  add column if not exists is_favorite boolean not null default false;

comment on column public.cards.is_favorite is
  'Kullanıcının işlem seçicilerinde ve hesap/kart listelerinde öne aldığı kayıt.';
