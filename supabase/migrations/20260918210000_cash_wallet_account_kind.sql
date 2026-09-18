-- Fiziksel nakdi mevcut hesap/ledger hattında birinci sınıf bakiye kaynağı yap.
-- `card_type` finansal davranışı belirlemeye devam eder; `account_kind` yalnız
-- banka hesabı ile nakit cüzdanını ayırır. Böylece tüm mevcut ödeme, transfer,
-- hareket ve account_ledger invariant'ları nakit için de aynen çalışır.

alter table public.cards
  add column if not exists account_kind text not null default 'bank';

alter table public.cards
  drop constraint if exists cards_account_kind_check;

alter table public.cards
  add constraint cards_account_kind_check
  check (
    account_kind in ('bank', 'cash')
    and (account_kind <> 'cash' or card_type = 'banka_karti')
  );

comment on column public.cards.account_kind is
  'banka_karti satırının banka hesabı (bank) veya fiziksel nakit cüzdanı (cash) olduğunu belirtir.';
