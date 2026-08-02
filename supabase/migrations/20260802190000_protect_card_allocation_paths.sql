-- Existing child rows may only be attached to an early-current settlement or
-- statement by the canonical RPC that updates the matching card aggregates in
-- the same transaction. Historical archive-marker INSERT remains available to
-- backup restore under same-user/same-card RLS validation. Same-card checks
-- alone are insufficient for reallocating an existing movement to an old
-- parent id.

create or replace function private.guard_current_settlement_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reset_user_id text := coalesce(current_setting('app.finance_data_reset_user_id', true), '');
  v_current_allocation_user_id text := coalesce(
    current_setting('app.card_current_settlement_allocation_user_id', true),
    ''
  );
  v_statement_allocation_user_id text := coalesce(
    current_setting('app.card_statement_allocation_user_id', true),
    ''
  );
  v_import_reset_user_id text := coalesce(
    current_setting('app.card_import_reset_user_id', true),
    ''
  );
  v_import_reset_card_id text := coalesce(
    current_setting('app.card_import_reset_card_id', true),
    ''
  );
  v_statement_payment_user_id text := coalesce(
    current_setting('app.card_statement_payment_user_id', true),
    ''
  );
  v_statement_payment_id text := coalesce(
    current_setting('app.card_statement_payment_id', true),
    ''
  );
begin
  -- The reset RPC only needs a narrowly scoped DELETE bypass. It remains
  -- bound both to auth.uid() and to the row owner.
  if tg_op = 'DELETE'
     and v_user_id is not null
     and old.user_id = v_user_id
     and v_reset_user_id = v_user_id::text then
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Backup restore deliberately clears current-settlement markers because
    -- their immutable parent cannot be restored. Therefore authenticated
    -- child inserts never have a legitimate current_settlement_id.
    if v_user_id is not null and new.current_settlement_id is not null then
      raise exception 'Erken ödeme bağlantısı yalnız kart borcu ödeme işlemiyle oluşturulabilir.';
    end if;

    -- Historical statement children are restored by direct inserts. Their
    -- same-user/same-card parent relation remains enforced by RLS policies.
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.current_settlement_id is distinct from new.current_settlement_id then
    if old.current_settlement_id is not null
       or new.current_settlement_id is null
       or v_user_id is null
       or old.user_id <> v_user_id
       or new.user_id <> v_user_id
       or old.card_id <> new.card_id
       or v_current_allocation_user_id <> v_user_id::text
       or not exists (
         select 1
         from public.card_current_settlements settlement
         where settlement.id = new.current_settlement_id
           and settlement.user_id = v_user_id
           and settlement.card_id = new.card_id
       ) then
      raise exception 'Erken ödeme bağlantısı yalnız kart borcu ödeme işlemiyle oluşturulabilir.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.statement_archive_id is distinct from new.statement_archive_id then
    if old.statement_archive_id is not null
       or new.statement_archive_id is null
       or v_user_id is null
       or old.user_id <> v_user_id
       or new.user_id <> v_user_id
       or old.card_id <> new.card_id
       or v_statement_allocation_user_id <> v_user_id::text
       or not exists (
         select 1
         from public.card_statement_archives archive
         where archive.id = new.statement_archive_id
           and archive.user_id = v_user_id
           and archive.card_id = new.card_id
       ) then
      raise exception 'Ekstre bağlantısı yalnız ekstre kesme işlemiyle oluşturulabilir.';
    end if;
  end if;

  -- Once a row has entered a statement, its financial identity and lifecycle
  -- state are historical evidence. Only the canonical statement-payment RPC
  -- may move an archived installment's status/paid_at; category/note cleanup
  -- remains harmless.
  if tg_op = 'UPDATE' then
    -- Keep table-specific OLD/NEW fields inside their own nested branch. A
    -- trigger record has only that table's fields and SQL boolean expressions
    -- do not promise short-circuit evaluation.
    if tg_table_name = 'card_expenses' then
      if (
        old.statement_archive_id is not null
        or exists (
          select 1
          from public.card_installments installment
          where installment.card_expense_id = old.id
            and installment.statement_archive_id is not null
        )
      ) and (
        old.user_id is distinct from new.user_id
        or old.card_id is distinct from new.card_id
        or old.spent_at is distinct from new.spent_at
        or old.amount is distinct from new.amount
        or old.installment_count is distinct from new.installment_count
        or old.installment_amount is distinct from new.installment_amount
        or old.status is distinct from new.status
        or old.posted_at is distinct from new.posted_at
        or old.statement_archive_id is distinct from new.statement_archive_id
        or old.current_settlement_id is distinct from new.current_settlement_id
      ) then
        raise exception 'Ekstreye kesilmiş kart harcamasının finans alanları değiştirilemez.';
      end if;
    elsif tg_table_name = 'card_installments' then
      if old.statement_archive_id is not null then
        if (
           old.user_id is distinct from new.user_id
           or old.card_id is distinct from new.card_id
           or old.card_expense_id is distinct from new.card_expense_id
           or old.installment_no is distinct from new.installment_no
           or old.installment_count is distinct from new.installment_count
           or old.due_month is distinct from new.due_month
           or old.amount is distinct from new.amount
           or old.posted_at is distinct from new.posted_at
           or old.statement_archive_id is distinct from new.statement_archive_id
           or old.current_settlement_id is distinct from new.current_settlement_id
        ) then
          raise exception 'Ekstreye kesilmiş kart taksitinin finans alanları değiştirilemez.';
        end if;

        if (
          old.status is distinct from new.status
          or old.paid_at is distinct from new.paid_at
        ) and (
          v_user_id is null
          or old.user_id <> v_user_id
          or new.user_id <> v_user_id
          or v_statement_payment_user_id <> v_user_id::text
          or v_statement_payment_id <> old.statement_archive_id::text
          or old.status <> 'posted'
          or old.paid_at is not null
          or new.status <> 'paid'
          or new.paid_at is null
        ) then
          raise exception 'Ekstreye kesilmiş kart taksitinin durumu yalnız ekstre ödeme işlemiyle değiştirilebilir.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    if tg_table_name = 'card_expenses' then
      if old.statement_archive_id is not null
         or exists (
           select 1
           from public.card_installments installment
           where installment.card_expense_id = old.id
             and installment.statement_archive_id is not null
         ) then
        if not (
          v_user_id is not null
          and old.user_id = v_user_id
          and v_import_reset_user_id = v_user_id::text
          and v_import_reset_card_id = old.card_id::text
          and (
            old.statement_archive_id is null
            or exists (
              select 1
              from public.card_statement_archives archive
              where archive.id = old.statement_archive_id
                and archive.user_id = v_user_id
                and archive.card_id = old.card_id
                and coalesce(archive.status, 'open') <> 'paid'
            )
          )
          and not exists (
            select 1
            from public.card_installments installment
            join public.card_statement_archives archive
              on archive.id = installment.statement_archive_id
            where installment.card_expense_id = old.id
              and coalesce(archive.status, 'open') = 'paid'
          )
        ) then
          raise exception 'Ekstreye kesilmiş kart harcaması silinemez.';
        end if;
      end if;
    elsif old.statement_archive_id is not null
       or (
         old.card_expense_id is not null
         and exists (
           select 1
           from public.card_installments sibling
           where sibling.card_expense_id = old.card_expense_id
             and sibling.statement_archive_id is not null
         )
       ) then
      if not (
        v_user_id is not null
        and old.user_id = v_user_id
        and v_import_reset_user_id = v_user_id::text
        and v_import_reset_card_id = old.card_id::text
        and (
          old.statement_archive_id is null
          or exists (
            select 1
            from public.card_statement_archives archive
            where archive.id = old.statement_archive_id
              and archive.user_id = v_user_id
              and archive.card_id = old.card_id
              and coalesce(archive.status, 'open') <> 'paid'
          )
        )
        and not exists (
          select 1
          from public.card_installments sibling
          join public.card_statement_archives archive
            on archive.id = sibling.statement_archive_id
          where sibling.card_expense_id = old.card_expense_id
            and coalesce(archive.status, 'open') = 'paid'
        )
      ) then
        raise exception 'Ekstreye kesilmiş kart taksiti silinemez.';
      end if;
    end if;
  end if;

  -- Early-current settlement children are immutable after allocation. The
  -- reset DELETE bypass above is the only exception.
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
  elsif old.current_settlement_id is not null
     or (
       tg_op = 'DELETE'
       and
       old.card_expense_id is not null
       and exists (
         select 1
         from public.card_installments sibling
         where sibling.card_expense_id = old.card_expense_id
           and sibling.current_settlement_id is not null
       )
     ) then
    raise exception 'Erken ödemeyle kapanmış kart taksiti değiştirilemez veya silinemez.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.guard_current_settlement_allocation() from public;
revoke all on function private.guard_current_settlement_allocation() from anon;
revoke all on function private.guard_current_settlement_allocation() from authenticated;

drop trigger if exists guard_current_settled_expense on public.card_expenses;
create trigger guard_current_settled_expense
before insert or update or delete on public.card_expenses
for each row execute function private.guard_current_settlement_allocation();

drop trigger if exists guard_current_settled_installment on public.card_installments;
create trigger guard_current_settled_installment
before insert or update or delete on public.card_installments
for each row execute function private.guard_current_settlement_allocation();

create or replace function private.guard_card_statement_archive_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reset_user_id text := coalesce(current_setting('app.finance_data_reset_user_id', true), '');
  v_import_reset_user_id text := coalesce(
    current_setting('app.card_import_reset_user_id', true),
    ''
  );
  v_import_reset_card_id text := coalesce(
    current_setting('app.card_import_reset_card_id', true),
    ''
  );
  v_statement_payment_user_id text := coalesce(
    current_setting('app.card_statement_payment_user_id', true),
    ''
  );
  v_statement_payment_id text := coalesce(
    current_setting('app.card_statement_payment_id', true),
    ''
  );
begin
  if tg_op = 'DELETE' then
    if v_user_id is not null
       and old.user_id = v_user_id
       and v_reset_user_id = v_user_id::text then
      return old;
    end if;

    if v_user_id is not null
       and old.user_id = v_user_id
       and v_import_reset_user_id = v_user_id::text
       and v_import_reset_card_id = old.card_id::text
       and coalesce(old.status, 'open') <> 'paid' then
      return old;
    end if;

    raise exception 'Ekstre arşivi yalnız kanonik veri sıfırlama işlemiyle silinebilir.';
  end if;

  if old.id is distinct from new.id
     or old.user_id is distinct from new.user_id
     or old.card_id is distinct from new.card_id
     or old.period_year is distinct from new.period_year
     or old.period_month is distinct from new.period_month
     or old.statement_date is distinct from new.statement_date
     or old.due_date is distinct from new.due_date
     or old.statement_debt_amount is distinct from new.statement_debt_amount
     or old.current_period_spending is distinct from new.current_period_spending
     or old.total_debt_amount is distinct from new.total_debt_amount then
    raise exception 'Ekstre arşivinin finans alanları değiştirilemez.';
  end if;

  if old.status is distinct from new.status
     or old.paid_at is distinct from new.paid_at
     or old.payment_source_card_id is distinct from new.payment_source_card_id then
    if v_user_id is null
       or old.user_id <> v_user_id
       or new.user_id <> v_user_id
       or v_statement_payment_user_id <> v_user_id::text
       or v_statement_payment_id <> old.id::text
       or old.status <> 'open'
       or old.paid_at is not null
       or old.payment_source_card_id is not null
       or new.status <> 'paid'
       or new.paid_at is null
       or new.payment_source_card_id is null then
      raise exception 'Ekstre arşivi yalnız ekstre ödeme işlemiyle kapatılabilir.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_card_statement_archive_mutation() from public;
revoke all on function private.guard_card_statement_archive_mutation() from anon;
revoke all on function private.guard_card_statement_archive_mutation() from authenticated;

drop trigger if exists guard_card_statement_archive_mutation on public.card_statement_archives;
create trigger guard_card_statement_archive_mutation
before update or delete on public.card_statement_archives
for each row execute function private.guard_card_statement_archive_mutation();

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

    perform set_config(
      'app.card_current_settlement_allocation_user_id',
      v_user_id::text,
      true
    );

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

    perform set_config('app.card_current_settlement_allocation_user_id', '', true);
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

revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from public;
revoke execute on function public.pay_card_debt(uuid, uuid, numeric) from anon;
grant execute on function public.pay_card_debt(uuid, uuid, numeric) to authenticated;

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
    v_due_day := least(
      v_card.due_day,
      extract(day from (v_due_month_start + interval '1 month - 1 day'))::integer
    );
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

  perform set_config('app.card_statement_allocation_user_id', v_user_id::text, true);

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

  perform set_config('app.card_statement_allocation_user_id', '', true);

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

revoke execute on function public.cut_card_statement(uuid) from public;
revoke execute on function public.cut_card_statement(uuid) from anon;
grant execute on function public.cut_card_statement(uuid) to authenticated;

-- Archived installment lifecycle changes are allowed only while paying their
-- exact parent statement. The trigger validates both transaction-local values.
create or replace function public.pay_card_statement(
  p_statement_id uuid,
  p_source_card_id uuid
)
returns public.card_statement_archives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_statement public.card_statement_archives%rowtype;
  v_paid_statement public.card_statement_archives%rowtype;
  v_card public.cards%rowtype;
  v_source public.cards%rowtype;
  v_payment_amount numeric(14, 2);
  v_has_remaining_open boolean;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  -- Match cut/import lock order: card first, then statement/children. The
  -- statement is re-read under lock after the initial unlocked card lookup.
  select card_id
  into v_initial_card_id
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Ekstre bulunamadi.';
  end if;

  select *
  into v_card
  from public.cards
  where id = v_initial_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadi.';
  end if;

  select *
  into v_statement
  from public.card_statement_archives
  where id = p_statement_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Ekstre bulunamadi veya karti degisti; yeniden deneyin.';
  end if;

  if v_statement.status <> 'open' then
    raise exception 'Bu ekstre zaten kapali.';
  end if;

  if v_card.card_type <> 'kredi_karti' then
    raise exception 'Ekstre odemesi sadece kredi karti icin kullanilabilir.';
  end if;

  v_payment_amount := round(greatest(0, v_statement.statement_debt_amount), 2);

  if v_payment_amount <= 0 then
    raise exception 'Ekstre tutari 0 oldugu icin odeme yapilamaz.';
  end if;

  if round(v_card.statement_debt_amount, 2) < v_payment_amount
     or round(v_card.debt_amount, 2) < v_payment_amount then
    raise exception 'Kart borcu ekstre tutariyla uyusmuyor. Veri sagligi kontrolunu calistir.';
  end if;

  v_source := private.debit_bank_account(p_source_card_id, v_payment_amount);

  update public.cards
  set debt_amount = greatest(0, debt_amount - v_payment_amount),
      statement_debt_amount = greatest(0, statement_debt_amount - v_payment_amount),
      updated_at = now()
  where id = v_card.id;

  perform set_config('app.card_statement_payment_user_id', v_user_id::text, true);
  perform set_config('app.card_statement_payment_id', v_statement.id::text, true);

  update public.card_installments
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and card_id = v_card.id
    and statement_archive_id = v_statement.id
    and status <> 'paid';

  update public.card_statement_archives
  set status = 'paid',
      paid_at = now(),
      payment_source_card_id = v_source.id,
      updated_at = now()
  where id = v_statement.id
  returning * into v_paid_statement;

  perform set_config('app.card_statement_payment_id', '', true);
  perform set_config('app.card_statement_payment_user_id', '', true);

  select exists(
    select 1
    from public.card_statement_archives
    where card_id = v_card.id
      and user_id = v_user_id
      and status = 'open'
  ) into v_has_remaining_open;

  if not v_has_remaining_open then
    update public.cards
    set current_period_spending = current_period_spending + statement_debt_amount,
        statement_debt_amount = 0,
        updated_at = now()
    where id = v_card.id
      and statement_debt_amount > 0;
  end if;

  insert into public.transaction_history (
    user_id, type, title, amount, source_table, source_id, note
  )
  values (
    v_user_id,
    'payment',
    v_card.card_name || ' ekstresi odendi',
    v_payment_amount,
    'card_statement_archives',
    v_statement.id,
    v_source.card_name || ' hesabindan odendi. Bagli kart taksitleri otomatik kapatildi.'
  );

  return v_paid_statement;
end;
$$;

revoke execute on function public.pay_card_statement(uuid, uuid) from public;
revoke execute on function public.pay_card_statement(uuid, uuid) from anon;
grant execute on function public.pay_card_statement(uuid, uuid) to authenticated;

-- Clean import may rebuild an open archive, but its DELETE bypass is scoped to
-- the authenticated user and one card locked by this canonical RPC.
create or replace function public.reset_card_import_data(
  p_card_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_archive_ids uuid[] := array[]::uuid[];
  v_expense_ids uuid[] := array[]::uuid[];
  v_installment_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  perform 1
  from public.cards
  where id = p_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  -- A clean rebuild cannot replay immutable early-payment evidence or safely
  -- reconstruct a partially historical installment plan. Fail before deleting
  -- anything; the normal non-destructive import flow remains available.
  if exists (
    select 1
    from public.card_expenses expense
    where expense.user_id = v_user_id
      and expense.card_id = p_card_id
      and expense.current_settlement_id is not null
  ) or exists (
    select 1
    from public.card_installments installment
    where installment.user_id = v_user_id
      and installment.card_id = p_card_id
      and installment.current_settlement_id is not null
  ) then
    raise exception 'Erken ödeme geçmişi bulunan kart temiz içe aktarımla sıfırlanamaz.';
  end if;

  if exists (
    select 1
    from public.card_installments installment
    join public.card_statement_archives archive
      on archive.id = installment.statement_archive_id
    where installment.user_id = v_user_id
      and installment.card_id = p_card_id
      and coalesce(archive.status, 'open') = 'paid'
  ) then
    raise exception 'Ödenmiş ekstreye bağlı taksit geçmişi temiz içe aktarımla yeniden kurulamaz.';
  end if;

  select coalesce(array_agg(id), array[]::uuid[])
  into v_archive_ids
  from public.card_statement_archives
  where card_id = p_card_id
    and user_id = v_user_id
    and coalesce(status, 'open') <> 'paid';

  select coalesce(array_agg(id), array[]::uuid[])
  into v_expense_ids
  from public.card_expenses
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
    );

  select coalesce(array_agg(id), array[]::uuid[])
  into v_installment_ids
  from public.card_installments
  where card_id = p_card_id
    and user_id = v_user_id
    and (
      statement_archive_id is null
      or statement_archive_id = any(v_archive_ids)
      or card_expense_id = any(v_expense_ids)
    );

  delete from public.transaction_history
  where user_id = v_user_id
    and (
      (source_table = 'card_expenses' and source_id = any(v_expense_ids))
      or (source_table = 'card_installments' and source_id = any(v_installment_ids))
      or (source_table = 'card_statement_archives' and source_id = any(v_archive_ids))
    );

  perform set_config('app.card_import_reset_user_id', v_user_id::text, true);
  perform set_config('app.card_import_reset_card_id', p_card_id::text, true);

  delete from public.card_installments
  where id = any(v_installment_ids)
    and user_id = v_user_id;

  delete from public.card_expenses
  where id = any(v_expense_ids)
    and user_id = v_user_id;

  delete from public.card_statement_archives
  where id = any(v_archive_ids)
    and user_id = v_user_id;

  perform set_config('app.card_import_reset_card_id', '', true);
  perform set_config('app.card_import_reset_user_id', '', true);

  update public.cards
  set debt_amount = 0,
      statement_debt_amount = 0,
      current_period_spending = 0,
      provision_amount = 0,
      updated_at = now()
  where id = p_card_id
    and user_id = v_user_id;
end;
$$;

revoke execute on function public.reset_card_import_data(uuid) from public;
revoke execute on function public.reset_card_import_data(uuid) from anon;
grant execute on function public.reset_card_import_data(uuid) to authenticated;

-- The legacy whole-card reset predates immutable statement/current-settlement
-- evidence and has no safe reversal model. It has no application caller; remove
-- it until an append-only correction workflow replaces it.
drop function if exists public.reset_card_data(uuid);
