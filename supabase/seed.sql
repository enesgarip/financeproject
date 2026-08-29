-- Yerel geliştirme tohumu (idempotent). `supabase db reset` (--no-seed olmadan)
-- veya `npm run db:seed:local` ile yüklenir. ÜRETİME GİTMEZ — yalnız yerel docker.
--
-- Giriş: t@t.com / password123
--
-- GOTCHA (deneyimle sabit): elle eklenen auth.users satırında confirmation_token,
-- recovery_token, email_change* alanları NULL kalırsa GoTrue login'de
-- "Database error querying schema" verir → hepsini boş string'e çek.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 't@t.com',
  -- GOTCHA: gen_salt('bf') varsayılanı cost 6 üretir ve güncel GoTrue bunu
  -- reddeder ("Invalid login credentials" — DB'de hash doğru görünse bile).
  -- Cost'u açıkça 10 ver; yerel giriş aksi halde sessizce çalışmaz.
  extensions.crypt('password123', extensions.gen_salt('bf', 10)),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', ''
)
on conflict (id) do nothing;

-- E-posta/parola girişinin çalışması için identity satırı şart.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"t@t.com","email_verified":true,"phone_verified":false}',
  'email', now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Demo finans verisi (2026-08-24) — yerel doğrulama boş ekranla uğraşmasın.
--
-- İlkeler:
-- * TARİHLER GÖRECELİ (current_date bazlı) → seed hiç bayatlamaz; vadeler hep
--   "önümüzdeki günlerde", kredi taksitinin bu ayki dilimi hep "ödendi".
-- * İDEMPOTENT: sabit UUID + on conflict do nothing; bakiye hareketleri yalnız
--   ledger boşken üretilir (ikinci koşu çift olay yazmaz).
-- * KART KOVALARI HARCAMALARLA TUTARLI: debt = statement + current + provision
--   ve current/provision kovaları aşağıdaki harcama satırlarının toplamına eşit
--   (DataHealth tutarlılık kontrolleri yeşil kalsın diye).
-- * KESİM/VADE GÜNLERİ DE GÖRECELİ: kesim hep 9 gün önce "yapılmış", vade hep
--   6 gün sonra → hangi gün reset atılırsa atılsın ne "kesilmemiş dönem" ne
--   "vadesi geçti" gürültüsü doğar; açık ekstre arşivi karttaki ekstre kovasına
--   birebir eşit (DataHealth "açık arşiv yok ama ekstre borcu var" demez).
-- * Kart TAKSİT planı bilerek yok: o satırlar kanonik RPC'lerle üretilmeli;
--   taksitli senaryo gerekiyorsa UI'dan "taksitli harcama ekle" ile kur.
-- * Kategoriler src/utils/categories.ts kanonik listesinden BİREBİR.
-- ---------------------------------------------------------------------------

-- Hesaplar + kartlar. AFTER trigger'lar (record_card_debt_event /
-- record_account_balance_event) opening ledger olaylarını kendisi yazar.
insert into public.cards (id, user_id, bank_name, card_name, card_type, current_balance, iban) values
  ('de110000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'DenizBank', 'Vadesiz TL', 'banka_karti', 42500.00, 'TR330006200000000012345678'),
  ('de110000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'Enpara', 'Birikim', 'banka_karti', 118000.00, null)
on conflict (id) do nothing;

-- World bilinçli BOŞ kart (borç/kırılım 0): yeni açılmış kart görünümlerini ve
-- sıfır-durum UI'larını da doğrulanabilir tutar; geçmişi paid arşivde durur.
insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount,
  statement_debt_amount, current_period_spending, provision_amount, statement_day, due_day, limit_group_name, holder_name) values
  ('de110000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'DenizBank', 'Bonus Gold',   'kredi_karti', 120000, 21500.00, 12000.00, 8000.00, 1500.00, extract(day from current_date - 9)::int, extract(day from current_date + 6)::int, 'Aile', 'Enes'),
  ('de110000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', 'DenizBank', 'Bonus Platin', 'kredi_karti', 120000,  9800.00,  5400.00, 4400.00,    0.00, extract(day from current_date - 9)::int, extract(day from current_date + 6)::int, 'Aile', 'Deniz'),
  ('de110000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'Yapı Kredi', 'World',       'kredi_karti',  80000,     0.00,     0.00,    0.00,    0.00, extract(day from current_date - 9)::int, extract(day from current_date + 6)::int, null, null)
on conflict (id) do nothing;

-- Ekstre arşivleri: Gold/Platin'in AÇIK ekstresi karttaki ekstre kovasına eşit
-- (kesim 9 gün önce, vade 6 gün sonra); World'ün geçen dönemi ödenmiş geçmiş.
insert into public.card_statement_archives (id, user_id, card_id, statement_date, due_date,
  statement_debt_amount, current_period_spending, total_debt_amount, period_year, period_month, status, paid_at) values
  ('de110000-0000-4000-8000-000000000b01', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003',
   current_date - 9, current_date + 6, 12000.00, 0, 12000.00,
   extract(year from current_date - 9)::int, extract(month from current_date - 9)::int, 'open', null),
  ('de110000-0000-4000-8000-000000000b02', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004',
   current_date - 9, current_date + 6, 5400.00, 0, 5400.00,
   extract(year from current_date - 9)::int, extract(month from current_date - 9)::int, 'open', null),
  ('de110000-0000-4000-8000-000000000b03', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000005',
   current_date - 39, current_date - 24, 7200.00, 0, 7200.00,
   extract(year from current_date - 39)::int, extract(month from current_date - 39)::int, 'paid', current_date - 26)
on conflict (id) do nothing;

insert into public.card_aliases (user_id, card_id, last_four_digits, label)
select '11111111-1111-1111-1111-111111111111', c.id, v.last4, null
from (values
  ('de110000-0000-4000-8000-000000000003'::uuid, '4821'),
  ('de110000-0000-4000-8000-000000000004'::uuid, '7733'),
  ('de110000-0000-4000-8000-000000000005'::uuid, '1904')
) as v(card_id, last4)
join public.cards c on c.id = v.card_id
where not exists (select 1 from public.card_aliases a where a.card_id = v.card_id);

-- Hesap hareketi geçmişi: bakiye update'leri account_ledger olaylarına dönüşür.
-- Guard 'opening' HARİCİ olaya bakar: kart INSERT'i opening olayını zaten yazar,
-- çıplak "olay var mı" kontrolü update'leri hiç koşturmazdı (idempotency —
-- tekrar koşan seed yine de çift hareket yazmaz).
do $$
begin
  if not exists (select 1 from public.account_ledger where card_id = 'de110000-0000-4000-8000-000000000001' and kind <> 'opening') then
    update public.cards set current_balance = 41250.00 where id = 'de110000-0000-4000-8000-000000000001';
    update public.cards set current_balance = 39990.00 where id = 'de110000-0000-4000-8000-000000000001';
    update public.cards set current_balance = 44490.00 where id = 'de110000-0000-4000-8000-000000000001';
    update public.cards set current_balance = 43990.00 where id = 'de110000-0000-4000-8000-000000000001';
  end if;
  if not exists (select 1 from public.account_ledger where card_id = 'de110000-0000-4000-8000-000000000002' and kind <> 'opening') then
    update public.cards set current_balance = 117000.00 where id = 'de110000-0000-4000-8000-000000000002';
    update public.cards set current_balance = 121000.00 where id = 'de110000-0000-4000-8000-000000000002';
  end if;
end $$;

-- Kart harcamaları (tek çekim). Toplamlar kart kovalarıyla birebir:
-- Bonus Gold posted = 8.000 (current_period_spending), provision = 1.500;
-- Bonus Platin posted = 4.400. spent_at son 6 günde → her kesim gününe göre
-- açık dönemin içinde kalır.
insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, posted_at, source) values
  ('de110000-0000-4000-8000-000000000101', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 6, 2650.00, 'MIGROS ATASEHIR', 'Market', 'posted', current_date - 6, 'manual'),
  ('de110000-0000-4000-8000-000000000102', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 5, 2000.00, 'PETROL OFISI KADIKOY', 'Ulaşım', 'posted', current_date - 5, 'manual'),
  ('de110000-0000-4000-8000-000000000103', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 4, 1800.00, 'TRENDYOL', 'Alışveriş', 'posted', current_date - 4, 'manual'),
  ('de110000-0000-4000-8000-000000000104', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 3,  600.00, 'ATASEHIR ECZANESI', 'Sağlık', 'posted', current_date - 3, 'manual'),
  ('de110000-0000-4000-8000-000000000105', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 2,  200.00, 'SPOTIFY', 'Abonelik', 'posted', current_date - 2, 'manual'),
  ('de110000-0000-4000-8000-000000000106', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date - 1,  750.00, 'SBX KADIKOY', 'Yeme & İçme', 'posted', current_date - 1, 'manual'),
  ('de110000-0000-4000-8000-000000000107', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004', current_date - 5, 1400.00, 'A101 UMRANIYE', 'Market', 'posted', current_date - 5, 'manual'),
  ('de110000-0000-4000-8000-000000000108', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004', current_date - 4,  450.00, 'BITAKSI', 'Ulaşım', 'posted', current_date - 4, 'manual'),
  ('de110000-0000-4000-8000-000000000109', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004', current_date - 3, 1250.00, 'YEMEKSEPETI', 'Yeme & İçme', 'posted', current_date - 3, 'manual'),
  ('de110000-0000-4000-8000-000000000110', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004', current_date - 2,  300.00, 'CINEMAXIMUM', 'Eğlence', 'posted', current_date - 2, 'manual'),
  ('de110000-0000-4000-8000-000000000111', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000004', current_date - 1, 1000.00, 'KUAFOR STIL', 'Kişisel Bakım', 'posted', current_date - 1, 'manual')
on conflict (id) do nothing;

insert into public.card_expenses (id, user_id, card_id, spent_at, amount, description, category, status, source) values
  ('de110000-0000-4000-8000-000000000112', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', current_date, 1500.00, 'MEDIA MARKT', 'Alışveriş', 'provision', 'manual')
on conflict (id) do nothing;

-- Kredi: 24 taksit, bu ayın dilimi dahil 13'ü ödendi (bu ay hep "ödendi" kalır,
-- geçmiş-vade uyarısı üretmez). Özet kolonlarını sync_loan_summary trigger'ı
-- taksitlerden kendisi kurar; loans satırındaki değerler başlangıç kabuğudur.
insert into public.loans (id, user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment,
  installment_day, start_date, end_date, remaining_installments, status) values
  ('de110000-0000-4000-8000-000000000201', '11111111-1111-1111-1111-111111111111', 'Garanti BBVA', 'Taşıt kredisi', 222000, 101750, 9250, 5,
   (date_trunc('month', current_date) - interval '12 months')::date,
   (date_trunc('month', current_date) + interval '11 months' + interval '4 days')::date,
   11, 'active')
on conflict (id) do nothing;

insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status, paid_at)
select
  '11111111-1111-1111-1111-111111111111',
  'de110000-0000-4000-8000-000000000201',
  gs,
  (date_trunc('month', current_date) + make_interval(months => gs - 13) + interval '4 days')::date,
  9250.00,
  case when gs <= 13 then 'ödendi' else 'bekliyor' end,
  case when gs <= 13 then (date_trunc('month', current_date) + make_interval(months => gs - 13) + interval '4 days')::date end
from generate_series(1, 24) as gs
on conflict (loan_id, installment_no) do nothing;

-- Planlı ödemeler: vadeler hep ileride (göreceli). Netflix talimatlı (bank_auto
-- bilgilendirme davranışı), sigorta tutarı "yaklaşık" (güven dili rozeti).
insert into public.payments (id, user_id, title, amount, due_date, status, category, recurrence, recurrence_day, payment_method, amount_status, auto_source_card_id) values
  ('de110000-0000-4000-8000-000000000301', '11111111-1111-1111-1111-111111111111', 'Kira', 22000.00,
   (date_trunc('month', current_date) + interval '1 month')::date, 'bekliyor', 'Kira / aidat', 'monthly', 1, 'manual', 'exact', null),
  ('de110000-0000-4000-8000-000000000302', '11111111-1111-1111-1111-111111111111', 'İnternet', 700.00,
   (date_trunc('month', current_date) + interval '1 month' + interval '7 days')::date, 'bekliyor', 'Fatura', 'monthly', 8, 'manual', 'exact', null),
  ('de110000-0000-4000-8000-000000000303', '11111111-1111-1111-1111-111111111111', 'Netflix', 230.00,
   (date_trunc('month', current_date) + interval '1 month' + interval '11 days')::date, 'bekliyor', 'Dijital üyelik', 'monthly', 12, 'bank_auto', 'exact', 'de110000-0000-4000-8000-000000000003'),
  ('de110000-0000-4000-8000-000000000304', '11111111-1111-1111-1111-111111111111', 'Araç kasko yenileme', 4800.00,
   current_date + 20, 'bekliyor', 'Sigorta', 'none', null, 'manual', 'estimated', null)
on conflict (id) do nothing;

-- Kişisel alacak (15 gün sonra vadeli).
insert into public.debts (id, user_id, person_name, direction, value_type, amount, estimated_value_try, due_date, status) values
  ('de110000-0000-4000-8000-000000000401', '11111111-1111-1111-1111-111111111111', 'Ali', 'borç_verdim', 'TRY', 5000.00, 5000.00, current_date + 15, 'açık')
on conflict (id) do nothing;

-- Maaş: 6 ay önce 85k, bu ayın 1'i itibarıyla 105k → zam trendi görünür.
insert into public.salary_history (id, user_id, title, amount, effective_date) values
  ('de110000-0000-4000-8000-000000000501', '11111111-1111-1111-1111-111111111111', 'Maaş', 85000.00, (date_trunc('month', current_date) - interval '6 months')::date),
  ('de110000-0000-4000-8000-000000000502', '11111111-1111-1111-1111-111111111111', 'Maaş (zam)', 105000.00, date_trunc('month', current_date)::date)
on conflict (id) do nothing;

-- Varlıklar: USD + gram altın + hisse canlı değerlenir (auto_valued; kur/fiyat
-- client'ta gelmezse valued_at'li saklı değere düşülür), BES elle.
insert into public.assets (id, user_id, name, category, amount, unit, currency, estimated_value_try, auto_valued, symbol, valued_at, valuation_rate) values
  ('de110000-0000-4000-8000-000000000601', '11111111-1111-1111-1111-111111111111', 'Nakit dolar', 'Nakit', 1200, 'adet', 'USD', 49200.00, true, null, now(), 41.00),
  ('de110000-0000-4000-8000-000000000602', '11111111-1111-1111-1111-111111111111', 'Gram altın', 'Altın', 60, 'gram', 'TRY', 302400.00, true, null, now(), 5040.00),
  ('de110000-0000-4000-8000-000000000603', '11111111-1111-1111-1111-111111111111', 'THYAO', 'Hisse', 100, 'adet', 'TRY', 32500.00, true, 'THYAO', now(), 325.00),
  ('de110000-0000-4000-8000-000000000604', '11111111-1111-1111-1111-111111111111', 'BES birikimi', 'BES', 1, 'adet', 'TRY', 150000.00, false, null, null, null)
on conflict (id) do nothing;

-- Birikim hedefi + kasa kovaları. Kova hedefe BAĞLI ama takip kaynağı değil —
-- UI'daki "bu kovayı kaynak yap" akışı elle denenebilir kalsın.
insert into public.savings_goals (id, user_id, name, target_amount, current_amount, target_date, status) values
  ('de110000-0000-4000-8000-000000000701', '11111111-1111-1111-1111-111111111111', 'Acil fon', 300000.00, 145000.00, (current_date + interval '10 months')::date, 'active')
on conflict (id) do nothing;

insert into public.kasa_buckets (id, user_id, name, reserved_amount, sort_order, goal_id) values
  ('de110000-0000-4000-8000-000000000801', '11111111-1111-1111-1111-111111111111', 'Acil fon kasası', 45000.00, 0, 'de110000-0000-4000-8000-000000000701'),
  ('de110000-0000-4000-8000-000000000802', '11111111-1111-1111-1111-111111111111', 'Tatil', 15000.00, 1, null)
on conflict (id) do nothing;

-- Mutabakat geçmişi: üç rozet durumu da örneklensin — Vadesiz TL taze "Mutabık"
-- (2 gün önce), Bonus Gold 10 günlük "Tazele" sarısı, kalanlar doğal
-- "hiç mutabık olunmadı". drift = app − real check'i (Faz D1) 0'la sağlanır.
insert into public.account_reconciliations (id, user_id, card_id, target, app_amount, real_amount, drift, resolution, reconciled_at) values
  ('de110000-0000-4000-8000-000000000c01', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000001', 'balance', 43990.00, 43990.00, 0, 'matched', now() - interval '2 days'),
  ('de110000-0000-4000-8000-000000000c02', '11111111-1111-1111-1111-111111111111', 'de110000-0000-4000-8000-000000000003', 'debt', 21500.00, 21500.00, 0, 'matched', now() - interval '10 days')
on conflict (id) do nothing;

-- Bu ayın bütçeleri (Market 4.050/6.000 dolulukta görünür).
insert into public.budgets (id, user_id, month, category, limit_amount) values
  ('de110000-0000-4000-8000-000000000901', '11111111-1111-1111-1111-111111111111', date_trunc('month', current_date)::date, 'Market', 6000.00),
  ('de110000-0000-4000-8000-000000000902', '11111111-1111-1111-1111-111111111111', date_trunc('month', current_date)::date, 'Yeme & İçme', 4000.00),
  ('de110000-0000-4000-8000-000000000903', '11111111-1111-1111-1111-111111111111', date_trunc('month', current_date)::date, 'Ulaşım', 3000.00)
on conflict (id) do nothing;

-- İstek listesi ("ne zaman alabilirim" satırı fiyatlı maddede canlanır).
insert into public.wishlist_items (id, user_id, name, estimated_price, sort_order) values
  ('de110000-0000-4000-8000-000000000a01', '11111111-1111-1111-1111-111111111111', 'PlayStation 5', 28000.00, 0),
  ('de110000-0000-4000-8000-000000000a02', '11111111-1111-1111-1111-111111111111', 'Robot süpürge', 18000.00, 1)
on conflict (id) do nothing;

-- AI asistan demo sohbeti (/analiz/asistan): sayfa yerelde ve ekran
-- görüntüsünde Gemini anahtarı olmadan da dolu/deterministik görünsün.
insert into public.ai_chat_messages (id, user_id, created_at, role, content) values
  ('de110000-0000-4000-8000-000000000d01', '11111111-1111-1111-1111-111111111111', now() - interval '2 hours', 'user',
   'Bu ayı değerlendir'),
  ('de110000-0000-4000-8000-000000000d02', '11111111-1111-1111-1111-111111111111', now() - interval '2 hours' + interval '12 seconds', 'assistant',
   'Bu ay gelirin 105.000 TL ve toplam çıkışın yaklaşık 68.000 TL görünüyor; net akış artıda. Kart tarafında Bonus Gold ekstresi 21.500 TL ve ayın 25''inde ödenmesi gerekiyor, kredi taksitinle birlikte ay sonuna kadar en büyük iki kalemin bunlar.' || E'\n\n' || 'Market bütçen 6.000 TL''nin 4.050 TL''sini kullandın; bu tempoyla ay sonunu sınırda kapatırsın. Acil fon hedefine bu ay henüz ayırma yapılmamış, ekstre ödemesinden sonra 5.000 TL ayırman planına uygun olur.'),
  ('de110000-0000-4000-8000-000000000d03', '11111111-1111-1111-1111-111111111111', now() - interval '1 hour', 'user',
   'Borçlarımı kapatmak için nasıl bir sıra izlemeliyim?'),
  ('de110000-0000-4000-8000-000000000d04', '11111111-1111-1111-1111-111111111111', now() - interval '1 hour' + interval '14 seconds', 'assistant',
   'Önce kredi kartı ekstresini tam kapat: gecikme faizi en pahalı borç bu. Ardından takvimdeki sabit taksitler geliyor; kredin zaten otomatik planda, erken kapama cezası yoksa fazla nakdi buraya değil kart borcuna yönlendir.' || E'\n\n' || 'Ali''den alacağın 5.000 TL vadesinde gelirse onu doğrudan acil fon kasasına aktarabilirsin. Kararın sana ait; bu sıralama yalnızca maliyet mantığına göre.')
on conflict (id) do nothing;
