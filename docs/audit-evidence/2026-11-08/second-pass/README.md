# İkinci mantık taraması kanıtları

Rapor: `docs/LOGIC_UI_AUDIT_SECOND_PASS_2026-11-08.md`.
Bu kayıtlar düzeltme içermez; mevcut kusurlu davranışı doğrular.

- `browser-observations.spec.txt` → geçici `tests/e2e/audit-second-temporary.spec.ts`;
  komut: `npm exec -- playwright test audit-second-temporary.spec.ts --workers=1`.
  13 sentetik Chromium gözlemi; dış istekler karşılanır/engellenir.
- `domain-observations.test.txt` → geçici `src/audit-second-temporary.test.ts`.
- `restore-observation.test.txt` → geçici `src/audit-second-restore-temporary.test.ts`.
  İkisi için `npm exec -- vitest run src/audit-second-temporary.test.ts src/audit-second-restore-temporary.test.ts`.
  3 gözlem; kredi planı gerçek fonksiyonundan repo yazma sınırında yakalanır,
  restore RPC yalnız mock'tur; gerçek restore/reset çağrılmaz.
- `money-observations.sql.txt`, `gold-observation.sql.txt`: yalnız
  `supabase_db_financeproject` container'ında psql stdin'ine verilir.
  İki script de BEGIN/ROLLBACK kullanır. Para hareketi/transfer/fon alışının
  tekrarları, katkı olayı tekrarı, miktar hassasiyeti ve negatif altın
  envanteri gerçek PostgreSQL'de gözlemlenir.
- `api-cap-observation.mjs.txt`: geçici repo kökü `.mjs` script'i olarak
  çalıştırılır. Yerel Supabase CLI durumunu bellekte okur; anahtarı yazdırmaz.
  Yalnız loopback API kabul eder. 1001 sıfır-değerli asset fixture'ı ekler,
  exact count/limit/dönen satır sayısını karşılaştırır ve yalnız kendi tam
  marker'lı kayıtlarını finally'de siler. Özgün sonuç: 1001/1500/1000;
  cleanup: DELETE 1001.
- `browser-results.txt`, `domain-results.txt`, `money-sql-results.txt`,
  `gold-sql-results.txt`, `api-cap-results.txt`: son başarılı gözlem çıktıları.
- `audit2-*.png`: sentetik ekran görüntüleri. Tarih senaryolarda 26 Ekim
  2026'ya sabit; denetim tarihi 8 Kasım 2026'dır.

Geçici testleri normal test paketinde bırakma: bug'ı bekleyen assertion'lar
kalıcı kabul testi değildir. Düzeltmede tersine, doğru davranışı doğrulayan
regresyonlar yazılmalıdır. Birinci turun kanıtları üst klasörde korunur.
