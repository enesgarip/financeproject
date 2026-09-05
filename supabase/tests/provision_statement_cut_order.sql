-- Bakım sırası invariant'ı: stale provizyon EKSTRE KESİMİNE YETİŞİR.
--
-- Migration 20260905100000'ün kilitlediği davranış: `run_scheduled_card_maintenance`
-- stale (>= p_provision_stale_days) provizyonları ekstre kesiminden ÖNCE post eder.
-- Eski sıra (kesim → provizyon post) stale provizyonu bir sonraki ekstreye
-- kaydırıyordu; banka gerçeğinde işlem kesilen ekstrenin içindeydi (2026-09-05 vakası).
--
-- Senaryo: kesim günü DÜN olan kartta biri stale (8 günlük), biri taze (bugün)
-- iki provizyon. Bakım koşunca:
--   - stale provizyon post edilip AYNI koşuda kesilen ekstreye girmeli,
--   - taze provizyon provizyon kovasında kalmalı (banka onayı belirsiz),
--   - ikinci koşu hiçbir şeyi değiştirmemeli (idempotans).
--
-- Çalıştırma: npm run db:test:provision-cut-order (yerel docker + seed gerekir)
-- Her şey transaction içinde kurulur ve sonunda ROLLBACK edilir.

begin;

-- Kurulum seed kullanıcısıyla, gerçek RLS altında yapılır.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_statement_day integer;
begin
  -- Kesim günü DÜN: cut_due_card_statements yalnız kesim günü tamamen geçtiyse
  -- keser (today > boundary), yani bugün kesilebilir olmalı.
  v_statement_day := extract(day from (private.today_ist() - interval '1 day'))::integer;

  insert into public.cards (
    user_id, bank_name, card_name, card_type, credit_limit,
    debt_amount, statement_debt_amount, current_period_spending, provision_amount,
    statement_day, due_day, current_balance
  )
  values (
    v_user, 'Test Bank', 'Provizyon Sira Testi', 'kredi_karti', 50000,
    0, 0, 0, 0,
    v_statement_day, least(v_statement_day + 5, 28), 0
  )
  returning id into v_card;

  -- Stale provizyon: 8 gün önce, varsayılan eşik (7) dolmuş → bakım post etmeli.
  perform public.add_card_expense(
    v_card, 1500, 'Stale provizyon', (private.today_ist() - 8)::date,
    1, 'Diğer', 'provision', v_user, 'manual'
  );

  -- Taze provizyon: bugün → bakım DOKUNMAMALI (banka onayı belirsiz).
  perform public.add_card_expense(
    v_card, 500, 'Taze provizyon', private.today_ist(),
    1, 'Diğer', 'provision', v_user, 'manual'
  );
end $$;

-- Bakım cron bağlamında koşar (SECURITY DEFINER; kullanıcıyı kendisi set eder).
reset role;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_card uuid;
  v_debt numeric;
  v_statement numeric;
  v_current numeric;
  v_provision numeric;
  v_archive_count integer;
  v_archive_amount numeric;
  v_stale_status text;
  v_stale_archive uuid;
  v_fresh_status text;
  v_debt_after2 numeric;
  v_statement_after2 numeric;
  v_provision_after2 numeric;
  v_archive_count2 integer;
  v_failures text[] := '{}';
begin
  select id into v_card
  from public.cards
  where user_id = v_user and card_name = 'Provizyon Sira Testi';

  -- ── 1. koşu ───────────────────────────────────────────────────────────────
  perform public.run_scheduled_card_maintenance(7);

  select debt_amount, statement_debt_amount, current_period_spending, provision_amount
  into v_debt, v_statement, v_current, v_provision
  from public.cards where id = v_card;

  select count(*), max(statement_debt_amount)
  into v_archive_count, v_archive_amount
  from public.card_statement_archives where card_id = v_card;

  select status, statement_archive_id
  into v_stale_status, v_stale_archive
  from public.card_expenses
  where card_id = v_card and description = 'Stale provizyon';

  select status into v_fresh_status
  from public.card_expenses
  where card_id = v_card and description = 'Taze provizyon';

  if v_stale_status <> 'posted' then
    v_failures := v_failures || format('  - stale provizyon post edilmeliydi, status=%s', v_stale_status);
  end if;

  if v_stale_archive is null then
    v_failures := v_failures || '  - stale provizyon kesilen ekstreye BAGLANMADI (eski sira davranisi geri geldi?)';
  end if;

  if v_fresh_status <> 'provision' then
    v_failures := v_failures || format('  - taze provizyon dokunulmamis kalmaliydi, status=%s', v_fresh_status);
  end if;

  if v_archive_count <> 1 then
    v_failures := v_failures || format('  - 1 ekstre arsivi bekleniyordu, %s var', v_archive_count);
  end if;

  if v_archive_amount is distinct from 1500 then
    v_failures := v_failures || format('  - ekstre tutari 1500 olmaliydi (stale provizyon icinde), %s', v_archive_amount);
  end if;

  if v_statement <> 1500 then
    v_failures := v_failures || format('  - ekstre kovasi 1500 olmaliydi, %s', v_statement);
  end if;

  if v_provision <> 500 then
    v_failures := v_failures || format('  - provizyon kovasinda yalniz taze (500) kalmaliydi, %s', v_provision);
  end if;

  if v_current <> 0 then
    v_failures := v_failures || format('  - donem ici 0 olmaliydi (stale kesime girdi), %s', v_current);
  end if;

  if v_debt <> 2000 then
    v_failures := v_failures || format('  - toplam borc 2000 kalmaliydi, %s', v_debt);
  end if;

  -- ── 2. koşu (idempotans) ──────────────────────────────────────────────────
  perform public.run_scheduled_card_maintenance(7);

  select debt_amount, statement_debt_amount, provision_amount
  into v_debt_after2, v_statement_after2, v_provision_after2
  from public.cards where id = v_card;

  select count(*) into v_archive_count2
  from public.card_statement_archives where card_id = v_card;

  if v_archive_count2 <> v_archive_count
    or v_debt_after2 <> v_debt
    or v_statement_after2 <> v_statement
    or v_provision_after2 <> v_provision
  then
    v_failures := v_failures || format(
      '  - IDEMPOTENT DEGIL: ikinci kosu degisiklik yapti (arsiv %s->%s, borc %s->%s, ekstre %s->%s, provizyon %s->%s)',
      v_archive_count, v_archive_count2, v_debt, v_debt_after2,
      v_statement, v_statement_after2, v_provision, v_provision_after2
    );
  end if;

  if array_length(v_failures, 1) > 0 then
    raise exception E'Provizyon-kesim sirasi invariant ihlali:\n%', array_to_string(v_failures, E'\n');
  end if;

  raise notice 'GECTI provision_statement_cut_order: stale ekstrede (%), taze provizyonda (%), idempotent.',
    v_statement, v_provision;
end $$;

rollback;
