# Development and Deploy Pipeline

> Kanonik özet `CLAUDE.md`'de. Bu dosya CI/deploy detayını tutar.

## Goal

Gerçek akış: **`main`'e push = üretim deploy.** Push yalnız kullanıcı isteyince yapılır.

1. çalış (genelde `main`, gerekirse feature branch)
2. yerel kalite kontrolü: `npm run lint && npm run test:unit && npm run build`
3. migration/trigger değiştiyse yerel Postgres'te doğrula (`npm run db:seed:local`)
4. commit (Türkçe + faz/madde etiketli)
5. `main`'e push → `deploy.yml` otomatik çalışır (aşağı bak)

PR akışı (feature branch → PR → CI → merge) opsiyoneldir; `ci.yml` PR'larda ve
`develop` push'larında koşar. Feature/codex dallarında push + PR çift CI
oluşmaması için branch push tetikleyicisi yoktur.

## Local Commands

- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `npm run ci:local`

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
- build
- bundle size budget
- Lighthouse performance/accessibility/best-practices budget (frontend paths)
- Playwright smoke test (frontend paths)
- Supabase local migration reset + lint/RLS/grant/catch-up (database paths)

Lighthouse CI, GitHub status sonucunu yazabilsin diye job-scoped GitHub Actions
token'ını `LHCI_GITHUB_TOKEN` olarak alır. Bu, "GitHub token not set" uyarısını
ayrı bir personal access token oluşturmadan giderir; detaylı HTML raporu yine
`.lighthouseci` artifact'i olarak yüklenir.

Lighthouse budget, CI placeholder Supabase değerleriyle oturum açmadan çalışan
`/login` rotasını ölçer. PR/değişiklik geri bildirimi tek ölçüm kullanır; gece
01:30 UTC denetimi üç ölçüm kullanır. Job'ın 5 dakika sınırı vardır; kronik
FCP bekleme kuyruğu workflow'u 10–15 dakika açık tutamaz. LHCI, build çıktısını kendi random portlu statik
sunucusu yerine `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`
ile açar; bu, Playwright smoke testleriyle aynı yerel ağ desenini kullanır ve
GitHub runner'da görülen `NO_FCP` flake'ini azaltır. Lighthouse ve Playwright
smoke job'ları sabit sürümlü Playwright container'ı KULLANMAZ: tarayıcı,
package-lock sürümüne anahtarlanmış Actions cache'inden alınır; cache miss'te
`npx playwright install chromium` ile kurulur ve LHCI'ye `CHROME_PATH` ile
gösterilir. Sistem bağımlılıkları her runner'da ayrıca doğrulanır. (Eski desen sabit
`mcr.microsoft.com/playwright:vX-noble` imajıydı; Dependabot playwright'ı
yükselttiğinde imaj geride kalıyor ve tarayıcı binary'si bulunamayıp CI
günlerce kırmızı kalıyordu — 2026-06-22..07-02 arızası. İmaj etiketini geri
getirme.)
GitHub runner'da Lighthouse `provided` throttling ve daha uzun FCP/load bekleme
limiti kullanır; bu job'ın amacı üretim metriklerini birebir simüle etmekten çok
CI'da bariz performans/accessibility/best-practices regresyonlarını yakalamaktır.

## Deploy workflow

File: `.github/workflows/deploy.yml`

Runs on push to `main` or manual dispatch.

Order/parallel graph:

1. **Classify** — frontend, database/migration, and edge-function paths
2. **Verify** — lint + coverage + build + bundle budget (always; single main quality gate)
3. **Stage frontend** — when frontend changed, build one production deployment
   with `--skip-domain` in parallel; it cannot serve production yet
4. **Database check + backup** — one seeded local reset and DB audits when
   database paths changed; encrypted backup only for migration changes
5. **Supabase release** — dry-run/push only when migrations changed; deploy only
   changed edge functions (`_shared` means all)
6. **Promote frontend** — after verify and required Supabase work, promote the
   exact staged URL without rebuilding

`vercel.json` disables Vercel Git auto-deploy for `main`. The deploy hook is no
longer used. This prevents duplicate production builds and keeps new frontend
code off production until its database contract is ready. Non-production
branches keep Vercel Git preview deployments.

Ek otomasyon:
- `ci.yml`: PR/develop Lint+Build (required); path-aware Lighthouse, Playwright,
  and Supabase checks; nightly three-run Lighthouse audit.
- Dependabot patch/minor PR'larını CI yeşilse otomatik squash-merge eder (major elde kalır).
- Günlük şifreli DB yedeği cron'u (`db-backup.yml`).
- Günlük Web Push gönderici cron'u (`push-notify.yml`): 04:00 UTC / 07:00 TR, `push-notify` edge fonksiyonunu service-role ile invoke eder.
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

The workflow pins Vercel CLI `54.9.1`, creates an unaliased staged production
build, and promotes that exact URL after the release gates pass.

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

## Recommended Branch Flow

1. Create branch: `feature/...`
2. Implement change
3. Run `npm run ci:local`
4. Push branch
5. Open PR
6. Wait for `CI` workflow to pass
7. Merge to `main`
8. `Deploy Production` runs automatically

## Notes and Guardrails

- Keep production schema changes migration-driven only.
- For schema/RPC releases, use `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` before merge.
- Do not store secret values in `.env.example`, workflow files, or source.
- Do not remove `git.deploymentEnabled.main = false` while the staged CLI flow
  is active; that would recreate duplicate production builds and bypass release
  ordering.
- Do not replace the pinned Vercel CLI version with `latest`.
- The Playwright suite is intentionally a smoke layer right now. Expand it gradually around stable user flows.
