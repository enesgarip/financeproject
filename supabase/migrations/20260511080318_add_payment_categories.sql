alter table public.payments
add column if not exists category text not null default 'Diğer';

update public.payments
set category = 'Diğer'
where category is null
   or btrim(category) = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_category_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_category_check
    check (category in ('Fatura', 'Dijital üyelik', 'Kira / aidat', 'Sigorta', 'Vergi / devlet', 'Eğitim', 'Sağlık', 'Diğer'));
  end if;
end $$;

create index if not exists payments_user_category_due_idx on public.payments(user_id, category, due_date);
