# Development and Deploy Pipeline

> Kanonik özet `CLAUDE.md`'de. Bu dosya CI/deploy detayını tutar.

## Goal

Gerçek akış: **`main` güncellemesi = üretim deploy.** `main` korumalıdır; değişiklik
PR üzerinden merge edilir ve production release bu merge push'uyla başlar.

1. `codex/...` veya `feature/...` dalında çalış
2. yerel kalite kontrolü: `npm run lint && npm run test:unit && npm run build`
3. migration/trigger değiştiyse yerel Postgres'te doğrula (`npm run db:seed:local`)
4. commit (Türkçe + faz/madde etiketli)
5. PR aç, CI yeşilken `main`'e merge et → `deploy.yml` otomatik çalışır

PR akışı (feature branch → PR → CI → merge) zorunludur; `ci.yml` PR'larda ve
`develop` push'larında koşar. Feature/codex dallarında push + PR çift CI
oluşmaması için branch push tetikleyicisi yoktur.

## Local Commands

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `npm run ci:local`
- `npm run db:seed:local` (reapply migrations + seed in local Supabase)
- `npm run db:test:all` — **kanonik SQL test komutu:** `supabase/tests/*.sql`'in
  tamamını sırayla koşar (`scripts/run-db-tests.mjs`, Windows uyumlu). CI de aynı
  kümeyi döngüyle koşar; `supabase/tests/` altına eklenen her `.sql` otomatik
  kapsanır — tek tek script/CI adımı bağlama kuralı kalktı (S4). Aşağıdaki
  `db:test:*` script'leri tek dosyayı izole koşmak için duruyor.
- `npm run db:test:catchup` (maintenance catch-up regression)
- `npm run db:test:provision` (provision/debt separation transitions)
- `npm run db:test:card-expense-idempotency` (source-event retry no-ops for card expenses)
- `npm run db:test:sms-account-idempotency` (SMS account movement retry no-ops)
- `npm run db:test:sms-card-reconciliation` (SMS card payment reconciliation matching)
- `npm run db:test:statement-import` (statement import installment scope/rebuild)
- `npm run db:test:card-allocation` (guarded child allocation security)
- `npm run db:test:card-bank-snapshot` (bank total-only reconciliation, exact
  paid-statement child allocation, ledger bucket preservation, and subsequent
  full current-period payment)
- `npm run db:test:legacy-current-payment` (exact pre-cycle historical allocation,
  no duplicate cash movement, full current-period payment, and ambiguous rollback)
- `npm run db:test:data-health-safe-repairs` (transaction, idempotency, audit RLS,
  and ledger-write boundary regression)
- `npm run db:test:data-health-acknowledgements` (auth-bound write RPCs, own-row
  visibility, direct-write denial, and cross-user clear isolation)
- `npm run db:test:reset` (full user finance data reset)
- `npm run db:test:expense-contexts-cars` (gider bağlamı/araç own-row RLS,
  kart annotation ownership ve manuel raporlama satırları)
- `npm run db:test:asset-trade` (proportional asset value on buy/sell)
- `npm run db:test:partial-debt` (partial personal debt payment and statement
  due-day collision)
- `npm run db:test:provision-context` (partial provision posting keeps `context_id`)
- `npm run db:test:composite-goal` (composite savings-goal totals derived from
  components)

## Optional Docker Parity

- `npm run docker:build`
- `npm run docker:preview`

Docker is intentionally optional for day-to-day coding. It is included for clean local preview/build verification, while Playwright runs directly on the host locally and inside GitHub Actions in CI.

## GitHub Actions

## CI workflow

File: `.github/workflows/ci.yml`

Runs on PRs, `develop` pushes, manual dispatch, and a nightly Lighthouse
schedule. `main` quality/release gates live in `deploy.yml`, so the same commit
does not run the quality suite twice.

Checks:

- lint
- production dependency audit (`npm audit --omit=dev`)
- build
- bundle size budget
- Lighthouse performance/accessibility/best-practices budget (frontend paths)
- Playwright smoke test (frontend paths)
- Supabase local migration reset + lint, ardından **`supabase/tests/*.sql`'in
  tamamı tek döngüyle** (database paths) — RLS/grant denetimleri ve tüm finansal
  SQL regresyonları dahil. Yeni eklenen her test dosyası CI'da otomatik koşar.

Lighthouse CI, GitHub status sonucunu yazabilsin diye job-scoped GitHub Actions
token'ını `LHCI_GITHUB_TOKEN` olarak alır. Bu, "GitHub token not set" uyarısını
ayrı bir personal access token oluşturmadan giderir; detaylı HTML raporu yine
`.lighthouseci` içinden `lighthouse-report` artifact'i olarak yüklenir. Klasör
gizli olduğu için upload adımı `include-hidden-files: true` kullanır ve rapor
yoksa hata verir; yeşil Lighthouse job'ı kanıtsız kalamaz.

Lighthouse budget, CI placeholder Supabase değerleriyle oturum açmadan çalışan
`/login` rotasını ölçer. PR/değişiklik geri bildirimi tek ölçüm kullanır; gece
01:30 UTC denetimi üç ölçüm kullanır. Job'ın 10 dakika sınırı yanında PR LHCI
komutu 180 saniyelik süreç sınırına sahiptir; tarayıcı kilitlenirse
`continue-on-error` bunu normal bir bilgilendirici job hatası olarak yutar ve job
timeout'u tüm workflow'u `cancelled` yapamaz. Gece denetiminin süreç sınırı 420
saniyedir. TERM sonrasında 15 saniye içinde kapanmayan süreç KILL ile temizlenir.
LHCI 0.15.1, runner'ın ilerleyen Chrome sürümünü eski 0.14.0 motoruna bağlamamak
için açıkça sabitlenmiştir. Route giriş animasyonu içerikten bağımsız yalnız
konum geçişi yapar; bütün sayfayı ilk karede `opacity:0` ile gizleme. Audit
sekmesi arka planda kaldığında animasyon ilerlemeyip çalışan login formu için
`NO_FCP` üretmişti. LHCI, build çıktısını kendi random portlu statik sunucusu yerine
`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` ile açar.
Lighthouse, ayrı Playwright tarayıcısı indirmek yerine GitHub runner'da hazır
Chrome'u headless kullanır; bu hem browser kurulumunu kaldırır hem de
LHCI/Playwright Chromium kilitlenmesini önler. Playwright smoke ise package-lock
sürümüne
anahtarlanmış Actions cache'ini ve cache miss'te `npx playwright install
chromium` desenini korur. Sabit `mcr.microsoft.com/playwright:vX-noble` imajını
geri getirme: Dependabot paket sürümünü yükselttiğinde imaj geride kalıp CI'ı
günlerce kırmızı bırakmıştı (2026-06-22..07-02).
GitHub runner'da Lighthouse `provided` throttling ve daha uzun FCP/load bekleme
limiti kullanır; bu job'ın amacı üretim metriklerini birebir simüle etmekten çok
CI'da bariz performans/accessibility/best-practices regresyonlarını yakalamaktır.

## Deploy workflow

File: `.github/workflows/deploy.yml`

Runs on push to `main` or manual dispatch.

Order/parallel graph:

1. **Classify** — frontend, database/migration, and edge-function paths
2. **Verify + artifact** — lint + coverage + production dependency audit; pull
   production env, build once with `vercel build --prod`, verify the bundle, and
   upload that exact output with `--prebuilt --skip-domain`
3. **Database check + backup** — one seeded local reset and DB audits when
   database paths changed; encrypted backup only for migration changes
4. **Supabase release** — dry-run/push only when migrations changed; deploy only
   changed edge functions (`_shared` means all)
5. **Promote + smoke** — after required Supabase work, use Vercel's team-scoped
   promotion API, smoke-test the canonical production `/login` route, and roll
   back to the previous deployment automatically when smoke fails

The path-aware database check in both `ci.yml` and `deploy.yml` runs the ENTIRE
`supabase/tests/*.sql` suite in a single loop step after a clean migration
reset (S4 fix, denetim 2026-08-12). Adding a new `.sql` file under
`supabase/tests/` is sufficient — it is picked up automatically by CI, the
deploy DB check, and `npm run db:test:all`; no per-file wiring is needed.

`vercel.json` disables Vercel Git auto-deploy for `main`. The deploy hook is no
longer used. The workflow uses one verified prebuilt artifact and does not
install Vercel CLI again for promotion. This prevents duplicate production
builds and keeps new frontend code off production until its database contract
is ready. Non-production branches keep Vercel Git preview deployments.

Ek otomasyon:
- `ci.yml`: PR/develop Lint+Build (required); path-aware Lighthouse, Playwright,
  and Supabase checks; nightly three-run Lighthouse audit.
- Dependabot routine version-update'larda yalnız patch/minor PR açar, ekosistem
  bazında gruplar ve required CI yeşilse otomatik squash-merge eder. Version major
  PR'ları üretilmez; security update'lar SemVer filtresinden muaftır ve major
  güvenlik yükseltmeleri manuel incelemeye kalır.
- Günlük şifreli DB yedeği cron'u (`db-backup.yml`).
- Günlük Web Push gönderici cron'u (`push-notify.yml`): 04:00 UTC / 07:00 TR, `push-notify` edge fonksiyonunu service-role ile invoke eder. Tarihli araç bakım/yenileme işleri için 7 gün kala aday üretir ve `cars_enabled` tercihini uygular.
  - Aynı edge function, ayar ekranındaki "test bildirimi gönder" için authenticated user JWT ile yalnızca o kullanıcının kendi endpoint'ine tek test payload'u yollar. Cron yolunda aday varsa ve tüm teslim denemeleri başarısız olursa workflow kırmızıya dönebilir.

## Required GitHub Secrets

## App / build

These are already needed by the frontend runtime:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Note: CI smoke tests use safe placeholder values because they only verify unauthenticated routing and login form rendering.

## CI reporting

- No extra Lighthouse secret is required. `.github/workflows/ci.yml` maps the
  built-in `github.token` to `LHCI_GITHUB_TOKEN` for the Lighthouse status
  check, with job-scoped `statuses: write` permission.

## Production migration

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`

`SUPABASE_ACCESS_TOKEN` is used by the CLI for authenticated project operations.

## Production deploy

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The workflow pins Vercel CLI `54.9.1`, creates one production-env build, uploads
it as an unaliased prebuilt deployment, and uses the official project promotion
and rollback APIs after the release gates pass.

## Push notification sender

- `SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions secret, only for `.github/workflows/push-notify.yml`)
- `VAPID_PRIVATE_KEY` (Supabase Edge Function secret)
- `VAPID_SUBJECT` (Supabase Edge Function secret, e.g. `mailto:you@example.com`)

## Required Vercel / Supabase Setup Outside Git

## Supabase

1. Ensure production project is reachable with the CLI.
2. Store `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` in GitHub secrets.
3. Keep all schema changes as migration files under `supabase/migrations/`.

## Vercel

1. Connect the repository to the Vercel project.
2. Keep the production branch as `main`; `vercel.json` disables only its
   automatic Git deployment while preserving branch previews.
3. Store `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as GitHub
   Actions secrets.

## Required Branch Flow

1. Create branch: `feature/...`
2. Implement change
3. Run `npm run ci:local`
4. Push branch
5. Open PR
6. Wait for required `Lint and Build` to pass
7. Merge to protected `main` (merge queue when enabled)
8. `Deploy Production` runs automatically

## Notes and Guardrails

- Keep production schema changes migration-driven only.
- For schema/RPC releases, use `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` before merge.
- Do not store secret values in `.env.example`, workflow files, or source.
- Do not remove `git.deploymentEnabled.main = false` while the staged CLI flow
  is active; that would recreate duplicate production builds and bypass release
  ordering.
- Do not replace the pinned Vercel CLI version with `latest`.
- Keep `scripts/promote-vercel-deployment.mjs` team-scoped and preserve its
  production smoke + rollback behavior.
- The Playwright suite is intentionally a smoke layer right now. Expand it gradually around stable user flows.
