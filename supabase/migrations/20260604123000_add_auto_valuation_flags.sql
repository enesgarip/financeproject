-- Auto-valuation provenance flags.
--
-- Gold and foreign-currency holdings/debts/goals can now derive their TRY value
-- from live market rates instead of a hand-typed `estimated_value_try`. This
-- flag marks the rows the user opted into automatic valuation, so background
-- refreshes only ever overwrite values that are meant to be derived. Existing
-- rows default to `false` and keep their current manual values untouched.

alter table public.assets
add column if not exists auto_valued boolean not null default false;

alter table public.debts
add column if not exists auto_valued boolean not null default false;

alter table public.savings_goals
add column if not exists auto_valued boolean not null default false;
