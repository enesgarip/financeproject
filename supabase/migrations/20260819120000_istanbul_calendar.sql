-- Takvim saat dilimi: uygulamanin gunu Istanbul, veritabaninin `current_date`i UTC idi.
--
-- Belirti: Istanbul saatiyle 00:00-03:00 arasinda yapilan bir alisverista
-- `post_card_provision` ilk taksidin vadesini `v_due_month <= current_date` ile
-- kiyasliyor, `current_date` hala DUNU (UTC) gosterdigi icin taksit o gun donem
-- ici borca girmiyor, bir gun geç giriyordu. Ayni kayma `current_date` kullanan
-- 13 kart/odeme fonksiyonunun HEPSINDE vardir (ekstre kesimi, vadesi gelen
-- taksit isleme, bayat provizyon kesinlestirme, odeme gecikme kontrolu...).
-- Tutarlar dogru kalir; kayan sey kova/donem uyeligidir.
--
-- Cozum tek noktadan: veritabaninin varsayilan saat dilimi Istanbul olur.
-- `timestamptz` mutlak zamandir, DEPOLANMIS VERI DEGISMEZ; degisen yalniz
-- `current_date`/`localtimestamp` gibi ifadelerin ve timestamptz→date
-- cast'lerinin hangi takvim gununu verdigidir — ki bu uygulamanin (tek
-- kullanicili, Turkiye) zaten kastettigi takvimdir. Depoda UTC varsayan tek bir
-- SQL yolu yok (yalniz uc yerde ACIKCA 'Europe/Istanbul' yaziyor, onlar dogru
-- kalir).
--
-- Dikkat: ALTER DATABASE ... SET yalniz YENI oturumlari etkiler; havuzdaki
-- mevcut baglantilar geri donusene kadar UTC ile devam eder.
--
-- pg_cron zamanlamasi ayri bir GUC'tur (`cron.timezone`), bu degisiklikten
-- etkilenmez: gunluk bakim isi 00:05 GMT'de kosmaya devam eder — o an Istanbul
-- saati 03:05, yani is artik dogru sekilde YENI gunun tarihini gorur.
do $$
begin
  execute pg_catalog.format(
    'alter database %I set timezone to %L',
    pg_catalog.current_database(),
    'Europe/Istanbul'
  );
end
$$;

-- Yeni kod oturum ayarina bagli kalmasin diye kanonik "bugun" yardimcisi.
-- current_date ile ayni sonucu verir ama niyeti aciktir.
create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
$$;

revoke all on function private.today_ist() from public, anon, authenticated;
