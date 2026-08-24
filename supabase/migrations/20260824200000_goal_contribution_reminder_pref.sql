-- Hedefe aylık ayırma hatırlatması için bildirim tercih kolonu.
--
-- Neden: hedefe bağlı kasa kovasının aylık ayırması (bkz.
-- 20260824140000_goal_bucket_link.sql) TEK TIK ama kullanıcı Planlama sayfasına
-- girmedikçe hiç görünmüyor. Ay geçtikçe plan sessizce kayıyor; oysa "ayır"
-- eylemi harcanabilir tutarı gerçekten düşürdüğü için ayın BAŞINDA yapılması
-- anlamlı.
--
-- Bu migration yalnız tercih kapısını ekler; adayı push-notify üretir.
alter table public.notification_preferences
  add column goals_enabled boolean not null default true;
