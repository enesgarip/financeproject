# CLAUDE.md

Bu dosya, bu depoda çalışan AI ajanları (Claude Code, Codex vb.) için kalıcı
bağlamdır. Amaç: temiz bir oturumun projenin kurallarını ve tuzaklarını sıfırdan
keşfetmek zorunda kalmaması.

**Bu dosya kanonik kural setidir.** Eşlik eden dosyalar:
`AGENTS.md` (Codex giriş noktası — bu dosyaya yönlendirir + 5 kritik kuralı yineler),
`docs/AI_CONTEXT_INDEX.md` (görev bazlı en ucuz okuma rotası + konu→dosya tablosu;
keşif turu atmamak için **önce buna bak**),
`docs/PROJECT_CONTEXT.md` (domain + tablo + route haritası).

**Doküman güncel tutma kuralı:** Yeni `data/repositories/*` veya route sayfası
(`*Page.tsx`/`*Hub.tsx`) eklediysen `docs/AI_CONTEXT_INDEX.md`'in konu→dosya
tablosuna satır ekle. Dosya taşıdıysan/sildiysen docs'taki referansını güncelle.
Bunu CI'da `docs.guard.test.ts` zorlar (kırık pointer + eksik harita = kırmızı).

## Proje

Türkçe kişisel finans PWA'sı. Tek kullanıcı (sahibi = geliştirici). Stack:
**React 19 + Vite 7 + TypeScript + TailwindCSS v4**, veri katmanı **Supabase**
(Postgres + Auth + Edge Functions), **TanStack Query**, **Vercel** üzerinde
yayında. Hata izleme **Sentry** (yalnız frontend). Para birimi TL, dil Türkçe;
kullanıcıya yanıtlar Türkçe.

## Komutlar

```bash
npm run dev            # Vite (üretim Supabase'ine bağlanır — .env.local)
npm run dev:local      # Yerel Supabase başlat + Vite'ı ona bağla (üretime dokunmaz)
npm run dev:local:stop # Yerel Supabase docker'ı kapat
npm run lint           # ESLint (tüm repo)
npm run test:unit      # Vitest (saf util/servis testleri)
npm run test:e2e       # Playwright smoke (CI'da çalışır)
npm run build          # tsc -b && vite build
npm run db:seed:local  # Yerel DB'yi sıfırla + seed.sql yükle (test kullanıcısı)
npm run db:reset:local # Yerel DB'yi sıfırla (seed YOK)
npm run db:lint:local  # supabase db lint
npm run db:audit:rls:local # RLS denetimi (her public tablo RLS açık + own-row policy mi; CI'da da koşar)
```

`dev:local` sonrası giriş: **t@t.com / password123** (önce `db:seed:local` çalıştır).
Bir değişikliği "bitti" saymadan önce: `npm run lint && npm run test:unit && npm run build`.

## Mimari katmanlar (sınır ESLint ile zorlanır)

```
domain  →  src/utils/*        Saf hesap/iş kuralları. Supabase görmez. Yoğun test edilir.
data    →  src/data/repositories/*   TEK Supabase teması. Result<T> döndürür.
app     →  src/app/*          TanStack Query use-case hook'ları (useFinanceSnapshot vb.).
ui      →  src/pages, src/components   "Aptal" sunum. Supabase görmez.
services→  src/services/*      RPC sarmalayıcıları (kasıtlı; doğrudan supabase çağırır).
lib     →  src/lib/*           supabase client, sentry, harici istemciler.
```

**KURAL (ESLint `no-restricted-imports`, `eslint.config.js`):** `src/{pages,components,utils,hooks}`
içinden `lib/supabase` import etmek **HATA**. Veri erişimi yalnız `data/`, `services/`,
`lib/`, `auth/` katmanlarında. Yeni bir veri sorgusu gerekiyorsa repo'ya ekle, UI'dan çağırma.

`AnalysisPage`/`DashboardPage` aynı TanStack cache'ini (`useFinanceSnapshot`) paylaşır;
her sayfa süperseti kendi penceresine client-side daraltır.

## Para modeli — EN ÖNEMLİ KURAL

- Para **DB'de `numeric`** (kesin); float sorunu yalnız JS'te. Tüm para yuvarlama/
  karşılaştırması **`src/utils/money.ts`** üzerinden: `roundTL`, `equalsTL`,
  `greaterThanTL`, `toKurus`/`toTL`, `sumTL`. Çıplak `Math.round(x*100)/100` veya
  `+0.01` toleransı YAZMA — money.ts'i kullan.
- Ledger tabloları parayı **işaretli integer kuruş** (`amount_kurus bigint`) tutar.
- **Faz C (tek açık iş):** kalan float TL aritmetik noktalarını integer kuruşa
  çevirmek. Repo katmanı kurulu olduğu için dönüşüm tek katmanda yapılabilir.

## Ledger & trigger invariant'ları (event-sourcing deseni)

Dört büyük para rakamı ya olaylardan türetilir ya da yazma anında trigger ile korunur,
böylece tutarsızlık matematiksel olarak imkânsız:

- **Kart borcu** → `card_ledger` (append-only). `cards` üzerindeki AFTER trigger
  (`record_card_debt_event`) her `debt_amount` değişimini opening/debit/credit olayına
  çevirir. Borç = olayların toplamı (projeksiyon, `src/utils/cardLedger.ts`).
- **Banka bakiyesi** → `account_ledger` (aynı desen, `record_account_balance_event`).
- **Kart borç kırılımı** → BEFORE trigger `clamp_card_breakdown` (split ≤ debt garanti).
- **Kredi özeti** → `loan_installments` AFTER trigger `sync_loan_summary` (özet = ödenmemiş
  taksit projeksiyonu).

Her SQL trigger'ın bir **saf TS ikizi** vardır (örn. `clampCardBreakdown`,
`projectLoanSummary` financeSummary.ts'te) → DataHealth bunu DRY kullanır + test edilir.

Düzeltme = **ters kayıt** (append-only history bozulmaz). GUC ile yönlendirilir:
`app.ledger_suppress` (recompute'un çift saymasını önler), `app.ledger_kind`/`app.ledger_note`.
İlgili RPC'ler: `recompute_*_from_ledger`, `post_*_correction` (security INVOKER + ownership).

## Deploy hattı (otomatik)

`main`'e **push = üretim deploy** (`.github/workflows/deploy.yml`):
1. **Detect** — migration değişti mi? (değişmediyse backup atlanır, frontend yine deploy olur)
2. **Pre-migration backup** — şifreli DB yedeği (yalnız migration varsa)
3. **Migration** — `supabase db push` + edge functions deploy (bist-quote, parse-receipt)
4. **Vercel** — frontend deploy hook

CI (`ci.yml`): Lint+Build (required), Playwright smoke, Supabase Migration Check.
Dependabot patch/minor PR'larını CI yeşilse otomatik squash-merge eder (major elde kalır).
Günlük şifreli DB yedeği cron'u var (`db-backup.yml`).

## İş akışı (kullanıcı tercihi)

1. **Plan önce.** Kullanıcı koddan önce planı birlikte kararlaştırmayı sever.
2. Migration/trigger değişikliğini **lokal docker'da gerçek Postgres'te doğrula**
   (`npm run db:seed:local`, `docker exec ... psql`), saf util'leri Vitest ile test et.
3. OK ise **commit**. Push (= deploy) yalnız kullanıcı isteyince.
4. Commit mesajları Türkçe + faz/madde etiketli (örn. "Faz 5: ...").

## Gotcha'lar (tekrarlamamak için)

- **Migration timestamp'i benzersiz OLMALI** (`schema_migrations` PK = timestamp).
  Çakışma `db reset`'i 23505 ile patlatır. Yeni dosyada `git log`'a da bak — bir
  spawn/chip oturumu aynı işi yapmış olabilir.
- **tr-TR locale lowercase tuzağı:** keyword eşleştirmede `toLocaleLowerCase('tr-TR')`
  büyük I'yı noktasız ı'ya katlar → MIGROS/BIM gibi BÜYÜK satıcılar eşleşmez. Önce
  `[Iİ]→i` map'le (bkz. `normalizeDescription`).
- **Supabase CLI `-p`/`--password` flag'i pooler SASL auth'unu bozar** → bunun yerine
  `SUPABASE_DB_PASSWORD` env var kullan.
- **Elle eklenen `auth.users`:** confirmation_token/recovery_token/email_change* NULL
  kalırsa login "Database error querying schema" verir → boş string'e çek (bkz. seed.sql).
- **`@sentry/deno` edge'e KONMADI** (bundle'ı 3kB→1MB şişiriyor); edge için Supabase
  fonksiyon logları yeterli. Sentry yalnız frontend.
- **timestamptz'i `formatDate`'e verme** (date-only bekler) → `.slice(0,10)`.
- Edge fonksiyonları `supabase/functions/_shared/edge.ts` ortak modülünü kullanır
  (CORS, timeout'lu fetch).
