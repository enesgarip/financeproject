-- Kesilmiş açık ekstre döneminde kalmış provizyonu elle kesinleştirmek, tutarı
-- yeni döneme taşır. Ekstre PDF'i bu kapsamın kaynak gerçeğidir; post işlemi
-- yerine statement import kullanılmalıdır.
--
-- post_card_provision'ın para/taksit mantığını kopyalamamak için mevcut tanımı
-- yerinde, doğrulanan tek bir anchor üzerinden genişletiyoruz. Anchor bulunmazsa
-- migration sessizce eksik koruma bırakmak yerine durur.
do $migration$
declare
  v_definition text;
  v_anchor text := E'  v_post_amount := round(coalesce(p_post_amount, v_expense.amount), 2);';
  v_guard text := E'  if exists (\n'
    || E'    select 1\n'
    || E'    from public.card_statement_archives archive\n'
    || E'    where archive.card_id = v_expense.card_id\n'
    || E'      and archive.user_id = v_user_id\n'
    || E'      and coalesce(archive.status, ''open'') = ''open''\n'
    || E'      and archive.statement_date >= v_expense.spent_at\n'
    || E'  ) then\n'
    || E'    raise exception ''Bu provizyon kesilmis ekstre doneminde. Kesinlestirmek yerine ekstre PDFini ice aktar.'';\n'
    || E'  end if;\n\n'
    || E'  v_post_amount := round(coalesce(p_post_amount, v_expense.amount), 2);';
begin
  select pg_get_functiondef('public.post_card_provision(uuid,numeric)'::regprocedure)
  into v_definition;

  if position(v_anchor in v_definition) = 0 then
    raise exception 'post_card_provision guard anchor bulunamadi.';
  end if;

  execute replace(v_definition, v_anchor, v_guard);
end;
$migration$;
