-- F011: monetary values remain two-decimal TL; non-TRY debt quantities
-- must retain proportional precision across partial settlements and revaluation.
-- Existing historical quantities are preserved; lost past precision is not inferred.
-- Keep the former 12 integer digits; add enough fractional quantity precision.
alter table public.debts alter column amount type numeric(38,26);

do $migration$
declare
  v_definition text;
  v_anchor text := 'v_next_amount := round(coalesce(v_debt.amount, 0) * v_ratio, 4);';
begin
  select pg_get_functiondef('private.settle_personal_debt_internal(uuid,uuid,uuid,numeric,boolean,timestamptz,text)'::regprocedure) into v_definition;
  if position(v_anchor in v_definition) = 0 then
    raise exception 'settle_personal_debt_internal quantity anchor missing';
  end if;
  execute replace(v_definition, v_anchor, 'v_next_amount := coalesce(v_debt.amount, 0) * v_ratio;');
end;
$migration$;
