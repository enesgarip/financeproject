-- Yeni harcama kategorisi: 'Finansman' (nakit avans / faiz / BSMV / KKDF /
-- gecikme / kart aidatı). Kanonik liste `src/utils/categories.ts`.
--
-- VERİ MİGRASYONU YOK: yeni kategori, hiçbir mevcut satır bu değeri taşımıyor.
-- Gerekli TEK DB işi safe-repair RPC'sindeki beyaz listeyi genişletmek; aksi
-- halde Veri Sağlığı'ndan bir harcamayı Finansman'a çekmek
-- "Geçerli bir harcama kategorisi seçilmelidir" ile reddedilir.
--
-- Aşağısı 20260816120000'deki fonksiyonun BİREBİR kopyasıdır; yalnız beyaz
-- listeye 'Finansman' eklendi.

create or replace function public.update_card_expense_health_metadata(
  p_expense_id uuid,
  p_description text,
  p_category text,
  p_expected_updated_at timestamptz
)
returns public.card_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card_id uuid;
  v_expense public.card_expenses%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_expense_id is null or p_expected_updated_at is null then
    raise exception 'Harcama ve kontrol sürümü zorunludur.';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Harcama açıklaması zorunludur.';
  end if;

  if p_category not in (
    'Market', 'Yeme & İçme', 'Ulaşım', 'Alışveriş', 'Fatura', 'Sağlık',
    'Eğlence', 'Eğitim', 'Konut', 'Abonelik', 'İş',
    'Kişisel Bakım', 'Hediye', 'Finansman', 'Diğer'
  ) then
    raise exception 'Geçerli bir harcama kategorisi seçilmelidir.';
  end if;

  select card_id
  into v_card_id
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Harcama bulunamadı.';
  end if;

  -- Preserve the canonical card -> expense -> child lock order used by
  -- statement allocation and expense editing.
  perform id
  from public.cards
  where id = v_card_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Kart bulunamadı.';
  end if;

  select *
  into v_expense
  from public.card_expenses
  where id = p_expense_id
    and user_id = v_user_id
    and card_id = v_card_id
  for update;

  if not found then
    raise exception 'Harcama bulunamadı veya kartı değişti; yeniden deneyin.';
  end if;

  if v_expense.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE: Harcama kontrol sonrasında değişti.';
  end if;

  if v_expense.status = 'cancelled' then
    raise exception 'İptal edilmiş harcama değiştirilemez.';
  end if;

  update public.card_expenses
  set description = btrim(p_description),
      category = p_category,
      updated_at = now()
  where id = v_expense.id
    and user_id = v_user_id
  returning * into v_expense;

  return v_expense;
end;
$$;

revoke all on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) from public;
revoke all on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) from anon;
grant execute on function public.update_card_expense_health_metadata(uuid, text, text, timestamptz) to authenticated;
