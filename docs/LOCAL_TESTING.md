# Yerel Fonksiyonel Test Rehberi

Amaç: bir AI/geliştirici oturumunun, **prod'a dokunmadan** ve **UI login duvarına
takılmadan** gerçek RPC'leri yerel Supabase'de test edebilmesi.

## Ortam

- Yerel Supabase docker: `supabase_db_financeproject` (db `:55322`, kong/API `:55321`).
- Başlat: `npm run dev:local` (Vite'ı yerel Supabase'e bağlar). Seed: `npm run db:seed:local`.
- Test kullanıcısı: **t@t.com** (uid `11111111-1111-1111-1111-111111111111`).
  Şifre `CLAUDE.md`'de belgeli — ama aşağıdaki yöntem şifre GEREKTİRMEZ.

> **Güvenlik:** Testlerde yalnız `docker exec supabase_db_financeproject ...` (yerel
> container) kullan. `.env.local` / `npm run dev` üretim Supabase'ine bağlanabilir —
> yazma testlerinde KULLANMA. Üretime (`uleyyedkqvwsevcrhuyl`) yazma yok.

## Veri katmanı testi — kullanıcı impersonation (login gerektirmez)

RPC'ler `auth.uid()` (yani `request.jwt.claims->>'sub'`) ile sahiplik/RLS uygular.
pg_cron bakımı ve `supabase/tests/maintenance_catchup.sql` ile aynı mekanizma: bir
transaction içinde rolü + JWT claim'i ayarla, gerçek RPC'yi çağır, tabloları/ledger'ı
doğrula, `rollback` ile temiz bırak.

```bash
docker exec -i supabase_db_financeproject psql -U postgres -d postgres <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- ör: kredi kartı + taksitli harcama
insert into public.cards (user_id,bank_name,card_name,card_type,credit_limit,statement_day,due_day)
values ('11111111-1111-1111-1111-111111111111','X','TEST','kredi_karti',50000,25,10) returning id as cc \gset
select public.add_card_expense(:'cc', 1000, 'test', '2026-08-01', 3, 'Market', 'posted');
select debt_amount, current_period_spending, provision_amount from public.cards where id=:'cc';
select * from public.card_installments where card_id=:'cc' order by installment_no;
select * from public.card_ledger where card_id=:'cc';
rollback;  -- kalıcı istersen commit
SQL
```

Kurallar:
- Beklenen değeri **iş-kuralı belgesinden** (`docs/FINANCE_RULES.md`,
  `docs/CARD_DEBT_TRANSITIONS.md`) türet — uygulama util'ini test oracle'ı yapma.
- Ana akışı **doğrudan INSERT** ile test etme; **gerçek RPC'yi** çağır (yukarıdaki gibi).
  Doğrudan INSERT yalnız özel tarih/sınır fixture kurulumu için, açıkça belirterek.
- Test kayıtlarına `LOCAL-E2E-<tarih>-<senaryo>` prefix'i ver; `rollback` ile izole tut.
- RPC imzalarını varsayma; `select pg_get_function_arguments(...)` ile DB'den al.

### UI katmanı kısıtı

Bir AI ajanı **bir form alanına şifre giremez** (güvenlik kuralı) → yerel UI'a login
olamaz; token enjeksiyonu da güvenlik sınıflandırıcısınca engellenir. Bu yüzden UI
**yazma** akışları (form gönderimi, TanStack invalidation, render) ajan tarafından
test edilemez. Gerekirse **kullanıcı bir kez giriş yapar**, ajan authenticated
oturumu metin araçlarıyla (read_page/js) sürer. Veri-katmanı doğruluğu için yukarıdaki
impersonation yöntemi yeterlidir.

## Migration/RPC değişikliği doğrulama

```bash
docker exec -i supabase_db_financeproject psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/<yeni>.sql  # idempotent apply
npm run db:reset:local        # temiz sıralı uygulama
npm run db:lint:local ; npm run db:audit:rls:local ; npm run db:audit:grants:local
npm run db:test:catchup ; npm run db:test:provision   # invariant regresyonları
```

Regresyon testleri `supabase/tests/*.sql` (raise-on-failure); yenisini eklerken
`package.json`'a `db:test:*` script'i + CI'ya bağla.
