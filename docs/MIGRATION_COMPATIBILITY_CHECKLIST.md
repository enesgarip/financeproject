# Migration Compatibility Checklist

Last reviewed: 2026-06-15

Use this checklist before merging any change that touches Supabase migrations,
RPC contracts, RLS policies, edge functions, generated database types, or
frontend code that expects a new schema.

## 1. Classify The Change

- Table/column/index/constraint change
- RLS policy change
- RPC signature or behavior change
- Trigger/function behavior change
- Edge function change
- Frontend-only change that expects a migration already deployed

If the change affects money movement, also update:

- `docs/RPC_ACTION_REFERENCE.md`
- `docs/CARD_DEBT_TRANSITIONS.md` when card debt fields move
- `docs/FINANCE_RULES.md` when business semantics change

## 2. Migration Hygiene

- Add a new timestamped migration under `supabase/migrations/`.
- Do not edit an already-applied production migration.
- Prefer idempotent DDL where practical: `if exists`, `if not exists`, safe
  `drop function if exists` before signature changes.
- For RPC signature changes, update grants for the final signature.
- For destructive operations, document why data loss is intentional and whether
  the deploy backup is enough rollback coverage.
- For RLS changes, make sure policies still scope rows by `auth.uid()` unless
  there is an explicit reason.

## 3. Frontend Compatibility

- Update `src/types/database.ts` for new or changed tables, columns, enums, and
  RPC signatures.
- Update repository/service wrappers before page code consumes the new contract.
- Decide whether a schema-cache/RPC fallback is still needed. If yes, keep the
  fallback narrow and add a note for removing it after production catches up.
- For user-visible missing schema/RPC states, use
  `missingSupabaseCapabilityMessage` from `src/utils/supabaseErrors.ts` so the
  UI clearly says this is a migration/RPC deployment mismatch and includes the
  Supabase code when available.
- Make sure production order is safe: the deploy workflow applies migrations and
  edge functions before triggering the Vercel deploy hook.
- If preview deployments can run against an older database, avoid hard failures
  for non-critical optional tables or functions.

## 4. Local Verification

Minimum app checks:

```bash
npm run lint
npm run test:unit
npm run build
```

Migration checks when Supabase local is available:

```bash
npm run db:reset:local
npm run db:lint:local
npm run db:audit:rls:local
```

Broader release check:

```bash
npm run ci:local
```

`ci:local` includes Playwright; use it when the change affects user flows or
navigation. For migration-only changes, CI's Supabase job remains the main
guardrail.

## 5. Pull Request Review

- Confirm CI passed:
  - lint
  - unit coverage gate
  - build
  - bundle budget
  - Lighthouse performance/accessibility/best-practices budget
  - Playwright smoke
  - Supabase local reset/lint/RLS audit
- Review the migration plan in CI or with `supabase db push --linked --dry-run
  --include-all` before production application.
- Confirm docs changed when RPC or finance behavior changed.
- Confirm any new environment variable is reflected in `.env.example`, GitHub
  secrets, and Vercel project settings.

## 6. Production Deploy Order

The `Deploy Production` workflow currently does this on `main`:

1. Detect whether migration files changed.
2. Run encrypted pre-migration backup when migrations changed.
3. Link the production Supabase project.
4. Show migration dry run.
5. Apply pending migrations with `--include-all`.
6. Deploy edge functions.
7. Trigger the Vercel production deploy hook.

Do not bypass this order for schema/RPC changes. The app should see the new
database contract before the new frontend goes live.

## 7. Post-Deploy Smoke

After a schema/RPC release, check the affected flow in production:

- Login loads the dashboard without schema-cache errors.
- Cards/account pages load if card tables or RPCs changed.
- Data health does not show new false-positive finance issues.
- Any changed RPC-backed action succeeds on a small safe record.
- Sentry/logs do not show missing column/function errors.

## 8. Rollback Notes

- Supabase migrations are treated as forward-only in normal work.
- If production data must be restored, use the pre-migration backup artifact from
  the deploy workflow.
- If only frontend behavior is bad after successful migrations, revert or patch
  the frontend while leaving the database forward.
- If an RPC contract must be changed again, prefer adding compatibility rather
  than removing the just-deployed signature immediately.
