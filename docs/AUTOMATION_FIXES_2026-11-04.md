# Otomasyon düzeltmeleri — 4 Kasım 2026

Durum: **AUTO-01–11 uygulandı; yerel doğrulama tamamlandı.** Yayın: [PR #285](https://github.com/enesgarip/financeproject/pull/285).
Başlangıç kanıtı: `docs/AUTOMATION_AUDIT_2026-11-03.md`.
Bu paket mevcut otomasyonları düzeltir. Günlük eylem özeti, yeni gerçek ekstre /
kişisel borç vade bekçisi ve inceleme kutusu sonraki ürün paketidir.

## Bulgudan düzeltmeye

| Kimlik | Son davranış | Kalıcı kanıt |
| --- | --- | --- |
| AUTO-01 | Bir harfli parça içeren kişi adı otomatik eşleşmez. Banka SMS girişi kaydedilir; kanıtsız kişisel borç/alacak azalmaz, eşleşmeme nedeni döner. Geçmiş kayıt tahminle düzeltilmez. | `supabase/tests/automation_identity_and_delivery.sql`; mevcut `sms_personal_debt_match.sql` Türkçe ad, tam kelime, tek/çok aday ve kısmi ödeme kapsamını korur. |
| AUTO-02 | DB dump manifesti public/auth/storage yanında private ve extensions içerir; sahiplik ve ACL korunur. Şifreli artifact 30 gün tutulur, en yeni 5 adede indiren prune kaldırıldı. | `scripts/test-backup-restore.mjs`: gerçek yerel dump → boş DB → makbuz + aynı ödeme no-op + yeni ödeme + yetki sınırı. CI ve production DB kapısına bağlı. |
| AUTO-03 | UI ve edge aynı `paymentOccurrenceIso` kuralıyla cari tekrar tarihini bulur; başlangıç/bitiş/durum ve ayın son günü korunur. Haftalık özet de cari oluşumu kullanır. | `src/utils/automationRules.test.ts`, `tests/edge/pushAutomation.test.ts`; 28/29/30/31 ve ay/yıl devri. |
| AUTO-04 | Eksik kasa/kaynak veya otomatik fiyatla hedef noktası yazılmaz. Gerçek sıfır yazılır. Karma hedefin eksik bileşeni hedefi dışarıda bırakır; bağımsız tam hedefler yazılır. Net değer ve hedef günlük başarı damgaları ayrıdır; hedef başarısızsa aynı gün sonraki gezinmede retry olur. | `src/app/dailyGoalSnapshots.test.ts`, `src/app/useDailyNetWorthSnapshot.test.tsx`. |
| AUTO-05 | Önceki user log'u DB'de tam anahtarla aranır; 1000 log sınırı yok. Yeni teslimler kullanıcı + olay + cihaz için transaction içinde claim edilir. Edge REST okumaları 500'lük sayfalarla tamamlanır. | 1101 eski log + lease/tekrar SQL testi; `tests/edge/pushAutomation.test.ts`; üç gerçek eşzamanlı worker testi. |
| AUTO-06 | İlk cihazın başarısı ikinci cihazın 429/5xx retry'ını kapatmaz. Başarılı cihaz yeniden gönderilmez; 404/410 aboneliği temizlenir. Tercih/sessiz saat, SQL claim öncesi de yeniden okunur. | Gerçek SQL + edge transport testi. |
| AUTO-07 | Gönderimden önce kalıcı cihaz niyeti yazılır. Başarı ile user log'u aynı SQL transaction'ında tamamlanır. Transport timeout veya sonuç yazma belirsizliği kör retry üretmez; `unknown` görünür kalır. Eski token yeni lease'i tamamlayamaz. | Edge kabul-sonrası DB hatası ve timeout; SQL lease/token; `scripts/test-notification-concurrency.mjs`. |
| AUTO-08 | Bakım alt aşama hataları sayılır, son durum ve son başarılı zaman saklanır. Bakım HTTP/alt aşama veya cihaz teslim hatası edge'de `ok=false` / HTTP 502 olur; abonelik yokluğu hatayı gizlemez. | Gerçek SQL sentetik bakım istisnası; edge aboneliksiz 500/alt-hata testleri; ayar paneli durum testi. |
| AUTO-09 | UI/edge ortak transfer elemesi kullanır: aynı İstanbul gününde eşit çıkışlı giriş maaş ipucuna dönüşmez. Hareket okuması 200 satırda kesilmez; offset farklılıklarında gün ve sıra tutarlıdır. | `salaryDeposit.test.ts`, `financePanelsRepo.test.ts`; maaş sinyali hâlâ tutar tabanlı bir ipucudur, işveren doğrulaması değildir. |
| AUTO-10 | Kart kaynak kapsamı PK imleciyle eksiksiz okunur; herhangi bir sayfa hatası kısmi başarı sayılmaz. 600 SMS + 600 manuel → 1200 kayıt / %50. | `cardsRepo.test.ts`; oran insansız işlem veya dakika tasarrufu iddiası değildir. |
| AUTO-11 | Ana tetikleyici DB `pg_cron`: 15 dakikada bir tarama, İstanbul 07:00 sonrası günlük adaylar. Sessiz saat içinde elenen güncel aday sonraki uygun kontrolde tekrar değerlendirilir. GitHub workflow yalnız manuel fallback olur; tüm tetikleyiciler aynı claim yolunu kullanır. | Scheduler SQL kurulum/rotasyon/tek job testi, HMAC süre/imza testi, sessiz saat ve gece yarısında biten push TTL testi. Canlı kurulum release adımında yapılır. |

## Teslim sözleşmesi

`private.notification_deliveries` yalnız kullanıcı/olay/cihaz kimliği ve teslim
durumu tutar; bildirim metni, kişi/tutar veya endpoint kopyası saklamaz.
İki dakikalık lease aynı cihaz/olay için eşzamanlı gönderimi engeller. 429/5xx
sonucu 2 dakika–1 saat backoff ve en fazla 8 denemeyle tekrar edilebilir;
gerçek deneme 15 dakikalık taramaya ve güncel aday/tercih uygunluğuna bağlıdır.

**Dış push servisi ile DB arasında exactly-once garantisi yoktur.** Belirsiz
kabulde otomatik tekrar yerine görünür `unknown` seçilir. Bu tercih çift
teslimi önlerken bir bildirimin ulaşmamasına neden olabilir. Sonuç DB'ye
yazılamadıysa açık lease süresi dolunca belirsiz sayılır; aynı olay yeniden
claim edilmez. Manuel test bildirimi ayrı kullanıcı isteği ve ayrı olaydır.

Kuyruk eski başlık/tutarı sonradan oynatmaz; adaylar güncel kaynaklardan yeniden
üretilir. Geçerli aday penceresi dışına çıkan olay gönderilmez. Push TTL'i
İstanbul gece yarısıyla sınırlıdır; “yarın” başlığının ertesi gün cihaz kuyruğundan
gelmesi istenmez. Günlerce kesintiden sonra kaçırılmış her eski uyarıyı geriye
dönük gönderme veya kesin saatte cihazda gösterilme garantisi verilmez.

`NotificationSettings.tsx` son bakım/son başarı zamanını, scheduler HTTP
sonucunu, gecikmeyi, retry/başarısız/belirsiz cihaz sayılarını ve yenileme
eylemini gösterir. Push desteklenmeyen veya istemci VAPID anahtarı olmayan
ortamda da sağlık durumu görünür. HTTP kabulü cihazda okunma kanıtı değildir.

## Scheduler kurulum ve sır sınırı

Migration `20261103182000_push_scheduler.sql`, `pg_net` ve yapılandırma
fonksiyonunu kurar; **secret yokken job açmaz**. Release, migration ve edge
deploy başarılı olduktan sonra `scripts/configure-push-scheduler.mjs` çalıştırır.
Mevcut `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ANON_KEY`,
`PUSH_CRON_SECRET` ortam ayarları kullanılır. Edge'in cron secret'ı ile GitHub
secret'ı aynı olmalıdır. SQL veya hata yanıtı loglanmaz.
Kurulum, anahtarın baş/son boşluğunu edge ile aynı biçimde temizler;
satır-sonlu ortam değeri farklı bir HMAC anahtarı üretmez.

Yapılandırma yalnız DB yönetim rolüne açıktır; anon/authenticated/service_role
tarafından çağrılamaz. Secret Vault'tadır. `pg_net` geçici HTTP kuyruğuna ham
secret veya service-role key değil **timestamp + nonce + HMAC** yazılır; edge
imzayı ve 120 saniyelik pencereyi doğrular. Cron komutu secret içermez.
Kurulum tekrarlandığında aynı job ve Vault kaydı güncellenir. Son async HTTP
sonucu bir sonraki cron turunda izlenir; cevapsız/timeout sonuç başarı sayılmaz.

Kurulumun ve canlı ilk başarılı koşunun gözlemi yayın sırasında yapılmalıdır.
Bu çalışma üretim cron'unu, Vault'u veya edge'i değiştirmedi; gerçek push
gönderilmedi. Geri alma gerektiğinde job `cron.unschedule` ile durdurulabilir;
private makbuz/teslim tabloları düşürülmez. Manuel fallback de mevcut tekillik
kurallarından geçer.

## Yedek kurtarma sınırı

`scripts/backup-schemas.txt` workflow ve gerçek restore testinin ortak kapsamıdır.
Dump sahiplik ve yetki tanımlarını sıyırmaz; aksi halde SECURITY DEFINER
fonksiyonlarının güvenlik sınırı ve managed auth/storage izinleri bozulabilir.
Restore testi aynı Supabase kurulumu içindeki boş `template0` DB'de provider
yönetici rolüyle çalışır; finans işlemleri authenticated rolüyle denenir.
CI'daki parola doğrulaması için yalnız test container'ının kendi
`POSTGRES_PASSWORD` değeri container içinde psql ortamına verilir; host'a veya
log'a çıkarılmaz. Test üretim bağlantısı/parolası kabul etmez.

Bu, üretim verisini başka bir projeye taşıma provası değildir. Kurtarma hedefi
uyumlu PostgreSQL/Supabase extension'ları ve managed rollerle hazırlanmalı;
tam dump'ın managed ACL/owner tanımları için uygun yönetici rolü kullanılmalıdır.
Auth/Storage şemaları DB metadatasıdır; dış hizmet sırları ve Vault anahtar
yönetimi bu dump ile taşınmaz. Kurtarma sonrası mevcut dış ortam sırlarıyla
scheduler tekrar yapılandırılır. Kullanıcı JSON export/reset/restore makbuz
sözleşmesi değişmez; private işlem hash'i DB felaket kurtarma kapsamındadır.

## Doğrulama

- `npm run verify`: 180 dosya / 1875 test, 10 guard, lint/coverage,
  production dependency audit 0 açık, build/bundle 1013,3 / 1030 kB ve 6 edge tipi.
- `npm run db:seed:local` + `npm run db:test:all`: 54/54 gerçek SQL testi.
  DB lint temiz. Finans ledger/trigger geçmişi yeniden yazılmadı.
- `npm run db:test:notifications`: üç eşzamanlı gerçek worker, tek claim.
- `npm run db:test:backup`: owner/ACL/private makbuz dahil gerçek dump/restore;
  aynı ödeme no-op, yeni ödeme çalışır, anon/authenticated yetki sınırı korunur.
- `tests/e2e/simplification.spec.ts`: 25 tarayıcı senaryosu; yeni 320 px
  sağlık isteği → API yanıtı → görünür sonuç → yenileme akışı dahil.
- Dört değişen workflow YAML olarak ayrıştırıldı; prod kurulum çalıştırılmadı.
- İzole gerçek yerel Auth/PostgREST: 1200 harcama tam okundu (%50, 600 manuel);
  1101 eski log sonrasında bilinen olay claim edilmedi. Test kullanıcısı temizlendi.

Yerel sonuçlar ve 320 px ekran görüntüsü:
`C:/Users/Enes/.codex/visualizations/2026/11/02/01a19e7e-ba01-70e1-b7ab-878ab10344d1/automation-audit/`:
`fixes-verify.log`, `fixes-db-tests.log`, `fixes-db-lint.log`,
`fixes-concurrency.log`, `fixes-backup-restore.log`, `fixes-e2e.log`,
`fixes-browser-health.log`, `fixes-health-320.png`, `fixes-workflows.log`.
Gerçek REST tekrar kanıtı: `fixes-volume-real.json`.
