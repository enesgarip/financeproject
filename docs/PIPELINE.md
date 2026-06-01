# Development and Deploy Pipeline

## Goal

This pipeline keeps the FinanceProject workflow simple:

1. develop on a feature branch
2. run local quality checks
3. push to GitHub
4. open PR
5. let GitHub Actions validate app + migrations
6. merge to `main`
7. apply Supabase migrations
8. trigger Vercel production deploy hook

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

Runs on PRs and active development branches.

Checks:

- lint
- build
- Playwright smoke test
- Supabase local migration reset + lint

## Deploy workflow

File: `.github/workflows/deploy.yml`

Runs on push to `main` or manual dispatch.

Order:

1. link to the production Supabase project
2. dry-run migrations
3. apply pending migrations
4. trigger Vercel deploy hook

## Required GitHub Secrets

## App / build

These are already needed by the frontend runtime:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Note: CI smoke tests use safe placeholder values because they only verify unauthenticated routing and login form rendering.

## Production migration

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`

`SUPABASE_ACCESS_TOKEN` is used by the CLI for authenticated project operations.

## Production deploy

- `VERCEL_DEPLOY_HOOK_URL`

This should be the deploy hook for the production branch.

## Optional Vercel CLI Secrets

Not required by the current hook-based production deploy flow, but useful if the team later switches to CLI-based deploys:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Required Vercel / Supabase Setup Outside Git

## Supabase

1. Ensure production project is reachable with the CLI.
2. Store `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` in GitHub secrets.
3. Keep all schema changes as migration files under `supabase/migrations/`.

## Vercel

1. Connect the repository to the Vercel project.
2. Create a production deploy hook for the branch that should go live.
3. Store the hook URL in `VERCEL_DEPLOY_HOOK_URL`.

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
- Do not store secret values in `.env.example`, workflow files, or source.
- If Vercel Git auto-deploy is also enabled for `main`, deploy hook usage can create duplicate production deploys. For strict migration-then-deploy sequencing, align Vercel project settings with this workflow.
- The Playwright suite is intentionally a smoke layer right now. Expand it gradually around stable user flows.
