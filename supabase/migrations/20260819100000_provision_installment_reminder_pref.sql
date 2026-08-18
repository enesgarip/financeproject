-- Taksit onayi bekleyen provizyon hatirlatmasi icin bildirim tercih kolonu.
--
-- Neden: SMS provizyonu her zaman tek cekim (installment_count = 1) dogar, cunku
-- banka SMS'inde taksit bilgisi yoktur. Kullanici taksit sayisini panelden
-- isaretlemezse run_scheduled_card_maintenance 7. gunde provizyonu OLDUGU GIBI
-- kesinlestirir ve plan tek cekim olarak dogar. Ekstre kesildikten sonra
-- duzeltme append-only correction akisina dustugu icin, dogru cozum kullaniciyi
-- otomatik kesinlestirmeden ONCE durtmektir.
--
-- Bu migration yalniz tercih kapisini ekler; adayi push-notify uretir.
alter table public.notification_preferences
  add column provisions_enabled boolean not null default true;
