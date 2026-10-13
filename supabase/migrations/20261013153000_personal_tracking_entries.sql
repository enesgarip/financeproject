-- Sadece takip: geri beklenmeyen ödemeler finansal borç/alacaktan ayrı saklanır.
-- Ledger, finans snapshot'ı, vade ve SMS eşleştirmesine bağlantı yoktur.
create table public.personal_tracking_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  person_name text not null check (btrim(person_name) <> ''),
  amount numeric(18, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  occurred_on date not null,
  note text
);

create index personal_tracking_entries_user_date_idx
  on public.personal_tracking_entries(user_id, occurred_on desc);

create trigger set_personal_tracking_entries_updated_at
before update on public.personal_tracking_entries
for each row execute function public.set_updated_at();

alter table public.personal_tracking_entries enable row level security;
create policy "own rows" on public.personal_tracking_entries
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
grant select, insert, update, delete on table public.personal_tracking_entries to authenticated;

-- Kredi notu migration'ındaki sarmal desen: mevcut reset davranışı korunur.
alter function public.reset_user_finance_data()
  rename to reset_user_finance_data_without_personal_tracking;
revoke all on function public.reset_user_finance_data_without_personal_tracking() from public, anon, authenticated;

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
  -- Önce mevcut gövde kullanıcı kilidini alır ve finans verisini temizler.
  perform public.reset_user_finance_data_without_personal_tracking();
  delete from public.personal_tracking_entries where user_id = v_user_id;
end;
$$;
revoke all on function public.reset_user_finance_data() from public, anon;
grant execute on function public.reset_user_finance_data() to authenticated;

-- Aynı transaction içinde restore; eski yedekte tablo yoksa boş kalır.
alter function public.restore_user_finance_data_tx(jsonb)
  rename to restore_user_finance_data_tx_without_personal_tracking;
revoke all on function public.restore_user_finance_data_tx_without_personal_tracking(jsonb) from public, anon, authenticated;

create function public.restore_user_finance_data_tx(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_rows jsonb := p_payload->'tables'->'personal_tracking_entries';
  v_base_payload jsonb;
  v_result jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Oturum bulunamadı.'; end if;
  if coalesce(p_payload->>'schema', '') <> 'financeproject-v2' then
    raise exception 'Tanınmayan yedek şeması.';
  end if;
  if jsonb_typeof(p_payload->'tables') is distinct from 'object' then
    raise exception 'Yedek gövdesi (tables) eksik ya da nesne değil.';
  end if;
  if pg_catalog.pg_column_size(p_payload) > 32 * 1024 * 1024 then
    raise exception 'Yedek dosyası beklenmedik kadar büyük (32 MB sınırı).';
  end if;
  if v_rows is not null then
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'personal_tracking_entries tablosunun satırları liste değil.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_rows) r where jsonb_typeof(r) <> 'object') then
      raise exception 'Yedekte geçersiz takip kaydı var.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_rows) r, jsonb_object_keys(r) k
      where k not in ('id', 'user_id', 'created_at', 'updated_at', 'person_name', 'amount', 'occurred_on', 'note')
    ) then
      raise exception 'Takip kaydında tanınmayan kolon var.';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(v_rows) as r(person_name text, amount numeric, occurred_on date)
      where r.person_name is null or btrim(r.person_name) = ''
        or r.amount is null or r.amount <= 0 or r.amount = 'NaN'::numeric
        or r.occurred_on is null
    ) then
      raise exception 'Yedekte geçersiz takip kaydı var.';
    end if;
  end if;

  v_base_payload := jsonb_set(p_payload, '{tables}', coalesce(p_payload->'tables', '{}'::jsonb) - 'personal_tracking_entries');
  v_result := public.restore_user_finance_data_tx_without_personal_tracking(v_base_payload);

  if v_rows is not null and jsonb_array_length(v_rows) > 0 then
    insert into public.personal_tracking_entries (id, user_id, created_at, updated_at, person_name, amount, occurred_on, note)
    select coalesce(r.id, gen_random_uuid()), v_user_id,
      coalesce(r.created_at, now()), coalesce(r.updated_at, now()),
      r.person_name, r.amount, r.occurred_on, r.note
    from jsonb_to_recordset(v_rows) as r(
      id uuid, user_id uuid, created_at timestamptz, updated_at timestamptz,
      person_name text, amount numeric, occurred_on date, note text
    );
    get diagnostics v_count = row_count;
  end if;
  return jsonb_set(v_result, '{tables,personal_tracking_entries}', to_jsonb(v_count), true);
end;
$$;
revoke all on function public.restore_user_finance_data_tx(jsonb) from public, anon;
grant execute on function public.restore_user_finance_data_tx(jsonb) to authenticated;
