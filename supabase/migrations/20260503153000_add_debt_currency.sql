alter table public.debts
add column if not exists currency text check (currency in ('TRY', 'USD', 'EUR', 'GBP'));

update public.debts
set currency = 'TRY'
where value_type = 'TRY'
  and currency is null;

alter table public.debts
drop constraint if exists debts_value_type_check;

alter table public.debts
add constraint debts_value_type_check
check (value_type in ('TRY', 'doviz', 'gram_altin', 'ceyrek_altin'));
