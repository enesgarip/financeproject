-- Full current-balance payments made before statement cut (for example
-- Yapı Kredi) need row-level allocation. Lowering cards.current_period_spending
-- alone leaves posted expenses/installments eligible for a later statement.

create table if not exists public.card_current_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  source_card_id uuid not null references public.cards(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  settled_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.card_expenses
add column if not exists current_settlement_id uuid
references public.card_current_settlements(id) on delete restrict;

alter table public.card_installments
add column if not exists current_settlement_id uuid
references public.card_current_settlements(id) on delete restrict;

create index if not exists card_current_settlements_user_card_idx
on public.card_current_settlements(user_id, card_id, settled_at desc);

create index if not exists card_expenses_current_settlement_idx
on public.card_expenses(current_settlement_id)
where current_settlement_id is not null;

create index if not exists card_installments_current_settlement_idx
on public.card_installments(current_settlement_id)
where current_settlement_id is not null;

alter table public.card_current_settlements enable row level security;

drop policy if exists "card_current_settlements_select_own" on public.card_current_settlements;
create policy "card_current_settlements_select_own"
on public.card_current_settlements
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.card_current_settlements from anon;
revoke all on table public.card_current_settlements from public;
grant select on table public.card_current_settlements to authenticated;

drop trigger if exists set_card_current_settlements_updated_at on public.card_current_settlements;
create trigger set_card_current_settlements_updated_at
before update on public.card_current_settlements
for each row execute function public.set_updated_at();

create or replace function private.guard_current_settlement_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'card_expenses' then
    if old.current_settlement_id is not null
       or exists (
         select 1
         from public.card_installments
         where card_expense_id = old.id
           and current_settlement_id is not null
       ) then
      raise exception 'Erken ödemeyle kapanmış kart harcaması değiştirilemez veya silinemez.';
    end if;
  elsif old.current_settlement_id is not null then
    raise exception 'Erken ödemeyle kapanmış kart taksiti değiştirilemez veya silinemez.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_current_settled_expense on public.card_expenses;
create trigger guard_current_settled_expense
before update or delete on public.card_expenses
for each row execute function private.guard_current_settlement_allocation();

drop trigger if exists guard_current_settled_installment on public.card_installments;
create trigger guard_current_settled_installment
before update or delete on public.card_installments
for each row execute function private.guard_current_settlement_allocation();

create or replace function public.pay_card_debt(
  p_card_id uuid,
  p_source_card_id uuid,
  p_amount numeric
)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_paid_card public.cards%rowtype;
  v_settlement public.card_current_settlements%rowtype;
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_payable_amount numeric(14, 2);
  v_remaining_payment numeric(14, 2);
  v_next_statement_debt numeric(14, 2);
  v_next_current_period numeric(14, 2);
  v_single_total numeric(14, 2) := 0;
  v_installment_total numeric(14, 2) := 0;
  v_is_full_current_settlement boolean := false;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if v_amount <= 0 then
    raise exception 'Ödeme tutarı 0''dan büyük olmalı.';
  end if;

  if p_card_id = p_source_card_id then
    raise exception 'Kaynak hesap ve borç kartı aynı olamaz.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Borç ödenecek kredi kartı bulunamadı.';
  end if;

  v_payable_amount := greatest(0, v_card.statement_debt_amount + v_card.current_period_spending);

  if v_payable_amount <= 0 then
    raise exception 'Ödenecek kesinleşmiş kart borcu yok.';
  end if;

  if v_amount > v_payable_amount then
    raise exception 'Ödeme tutarı ekstre ve dönem içi kesinleşmiş kart borcundan büyük olamaz.';
  end if;

  v_is_full_current_settlement :=
    v_card.statement_debt_amount = 0
    and v_amount = v_card.current_period_spending;

  if v_is_full_current_settlement then
    select coalesce(sum(amount), 0)
    into v_single_total
    from public.card_expenses
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    select coalesce(sum(amount), 0)
    into v_installment_total
    from public.card_installments
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;

    if (v_single_total + v_installment_total) <> v_card.current_period_spending then
      raise exception 'Güncel borcun hareket dağılımı uyuşmuyor. Önce Veri Sağlığı kontrolünü çalıştır.';
    end if;
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_amount);

  if v_is_full_current_settlement then
    insert into public.card_current_settlements (
      user_id, card_id, source_card_id, amount, settled_at, note
    )
    values (
      v_user_id,
      v_card.id,
      v_source.id,
      v_amount,
      now(),
      'Ekstre kesilmeden güncel borcun tamamı ödendi.'
    )
    returning * into v_settlement;

    update public.card_expenses
    set current_settlement_id = v_settlement.id,
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and installment_count <= 1
      and statement_archive_id is null
      and current_settlement_id is null;

    update public.card_installments
    set current_settlement_id = v_settlement.id,
        status = 'paid',
        paid_at = now(),
        updated_at = now()
    where user_id = v_user_id
      and card_id = v_card.id
      and status = 'posted'
      and statement_archive_id is null
      and current_settlement_id is null;
  end if;

  v_remaining_payment := v_amount;
  v_next_statement_debt := greatest(0, v_card.statement_debt_amount - v_remaining_payment);
  v_remaining_payment := greatest(0, v_remaining_payment - v_card.statement_debt_amount);
  v_next_current_period := greatest(0, v_card.current_period_spending - v_remaining_payment);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_amount),
      statement_debt_amount = v_next_statement_debt,
      current_period_spending = v_next_current_period,
      updated_at = now()
  where id = v_card.id
  returning * into v_paid_card;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id,
    'payment',
    v_card.card_name || case
      when v_is_full_current_settlement then ' güncel borcu kapatıldı'
      else ' kart borcu ödendi'
    end,
    v_amount,
    case when v_is_full_current_settlement then 'card_current_settlements' else 'cards' end,
    case when v_is_full_current_settlement then v_settlement.id else v_card.id end,
    v_source.card_name || ' hesabından ödendi. ' || case
      when v_is_full_current_settlement
      then 'Dönem içi hareketler ve vadesi gelmiş taksitler erken kapatıldı.'
      else 'Gelecek kredi kartı taksitleri kapatılmadı.'
    end
  );

  return v_paid_card;
end;
$$;

grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from public;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from anon;

-- Statement cutting must ignore single expenses already allocated to a full
-- current-balance settlement. Paid installment rows are already excluded by
-- their status.
create or replace function public.cut_card_statement(
  p_card_id uuid
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card public.cards%rowtype;
  v_archive public.card_statement_archives%rowtype;
  v_statement_amount numeric(14, 2);
  v_due_month_start date;
  v_due_date date;
  v_due_day integer;
  v_period_year integer;
  v_period_month integer;
  v_boundary date;
  v_this_boundary date;
  v_prev_month_start date;
  v_next_period_spending numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  select *
  into v_card
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found or v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre kesilecek kredi kartı bulunamadı.';
  end if;

  if v_card.statement_day is not null then
    v_this_boundary := make_date(
      extract(year from current_date)::integer,
      extract(month from current_date)::integer,
      least(
        v_card.statement_day,
        extract(day from (date_trunc('month', current_date)::date + interval '1 month - 1 day'))::integer
      )
    );
    if current_date > v_this_boundary then
      v_boundary := v_this_boundary;
    else
      v_prev_month_start := (date_trunc('month', current_date) - interval '1 month')::date;
      v_boundary := make_date(
        extract(year from v_prev_month_start)::integer,
        extract(month from v_prev_month_start)::integer,
        least(
          v_card.statement_day,
          extract(day from (v_prev_month_start + interval '1 month - 1 day'))::integer
        )
      );
    end if;
  else
    v_boundary := current_date;
  end if;

  v_period_year := extract(year from v_boundary)::integer;
  v_period_month := extract(month from v_boundary)::integer;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_card.id::text || ':' || v_period_year::text || ':' || v_period_month::text, 0)
  );

  select *
  into v_archive
  from public.card_statement_archives
  where user_id = v_user_id
    and card_id = v_card.id
    and period_year = v_period_year
    and period_month = v_period_month
  order by created_at desc
  limit 1;

  if found then
    return v_archive;
  end if;

  if v_card.current_period_spending <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  select coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_expenses
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at > v_boundary;

  select v_next_period_spending + coalesce(sum(amount), 0)
  into v_next_period_spending
  from public.card_installments
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month > v_boundary;

  v_statement_amount := greatest(0, v_card.current_period_spending - v_next_period_spending);

  if v_statement_amount <= 0 then
    raise exception 'Dönem içi harcama olmadığı için kesilecek ekstre yok.';
  end if;

  if v_card.due_day is not null then
    v_due_month_start := date_trunc('month', v_boundary)::date;
    if v_card.statement_day is not null and v_card.due_day <= v_card.statement_day then
      v_due_month_start := (v_due_month_start + interval '1 month')::date;
    end if;
    v_due_day := least(v_card.due_day, extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer);
    v_due_date := v_due_month_start + (v_due_day - 1);
  end if;

  insert into public.card_statement_archives (
    user_id, card_id, period_year, period_month, statement_date, due_date,
    statement_debt_amount, current_period_spending, total_debt_amount, status, note
  )
  values (
    v_user_id, v_card.id, v_period_year, v_period_month, v_boundary, v_due_date,
    v_statement_amount, v_statement_amount, v_card.debt_amount, 'open',
    v_card.card_name || ' ekstresi kesildi.'
  )
  returning * into v_archive;

  update public.card_expenses
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and current_settlement_id is null
    and installment_count <= 1
    and spent_at <= v_boundary;

  update public.card_installments
  set statement_archive_id = v_archive.id,
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and status = 'posted'
    and statement_archive_id is null
    and due_month <= v_boundary;

  update public.cards
  set statement_debt_amount = statement_debt_amount + v_statement_amount,
      current_period_spending = v_next_period_spending,
      updated_at = now()
  where id = v_card.id;

  insert into public.transaction_history (user_id, type, title, amount, source_table, source_id, note)
  values (
    v_user_id, 'card', v_card.card_name || ' ekstresi kesildi', v_statement_amount,
    'card_statement_archives', v_archive.id,
    'Dönem borcu ekstreye aktarıldı. Erken kapatılmış hareketler ve vadesi gelmemiş taksitler dışarıda bırakıldı.'
  );

  return v_archive;
end;
$$;

grant execute on function public.cut_card_statement(uuid) to authenticated;
