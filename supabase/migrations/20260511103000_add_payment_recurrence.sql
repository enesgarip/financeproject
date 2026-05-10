alter table public.payments
add column if not exists recurrence text not null default 'none',
add column if not exists recurrence_day integer,
add column if not exists recurrence_end_date date;

update public.payments
set recurrence = 'none'
where recurrence is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_recurrence_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_recurrence_check
    check (recurrence in ('none', 'monthly'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_recurrence_day_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
    add constraint payments_recurrence_day_check
    check (
      (recurrence = 'none' and recurrence_day is null)
      or (recurrence = 'monthly' and recurrence_day between 1 and 31)
    );
  end if;
end $$;

create index if not exists payments_user_recurrence_due_idx on public.payments(user_id, recurrence, due_date);
