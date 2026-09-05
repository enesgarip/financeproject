-- Bakım sırası düzeltmesi: stale provizyon post'u EKSTRE KESİMİNDEN ÖNCE koşar.
--
-- Eski sıra (taksit post → kesim → provizyon post) bir kova kaçağı üretiyordu:
-- 7 günü doldurmuş bir provizyon kesim GÜNÜ bile ancak ekstre kesildikten sonra
-- post edildiği için dönem içine düşüyor ve bir SONRAKİ ekstreye kayıyordu.
-- Banka gerçeğinde o işlem çoktan onaylanıp kesilen ekstreye girmişti — uygulama
-- ekstresi bankadan düşük, provizyon kovası şişkin kalıyordu (2026-09-05 vakası).
--
-- Yeni sıra: stale provizyon post → vadesi gelen taksit post → ekstre kesimi.
-- Böylece stale eşiğini doldurmuş provizyon kesime yetişir; `cut_due_card_statements`
-- yalnız `current_period_spending > 0` kartlara baktığı için, tek hareketi
-- provizyon olan kartın ekstresi de artık doğru kesilir.
--
-- Çift sayma yok: `post_card_provision` geçmiş vadeli taksit satırlarını doğrudan
-- 'posted' yaratır ve dönem içi tutarını kendisi ekler; `post_due_card_installments`
-- yalnız 'scheduled' satırları çevirir. İki adım ayrık kümelere dokunur.
--
-- Not: kesim sırasında hâlâ stale OLMAYAN (taze) provizyonlar bilinçli olarak
-- post edilmez — banka gerçekten onaylamadıysa işlem ekstreye girmemeli. O boşluğu
-- push bildirimi kapatır (provision_statement_cut_risk, push-notify).
-- Gerçek-DB regresyonu: supabase/tests/provision_statement_cut_order.sql

CREATE OR REPLACE FUNCTION public.run_scheduled_card_maintenance(p_provision_stale_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user record;
  v_expense record;
  v_user_count integer := 0;
  v_statements_cut integer := 0;
  v_installments_posted integer := 0;
  v_provisions_posted integer := 0;
  v_cut integer;
  v_posted integer;
begin
  for v_user in
    select distinct user_id
    from public.cards
    where card_type = 'kredi_karti'
  loop
    v_user_count := v_user_count + 1;

    perform set_config('request.jwt.claim.sub', v_user.user_id::text, true);

    -- 1) Stale provizyonlar KESİMDEN ÖNCE dönem içine iner ki kesime yetişsinler.
    for v_expense in
      select id
      from public.card_expenses
      where user_id = v_user.user_id
        and status = 'provision'
        and spent_at <= (private.today_ist() - p_provision_stale_days)
    loop
      begin
        perform public.post_card_provision(v_expense.id);
        v_provisions_posted := v_provisions_posted + 1;
      exception
        when others then
          raise notice 'Provizyon dusurme basarisiz (harcama %): %', v_expense.id, sqlerrm;
      end;
    end loop;

    -- 2) Vadesi gelen planlı taksitler dönem içine.
    begin
      v_posted := public.post_due_card_installments();
      v_installments_posted := v_installments_posted + coalesce(v_posted, 0);
    exception
      when others then
        raise notice 'Taksit post islemi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;

    -- 3) Ekstre kesimi en son: 1-2'nin doldurduğu dönem içi tutarlar kesime girer.
    begin
      v_cut := public.cut_due_card_statements();
      v_statements_cut := v_statements_cut + coalesce(v_cut, 0);
    exception
      when others then
        raise notice 'Ekstre kesimi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);

  return jsonb_build_object(
    'users', v_user_count,
    'statements_cut', v_statements_cut,
    'installments_posted', v_installments_posted,
    'provisions_posted', v_provisions_posted,
    'provision_stale_days', p_provision_stale_days,
    'ran_at', now()
  );
end;
$function$
;

comment on function public.run_scheduled_card_maintenance(integer) is
  'Günlük kart bakımı: stale provizyon post → vadesi gelen taksit post → ekstre kesimi. '
  'Provizyon post''u bilinçli olarak kesimden ÖNCE koşar (20260905100000): stale provizyon '
  'kesime yetişmeli, yoksa banka ekstresine girmiş işlem uygulamada bir sonraki ekstreye kayar.';
