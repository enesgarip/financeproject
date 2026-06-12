-- Güven turu — Madde 1: card_expenses.installment_amount yazma-anı invariant'ı.
-- Taksit tutarı artık türetilmiş bir alan: tek çekim (count <= 1) ise = amount,
-- aksi halde = round(amount / installment_count, 2). Hangi yazma yolu olursa olsun
-- (add_card_expense RPC, taksit devri, manuel düzenleme) tutar tutarlı kalır ve
-- DataHealth "taksit tutarı tutarsız" uyarısı imkânsızlaşır.
-- TS ikizi: src/utils/financeSummary.ts → expectedInstallmentAmount().

create or replace function public.derive_card_expense_installment_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount is null then
    return new;
  end if;

  if new.installment_count is null or new.installment_count <= 1 then
    new.installment_amount := round(new.amount, 2);
  else
    new.installment_amount := round(new.amount / new.installment_count, 2);
  end if;

  return new;
end;
$$;

drop trigger if exists card_expenses_derive_installment_amount on public.card_expenses;
create trigger card_expenses_derive_installment_amount
  before insert or update on public.card_expenses
  for each row execute function public.derive_card_expense_installment_amount();

-- Tek seferlik normalizasyon: mevcut tutarsız satırları aynı kurala çek
-- (count'a göre türetilmiş tutar). Trigger zaten devreye girdiği için bu UPDATE
-- her satırı doğru değere taşır; idempotent.
update public.card_expenses
set installment_amount = case
  when installment_count is null or installment_count <= 1 then round(amount, 2)
  else round(amount / installment_count, 2)
end
where amount is not null
  and installment_amount is distinct from case
    when installment_count is null or installment_count <= 1 then round(amount, 2)
    else round(amount / installment_count, 2)
  end;
