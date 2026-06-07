-- Ekstre mutabakatı: kart ekstre arşivine "bankanın bildirdiği gerçek tutar"
-- alanını ekler. App'in hesapladığı statement_debt_amount ile bu tutar
-- arasındaki fark (delta) türetilir; böylece kaçak bir taksit/harcama ay
-- sonunu beklemeden görünür olur.

alter table public.card_statement_archives
add column if not exists reconciled_bank_amount numeric(14, 2)
  check (reconciled_bank_amount is null or reconciled_bank_amount >= 0),
add column if not exists reconciled_at timestamptz,
add column if not exists reconciliation_note text;

-- Bir dönemin arşivine banka tarafının bildirdiği tutarı işler.
create or replace function public.set_statement_reconciliation(
  p_card_id uuid,
  p_period_year integer,
  p_period_month integer,
  p_bank_amount numeric,
  p_note text default null
)
returns public.card_statement_archives
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_archive public.card_statement_archives%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if p_bank_amount is null or p_bank_amount < 0 then
    raise exception 'Banka tutari gecersiz.';
  end if;

  update public.card_statement_archives
  set reconciled_bank_amount = round(p_bank_amount, 2),
      reconciled_at = now(),
      reconciliation_note = p_note,
      updated_at = now()
  where user_id = v_user_id
    and card_id = p_card_id
    and period_year = p_period_year
    and period_month = p_period_month
  returning * into v_archive;

  if not found then
    raise exception 'Bu donem icin kesilmis ekstre bulunamadi; once ekstre kesilmeli.';
  end if;

  return v_archive;
end;
$$;

revoke execute on function public.set_statement_reconciliation(uuid, integer, integer, numeric, text) from anon;
revoke execute on function public.set_statement_reconciliation(uuid, integer, integer, numeric, text) from public;
grant execute on function public.set_statement_reconciliation(uuid, integer, integer, numeric, text) to authenticated;
