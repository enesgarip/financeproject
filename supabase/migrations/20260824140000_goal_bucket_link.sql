-- Hedefe kasa kovası bağlama: "aylık gerekli" yazıdan mekanizmaya dönüyor.
--
-- Sorun: hedef kartındaki "Aylık gerekli: ₺25.000" yalnız bir BİLGİYDİ;
-- harcanabilir tutarı (safeToSpend) hiç etkilemiyordu. Yani plan, harcama
-- kararının önüne hiç çıkmıyordu.
--
-- Çözüm: hedef bir kasa kovasına bağlanır. Kova zaten "dokunulmaz ayrılmış
-- para" olarak harcanabilirden düşülüyor (kasaMode.ts + safeToSpend.ts), yani
-- hedefe ayırdığın an bu ay harcayabileceğin tutar gerçekten azalır.
--
-- Ayırma OTOMATİK DEĞİL, tek tık: para (planlama düzeyinde de olsa) kullanıcı
-- fark etmeden hareket etmemeli. Hangi ay ayrıldığı kovada tutulur ki kart
-- "bu ay ayrıldı" ile "bu ay bekliyor"u ayırt edebilsin.

alter table public.kasa_buckets
  -- Hedef silinince kovadaki para KAYBOLMAZ, yalnız bağ kopar: kova kendi
  -- başına anlamlı bir planlama satırıdır (cascade delete veri kaybı olurdu).
  add column goal_id uuid null references public.savings_goals(id) on delete set null,
  -- Ayırmanın yapıldığı ayın ilk günü (Istanbul takvimi; bkz.
  -- 20260819120000_istanbul_calendar.sql). NULL = hiç ayrılmamış.
  add column last_contribution_month date null;

-- Bir hedefin en fazla bir kovası olur; iki kova aynı hedefi beslerse "kasada
-- ayrılan" iki farklı sayı olurdu.
create unique index kasa_buckets_goal_idx on public.kasa_buckets (goal_id) where goal_id is not null;

/**
 * Kovaya hedef planı kadar ekler ve ayın damgasını basar.
 *
 * Client tarafında oku-değiştir-yaz yapılsaydı iki sekme aynı anda ayırdığında
 * biri diğerini ezerdi; artırım tek ifadede, sunucuda.
 */
create or replace function public.contribute_to_goal_bucket(
  p_bucket_id uuid,
  p_amount numeric
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reserved numeric;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Ayrılacak tutar 0''dan büyük olmalı.';
  end if;

  update public.kasa_buckets
  set reserved_amount = reserved_amount + p_amount,
      last_contribution_month = date_trunc('month', current_date)::date,
      updated_at = now()
  where id = p_bucket_id
    and user_id = v_user_id
  returning reserved_amount into v_reserved;

  if not found then
    raise exception 'Kova bulunamadı.';
  end if;

  return v_reserved;
end;
$$;

revoke execute on function public.contribute_to_goal_bucket(uuid, numeric) from public;
revoke execute on function public.contribute_to_goal_bucket(uuid, numeric) from anon;
grant execute on function public.contribute_to_goal_bucket(uuid, numeric) to authenticated;
