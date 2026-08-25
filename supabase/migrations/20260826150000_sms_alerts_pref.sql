-- Tanınmayan SMS bekçisi (fikir turu PR G): push-notify'ın yeni
-- sms_failure_daily türü için tercih anahtarı. İşlenemeyen banka SMS'i sessiz
-- veri kaybıdır (harcama karta düşmez, dönem içi kova ve ekstre tahmini
-- gerçeğin altında kalır); günlük tek toplu bildirim bunu ertesi sabah
-- görünür kılar. Varsayılan açık (opt-out) — mevcut tercih satırı olmayan
-- kullanıcıda da açık davranış korunur (push-notify applyPreferences kuralı).
-- Şablon: 20260824200000_goal_contribution_reminder_pref.sql

alter table public.notification_preferences
  add column if not exists sms_alerts_enabled boolean not null default true;
