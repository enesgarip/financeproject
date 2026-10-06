-- Findeks kredi notu geçmişi: finansal bakiyelerden bağımsız manuel ölçüm serisi.

create table public.credit_score_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  score smallint not null check (score between 1 and 1900),
  checked_on date not null,
  note text,
  unique (user_id, checked_on)
);

create index credit_score_history_user_checked_on_idx
  on public.credit_score_history(user_id, checked_on desc);

create trigger set_credit_score_history_updated_at
before update on public.credit_score_history
for each row execute function public.set_updated_at();

alter table public.credit_score_history enable row level security;

create policy "credit_score_history_select_own" on public.credit_score_history
for select to authenticated
using (user_id = (select auth.uid()));

create policy "credit_score_history_insert_own" on public.credit_score_history
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "credit_score_history_update_own" on public.credit_score_history
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "credit_score_history_delete_own" on public.credit_score_history
for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on table public.credit_score_history to authenticated;

-- Mevcut sıfırlama gövdesini koruyup yeni tabloyu kapsamına alan dar sarmal.
alter function public.reset_user_finance_data()
  rename to reset_user_finance_data_without_credit_scores;

revoke all on function public.reset_user_finance_data_without_credit_scores() from public;
revoke all on function public.reset_user_finance_data_without_credit_scores() from anon;
revoke all on function public.reset_user_finance_data_without_credit_scores() from authenticated;

create function public.reset_user_finance_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;
  delete from public.credit_score_history where user_id = v_user_id;
  perform public.reset_user_finance_data_without_credit_scores();
end;
$$;

revoke all on function public.reset_user_finance_data() from public;
revoke all on function public.reset_user_finance_data() from anon;
grant execute on function public.reset_user_finance_data() to authenticated;

-- Transaksiyonel geri yüklemenin mevcut whitelist'ini koru; kredi notu
-- satırlarını sarmalda doğrulayıp aynı transaction içinde ekle.
alter function public.restore_user_finance_data_tx(jsonb)
  rename to restore_user_finance_data_tx_without_credit_scores;

revoke all on function public.restore_user_finance_data_tx_without_credit_scores(jsonb) from public;
revoke all on function public.restore_user_finance_data_tx_without_credit_scores(jsonb) from anon;
revoke all on function public.restore_user_finance_data_tx_without_credit_scores(jsonb) from authenticated;

create function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_rows jsonb := p_payload->'tables'->'credit_score_history';
  v_base_payload jsonb;
  v_result jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;
  if v_rows is not null and jsonb_typeof(v_rows) <> 'array' then
    raise exception 'credit_score_history tablosunun satırları liste değil.';
  end if;

  if v_rows is not null and exists (
    select 1
    from jsonb_to_recordset(v_rows) as r(score integer, checked_on date)
    where r.score is null or r.score not between 1 and 1900 or r.checked_on is null
  ) then
    raise exception 'Yedekte geçersiz kredi notu kaydı var.';
  end if;

  v_base_payload := jsonb_set(
    p_payload,
    '{tables}',
    coalesce(p_payload->'tables', '{}'::jsonb) - 'credit_score_history'
  );
  v_result := public.restore_user_finance_data_tx_without_credit_scores(v_base_payload);

  if v_rows is not null and jsonb_array_length(v_rows) > 0 then
    insert into public.credit_score_history (id, user_id, created_at, updated_at, score, checked_on, note)
    select
      coalesce(r.id, gen_random_uuid()),
      v_user_id,
      coalesce(r.created_at, now()),
      coalesce(r.updated_at, now()),
      r.score,
      r.checked_on,
      r.note
    from jsonb_to_recordset(v_rows) as r(
      id uuid,
      user_id uuid,
      created_at timestamptz,
      updated_at timestamptz,
      score smallint,
      checked_on date,
      note text
    );
    get diagnostics v_count = row_count;
  end if;

  return jsonb_set(
    v_result,
    '{tables,credit_score_history}',
    to_jsonb(v_count),
    true
  );
end;
$$;

revoke all on function public.restore_user_finance_data_tx(jsonb) from public;
revoke all on function public.restore_user_finance_data_tx(jsonb) from anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
