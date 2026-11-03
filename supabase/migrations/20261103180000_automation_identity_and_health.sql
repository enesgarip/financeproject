-- AUTO-01/08: Kanıtsız kişi eşleme yok; bakım alt hata sayısı izlenir.
create or replace function private.match_open_personal_debt(
  p_user_id uuid,
  p_direction text,
  p_counterparty text,
  p_amount numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_debt_direction text := case when p_direction = 'in' then 'borç_verdim' else 'borç_aldım' end;
  v_counterparty text := private.fold_match_text(p_counterparty);
  v_tolerance numeric;
  v_count integer;
  v_id uuid;
  v_value numeric;
begin
  if v_counterparty = '' or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: yeterli ad kaniti yok veya uyusmuyor');
  end if;

  -- Tutardan bağımsız isim adayları: kayıttaki adın her kelimesi (≥2 harf)
  -- gönderici adında TAM KELİME olarak geçmeli ("ali" ↔ "halil" eşleşmez).
  select count(*), (array_agg(d.id order by d.created_at))[1], (array_agg(d.estimated_value_try order by d.created_at))[1]
  into v_count, v_id, v_value
  from public.debts d
  where d.user_id = p_user_id
    and d.status = 'açık'
    and d.direction = v_debt_direction
    and d.value_type = 'TRY'
    and d.estimated_value_try > 0
    and private.fold_match_text(d.person_name) <> ''
    -- Kısaltma/baş harf kimlik kanıtı değildir; boş-küme eşleşmesini de engeller.
    and not exists (
      select 1 from unnest(string_to_array(private.fold_match_text(d.person_name), ' ')) as n(token)
      where length(n.token) < 2
    )
    and not exists (
      select 1
      from unnest(string_to_array(private.fold_match_text(d.person_name), ' ')) as t(token)
      where length(t.token) >= 2
        and position(' ' || t.token || ' ' in ' ' || v_counterparty || ' ') = 0
    );

  if v_count = 0 then
    return jsonb_build_object('debt_id', null, 'note', null);
  end if;
  if v_count > 1 then
    return jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: ' || v_count || ' acik kayit ayni ada uyuyor');
  end if;

  v_tolerance := greatest(5::numeric, round(p_amount * 0.01, 2));
  if p_amount > round(v_value, 2) + v_tolerance then
    return jsonb_build_object('debt_id', null, 'note', 'kisisel kayit eslenmedi: tutar kayit degerinden (' || round(v_value, 2)::text || ' TL) buyuk');
  end if;

  return jsonb_build_object('debt_id', v_id, 'note', null);
end;
$$;

revoke all on function private.match_open_personal_debt(uuid, text, text, numeric) from public, anon, authenticated;


create table private.automation_health (
  kind text primary key, ran_at timestamptz not null, ok boolean not null, errors integer not null, last_success_at timestamptz
);
revoke all on private.automation_health from public, anon, authenticated;

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
  v_errors integer := 0;
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
          v_errors := v_errors + 1;
          raise notice 'Provizyon dusurme basarisiz (harcama %): %', v_expense.id, sqlerrm;
      end;
    end loop;

    -- 2) Vadesi gelen planlı taksitler dönem içine.
    begin
      v_posted := public.post_due_card_installments();
      v_installments_posted := v_installments_posted + coalesce(v_posted, 0);
    exception
      when others then
          v_errors := v_errors + 1;
        raise notice 'Taksit post islemi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;

    -- 3) Ekstre kesimi en son: 1-2'nin doldurduğu dönem içi tutarlar kesime girer.
    begin
      v_cut := public.cut_due_card_statements();
      v_statements_cut := v_statements_cut + coalesce(v_cut, 0);
    exception
      when others then
          v_errors := v_errors + 1;
        raise notice 'Ekstre kesimi basarisiz (kullanici %): %', v_user.user_id, sqlerrm;
    end;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);

  insert into private.automation_health(kind, ran_at, ok, errors, last_success_at)
    values ('card-maintenance', now(), v_errors = 0, v_errors, case when v_errors = 0 then now() else null end)
    on conflict (kind) do update set ran_at = excluded.ran_at, ok = excluded.ok, errors = excluded.errors,
      last_success_at = coalesce(excluded.last_success_at, private.automation_health.last_success_at);

  return jsonb_build_object(
    'ok', v_errors = 0,
    'errors', v_errors,
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
