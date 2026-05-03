alter table public.cards
add column if not exists credit_limit numeric(14, 2) not null default 0 check (credit_limit >= 0);

update public.cards
set card_type = 'banka_karti'
where card_type = 'vadesiz_hesap';

alter table public.cards
drop constraint if exists cards_card_type_check;

alter table public.cards
add constraint cards_card_type_check
check (card_type in ('banka_karti', 'kredi_karti'));
