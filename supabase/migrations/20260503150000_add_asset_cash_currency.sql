alter table public.assets
add column if not exists currency text check (currency in ('TRY', 'USD', 'EUR', 'GBP'));

update public.assets
set currency = 'TRY'
where category = 'Nakit'
  and currency is null;
