delete from public.card_installments as installment
using public.card_expenses as expense
where installment.card_expense_id = expense.id
  and expense.installment_count = 1;
