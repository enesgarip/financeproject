-- T1: card_installments RPC-only yazım + parent-user invariantı (güvenlik dilimi).
--
-- BM denetiminden beri bekleyen iş; DEFINER geçiş denetimi (2026-08-25, ajan
-- raporu) kapıyı açtı: taksit tablosuna yazan 5 INVOKER fonksiyondan 4'ü
-- (cancel_card_expense, cancel_card_provision, cut_card_statement,
-- post_due_card_installments) satır bazlı user filtreleri + search_path='' +
-- NULL-uid reddiyle DEFINER'a hazırdı; update_card_expense'te ÜÇ satır user
-- filtresizdi ve önce düzeltildi (aşağıdaki gövde):
--   1) arşiv guard'ı exists'i, 2) posted taksit toplamı (dönem içi kovaya
--   giriyordu — RLS'siz yanlış toplama bakiye bozardı), 3) taksit DELETE'i
--   (kardeş cancel_card_expense aynı işi filtreli yapıyordu).
--
-- Sonra: 5 fonksiyon SECURITY DEFINER olur (RLS'e değil gövde filtrelerine
-- güven — cron impersonation yolu zaten böyle çalışıyordu, ona etki yok);
-- authenticated'tan UPDATE/DELETE çekilir ve karşılık policy'leri kaldırılır
-- (ledger deseni: select+insert kalır — insert, JSON restore yolunun ihtiyacı).
-- RLS WITH CHECK devreden çıkan yazım yolları için parent-user invariantı
-- DB'ye iner: (user_id, card_expense_id) → card_expenses(user_id, id) bileşik
-- FK — başka kullanıcının harcamasına taksit satırı bağlamak artık şema
-- seviyesinde imkânsız (card_expense_id NULL satırlar — bağımsız devirler —
-- MATCH SIMPLE ile muaf, goal_sources'taki desen).

CREATE OR REPLACE FUNCTION public.update_card_expense(p_expense_id uuid, p_amount numeric, p_description text, p_spent_at date DEFAULT NULL::date, p_installment_count integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS card_expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_initial_card_id uuid;
  v_expense public.card_expenses%rowtype;
  v_card public.cards%rowtype;
  v_installment_count integer;
  v_installment_amount numeric(14, 2);
  v_first_installment_amount numeric(14, 2);
  v_due_month date;
  v_spent_at date;
  v_category text;
  v_posted_period_amount numeric(14, 2) := 0;
  v_paid_before integer := 0;
  v_start_installment_no integer := 1;
  v_current_period_amount numeric(14, 2) := 0;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Harcama tutari 0''dan buyuk olmali.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama aciklamasi zorunlu.';
  end if;

  -- Statement cutting locks card -> children. Use the same order here to avoid
  -- a child -> card / card -> child deadlock. Re-read the expense under lock
  -- after locking the card because the first lookup is intentionally unlocked.
  select card_id
  into v_initial_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadi.';
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
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card.id
  for update;

  if not found then
    raise exception 'Harcama bulunamadi veya karti degisti; yeniden deneyin.';
  end if;

  if v_expense.status <> 'posted' then
    raise exception 'Sadece kesinlesmis harcamalar duzenlenebilir.';
  end if;

  -- cut_card_statement locks this same card before allocating children. Check
  -- only after that lock so a concurrent cut cannot attach an installment
  -- between this decision and the edit's child-row rebuild.
  if v_expense.statement_archive_id is not null
     or exists (
       select 1
       from public.card_installments installment
       where installment.card_expense_id = v_expense.id
         and installment.user_id = v_user_id
         and installment.statement_archive_id is not null
     ) then
    raise exception 'Ekstreye kesilmis kart harcamasi duzenlenemez.';
  end if;

  v_installment_count := greatest(1, least(coalesce(p_installment_count, v_expense.installment_count), 36));
  v_spent_at := coalesce(p_spent_at, v_expense.spent_at);
  v_category := coalesce(nullif(btrim(coalesce(p_category, '')), ''), v_expense.category);

  if v_card.card_type = 'banka_karti' and v_installment_count > 1 then
    raise exception 'Taksitli harcama sadece kredi karti icin kullanilabilir.';
  end if;

  -- Devreden plan notu geçmiş taksit sayısını taşır; iki format da tanınır.
  -- Eski RPC: "N/M taksiti uygulama öncesinde ödendi."
  -- 20260809190000: "N/M taksit ekstre öncesinde tamamlandı; yalnız açık plan tutulur."
  -- Tanınmazsa düzenleme geçmiş taksitleri sıfır sayıp planı 1..M yeniden kurar.
  if v_expense.note ~ '^[0-9]+/[0-9]+ taksiti uygulama [oö]ncesinde [oö]dendi\.$' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksiti uygulama [oö]ncesinde [oö]dendi\.$'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  elsif v_expense.note ~ '^[0-9]+/[0-9]+ taksit ekstre [oö]ncesinde tamamland[iı]' then
    v_paid_before := greatest(0, least(
      v_installment_count - 1,
      (regexp_match(v_expense.note, '^([0-9]+)/([0-9]+) taksit ekstre [oö]ncesinde tamamland[iı]'))[1]::integer
    ));
    v_start_installment_no := v_paid_before + 1;
  end if;

  v_first_installment_amount := case
    when v_installment_count = 1 then p_amount
    else round(p_amount / v_installment_count, 2)
  end;

  if v_card.card_type = 'kredi_karti' then
    select coalesce(sum(amount), 0)
    into v_posted_period_amount
    from public.card_installments
    where card_expense_id = v_expense.id
      and user_id = v_user_id
      and status = 'posted';

    if v_posted_period_amount = 0 then
      v_posted_period_amount := case
        when v_expense.installment_count <= 1 then v_expense.amount
        else v_expense.installment_amount
      end;
    end if;

    update public.cards
    set debt_amount = greatest(0, debt_amount - v_expense.amount),
        current_period_spending = greatest(0, current_period_spending - v_posted_period_amount),
        updated_at = now()
    where id = v_card.id;
  else
    update public.cards
    set current_balance = current_balance + v_expense.amount,
        updated_at = now()
    where id = v_card.id;

    -- Bakiye kontrolu IADE SONRASI degeri kullanmali: v_card iade oncesi
    -- okundu, guncel bakiye v_card.current_balance + v_expense.amount.
    -- Eskisi yanlis red uretiyordu (bakiye 0, eski 100, yeni 50 -> hata).
    if v_card.current_balance + v_expense.amount < p_amount then
      raise exception 'Banka karti bakiyesi yetersiz.';
    end if;
  end if;

  delete from public.card_installments
  where card_expense_id = v_expense.id
    and user_id = v_user_id;

  update public.card_expenses
  set spent_at = v_spent_at,
      amount = p_amount,
      description = btrim(coalesce(p_description, '')),
      category = v_category,
      installment_count = v_installment_count,
      installment_amount = v_first_installment_amount,
      note = coalesce(p_note, v_expense.note),
      updated_at = now()
  where id = v_expense.id
  returning * into v_expense;

  if v_card.card_type = 'kredi_karti' then
    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;
        if v_due_month <= private.today_ist() then
          v_current_period_amount := v_current_period_amount + v_installment_amount;
        end if;
      end loop;
    else
      v_current_period_amount := p_amount;
    end if;

    update public.cards
    set debt_amount = debt_amount + p_amount,
        current_period_spending = current_period_spending + v_current_period_amount,
        updated_at = now()
    where id = v_card.id;

    if v_installment_count > 1 then
      for v_installment_no in v_start_installment_no..v_installment_count loop
        v_installment_amount := round(p_amount / v_installment_count, 2);
        if v_installment_no = v_installment_count then
          v_installment_amount := p_amount - (round(p_amount / v_installment_count, 2) * (v_installment_count - 1));
        end if;

        v_due_month := (v_spent_at + ((v_installment_no - 1) * interval '1 month'))::date;

        insert into public.card_installments (
          user_id,
          card_id,
          card_expense_id,
          installment_no,
          installment_count,
          due_month,
          amount,
          description,
          category,
          status,
          posted_at
        )
        values (
          v_user_id,
          v_card.id,
          v_expense.id,
          v_installment_no,
          v_installment_count,
          v_due_month,
          v_installment_amount,
          btrim(coalesce(p_description, '')),
          v_category,
          case when v_due_month <= private.today_ist() then 'posted' else 'scheduled' end,
          case when v_due_month <= private.today_ist() then now() else null end
        );
      end loop;
    end if;
  else
    update public.cards
    set current_balance = current_balance - p_amount,
        updated_at = now()
    where id = v_card.id;
  end if;

  return v_expense;
end;
$function$

;

-- 4 hazır fonksiyon DEFINER'a (gövdeleri değişmedi; denetim raporu onay kapısı).
alter function public.cancel_card_expense(uuid) security definer;
alter function public.cancel_card_provision(uuid) security definer;
alter function public.cut_card_statement(uuid, date, date) security definer;
alter function public.post_due_card_installments() security definer;

-- Parent-user invariantı: RLS WITH CHECK'in yerini şema kısıtı alır.
alter table public.card_expenses
  add constraint card_expenses_user_id_key unique (user_id, id);
alter table public.card_installments
  add constraint card_installments_parent_user_fk
  foreign key (user_id, card_expense_id)
  references public.card_expenses (user_id, id);

-- RPC-only yazım (ledger deseni): dogrudan UPDATE/DELETE kapanır; SELECT
-- (okuma) ve INSERT (JSON restore replay'i) kalır.
revoke update, delete on table public.card_installments from authenticated;
drop policy if exists card_installments_update_own on public.card_installments;
drop policy if exists card_installments_delete_own on public.card_installments;
