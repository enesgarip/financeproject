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
  extensions.crypt('password123', extensions.gen_salt('bf')),
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
