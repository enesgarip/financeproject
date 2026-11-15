-- Hesap bakiyesine işlenmeyen kişisel ödeme/tahsilatta hesap gerekmiyor.
-- Eski istemcilerin gönderdiği hesaplar ve SMS eşlemeleri doğrulanmaya devam eder.
do $migration$
declare
  v_definition text;
  v_anchor text;
begin
  select pg_get_functiondef('private.settle_personal_debt_internal(uuid,uuid,uuid,numeric,boolean,timestamptz,text)'::regprocedure)
    into v_definition;

  v_anchor := '  if p_skip_account_move then';
  if position(v_anchor in v_definition) = 0 then
    raise exception 'personal debt skip-account anchor missing';
  end if;
  v_definition := replace(v_definition, v_anchor, '  if p_skip_account_move and p_account_card_id is null then
    -- Yalnız kişisel kayıt değişir; hesap/ledger hareketi yok.
    null;
  elsif p_skip_account_move then');

  v_anchor := $$v_account.card_name || ' hesabından ödendi.'$$;
  if position(v_anchor in v_definition) = 0 then
    raise exception 'personal debt payment note anchor missing';
  end if;
  v_definition := replace(v_definition, v_anchor,
    $$coalesce(v_account.card_name || ' hesabından ödendi.', 'Hesap hareketi oluşturmadan ödendi.')$$);

  v_anchor := $$v_account.card_name || ' hesabına tahsil edildi.'$$;
  if position(v_anchor in v_definition) = 0 then
    raise exception 'personal debt collection note anchor missing';
  end if;
  v_definition := replace(v_definition, v_anchor,
    $$coalesce(v_account.card_name || ' hesabına tahsil edildi.', 'Hesap hareketi oluşturmadan tahsil edildi.')$$);

  execute v_definition;
end;
$migration$;
