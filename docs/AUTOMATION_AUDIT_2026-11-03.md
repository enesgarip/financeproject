# Otomasyon denetimi ve geliştirme planı — 3 Kasım 2026

Durum: **denetim tamamlandı; AUTO-01–11 yerelde düzeltildi, henüz yayımlanmadı**.
Düzeltme ve son kabul sözleşmesi: `docs/AUTOMATION_FIXES_2026-11-04.md`.
Aşağıdaki karşı örnekler denetim anındaki sürümün tarihsel kanıtlarıdır.
İncelenen üretim kaynak sürümü: `86c69cf847443ef4c9eb9aa5e46b3917ee926a52`.
Kapsam yoğun kişisel finans kullanımıdır. Bu çalışma yeni otomasyon açmaz,
üretim verisini değiştirmez veya bildirim göndermez; uygulama planı sunar.

## Sonuç

20 senaryo kontrolü 10 ayrı, yeniden üretilebilir sorun gösterdi; A10/A19 aynı
bildirim tekilleştirme sorununun simülasyon ve gerçek REST kanıtıdır. Ayrıca
canlı scheduler kayıtlarında belirgin saat sapması gözlendi. Öncelik yeni
otomasyondan önce **yanlış kişisel borç eşlemesi, eksik felaket kurtarma yedeği,
eksik veriden yanlış hedef tarihçesi** ve bildirim güvenilirliğidir.

Yeni değer için ilk paket: **bugünün yapılacakları + 7 günlük nakit riski**,
**gerçek kart ekstresi/kişisel borç vadeleri**, **inceleme bekleyen işlemler**.
Mevcut maaş, abonelik ve haftalık özet akışları genişletilir; tekrar kurulmaz.

## Mevcut envanter

| Akış | Tetikleyici / etkisi | Bugünkü sınır |
| --- | --- | --- |
| Kart bakımı | DB `pg_cron`, `card-maintenance-daily`; stale provizyon → vadesi gelen taksit → ekstre kesimi | Sunucuda, uygulama kapalıyken çalışır; satır hataları NOTICE ile yutulabilir |
| Bakım telafisi | Push koşusu ve istemci snapshot okuması | Bağımsız ana cron'a ek fallback; hata görünürlüğü yetersiz |
| SMS kart/hesap kaydı | `parse-sms` → kaynak olay kimlikli RPC; bakiye/ledger, koşullu borç/plan eşlemesi | Finansal yazmadır; belirsiz kişi eşlemesi kritik |
| Günlük push | GitHub Actions `0 4 * * *` = İstanbul 07:00; tercihler ve sessiz saatler | Tek koşu; sessiz saatte kuyruk yok, gerçek başlama gecikebiliyor |
| Mevcut push türleri | Plan/kredi vadesi, ekstre kesimi, provizyon, maaş/hedef katkısı, haftalık özet/mutabakat, SMS hata özeti | Gerçek açık ekstre son ödeme ve kişisel borç vadeleri ayrı aday üretmiyor |
| Net değer / hedef fotoğrafı | Layout açıkken 4 sn sonra; gün damgası + günlük upsert | Uygulama açılmayan gün kaydı yok; hedef ikinci yarısı ayrı başarı/retry izlemiyor |
| Abonelik / maaş keşfi | İşlemlerden öneri, ilgili ekranlarda gösterim | Öneri/yardımlı işlem; doğrulanmış maaş veya yeni ödeme talimatı değildir |
| Kur / BIST | İstemci yükleme-yenileme ve cache | Tarihsel sunucu değerleme servisi değildir |
| Veritabanı yedeği | Günlük Actions `0 2 * * *` = İstanbul 05:00; deploy öncesi de çağrılır | Şifreli artifact; `private` eksik, geri yükleme sonrası işlev testi yok |
| Kaynak kapsamı metriği | Son dönem kart harcamalarında kaynak türü | SMS + PDF/fiş gibi yardımlı aktarımlar birlikte sayılır; tüm uygulamanın zaman tasarrufu ölçümü değildir |

Başlıca kaynaklar: `.github/workflows/push-notify.yml`,
`.github/workflows/db-backup.yml`, `supabase/functions/push-notify/index.ts`,
`supabase/migrations/20260905100000_provision_post_before_statement_cut.sql`,
`supabase/migrations/20260908170000_sms_personal_debt_match.sql`,
`src/app/useDailyNetWorthSnapshot.ts`, `src/app/dailyGoalSnapshots.ts`,
`src/utils/salaryDeposit.ts`, `src/utils/automationCoverage.ts`.

## Canlı gözlem — salt okunur

3 Kasım 17:36 İstanbul sorgusu `BEGIN READ ONLY` ile yapıldı. SMS metni,
kişi/hesap adı, push endpoint'i veya secret alınmadı. Aktif cron'un SQL komutu
yerine yalnız beklenen bakım fonksiyonunu içerip içermediği okundu.

- DB saat dilimi `Europe/Istanbul`, cron saat dilimi `GMT`. Tek aktif iş
  `5 0 * * *`; 27 Ekim–3 Kasım arasındaki son 8 bakım koşusu 03:05'te
  `succeeded`. Bu, her satırın finansal sonucunun ayrıca doğrulandığı anlamına gelmez.
- Son 7 gün SMS: 18 başarılı, 1 hata. Beş push aboneliği, 9 bildirim log'u
  mevcut. Bunlar cihazda görüldü/okundu kanıtı değildir.
- Üretimde 23 `private` fonksiyon ve `private.finance_payment_requests` mevcut;
  mevcut dump kapsamı bunları almıyor.
- 3 Kasım push run `41628371812` saat **14:32 İstanbul** başladı; tanımlı
  saat 07:00. Sonuç `ok=true`, aday 0, gönderim 0, bakım sayaçları 0.
  Backup run `41605191302` **11:41 İstanbul** başladı; tanımlı saat 05:00.
- 28 Ekim–3 Kasım arasındaki yedi schedule push koşusunun başlangıcı tanımlı
  saatten yaklaşık **6 sa. 7 dk.–7 sa. 57 dk.** sonra. Gecikmenin kök nedeni
  bu denetimde belirlenmedi; workflow başarısı zamanında çalışma kanıtı değil.
  [GitHub dokümanı](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
  schedule olaylarının gecikebildiğini, yoğunlukta düşebildiğini açıklıyor.

Saat kanıtları GitHub `event=schedule` run metadata'sından; platform kaynaklı
gecikme olası açıklamadır, bu kayıtlar tek başına nedeni kanıtlamaz.
Canlı SMS hatasının borç eşleme hatasıyla ilişkisi araştırılmadı.

## Denetimde doğrulanan bulgular

| Kimlik / öncelik | Karşı örnek ve etki | Düzeltme / kabul koşulu |
| --- | --- | --- |
| AUTO-01 / P1 | **SMS yanlış kişiye bağlanabiliyor.** Tek açık alacak `A B`, 500 TL. `TAMAMEN FARKLI KISI` göndericisinden 100 TL giriş gerçek RPC'de alacağı 400 TL'ye indirdi. Banka 1000→1100 doğru; kişi borcu değişimi yanlış. Yalnız ≥2 harfli ad parçaları karşılaştırıldığından hiç uygun parça yoksa koşul boş kümede doğru oluyor. | Yeterli kimlik kanıtı yoksa otomatik eşleme yok; açıklanabilir inceleme kaydı. Baş harf, boş/noktalı ad, Türkçe katlama, tek/çok aday, tekrar ve atomiklik SQL regresyonları. Kanıtsız geçmiş düzeltmesi yapılmaz. |
| AUTO-02 / P1 | **Şifreli DB yedeğinde `private` yok.** Workflow'un birebir schema flag'leriyle iki boş sentetik DB testi: dump 0, restore 0, restore edilmiş public fonksiyon çağrısı `schema private does not exist` ile hata. Private işlem makbuzu verisi de dump dışında. | DB felaket kurtarma kapsamına gerekli private kod/veri, bağımlılık ve yetki düzeni dahil; izole restore + gerçek finans işlemi + makbuz tekrar testi. Bu, uygulamanın kullanıcı JSON export'una makbuz eklemek demek değildir. |
| AUTO-03 / P1 | **Tekrarlı ödemenin cari vadesi bildirime girmiyor.** Aylık planın ham `due_date=2026-10-10`; 9 Kasım UI çözümlemesi 10 Kasım, push `payment_due_tomorrow=0`. Edge yalnız ham tarihe filtre koyuyor. | Ortak tekrar/lifecycle sözleşmesi. Başlangıç-bitiş, 28/29/30/31, ay devri, ödenmiş/iptal ve kart/nakit türleri için UI ile aday aynı tarihi üretmeli; geçmiş borç uydurulmamalı. |
| AUTO-04 / P1 | **Günlük hedef kaydı okuma hatasını sıfır sayıyor.** Aynı kasa kaynağı başarıda 500; repo `ok=false` olduğunda kayıt sınırına `{amount:0}` gidiyor. Kaynak çözücü `missing` bilgisini üretiyor ama yazıcı gözetmiyor. | Etkilenen hedef/bileşende eksik veriyle nokta yazma; gerçek sıfır ayrı kalmalı. Kısmi kaynak, karma hedef, fiyat yokluğu, hata sonrası aynı gün tekrar testleri. Bakiye değil, hedef tarihçesi/tempo etkilenir. |
| AUTO-05 / P2 | **1000 log sınırı tekrar gönderime izin veriyor.** 1101 gerçek yerel notification log'unda REST 1000 okudu; dışarıda kalan zaten gönderilmiş adaya tekrar izin verdi. A10 simülasyon, A19 gerçek REST aynı hata. | Aday anahtarına dar sorgu/eksiksiz sayfalama + atomik sahiplenme. 1001+, iki eşzamanlı worker ve sayfa hatası regresyonu; limit artırmak tek başına çözüm değil. |
| AUTO-06 / P2 | **Bir cihaz başarılıysa diğerinin retry fırsatı kayboluyor.** İki endpoint, 201 ve 503: user-level log yazılıyor; yeniden koşuda aday yok. | Kullanıcı + olay + endpoint düzeyinde teslim durumu ve sınırlı backoff. Başarılı endpoint tekrar gönderilmemeli, 404/410 temizlenmeli; kapatma tercihi retry'da da geçerli. |
| AUTO-07 / P2 | **Gönderim sonrası log hatası tekrar teslim yaratabiliyor.** Push kabulünden sonra log yazımı düşüyor; yeniden koşu ikinci kez transport kabulü üretiyor. | Kalıcı outbox + claim/lease + retry/sonuç takibi. Dış push servisi ile DB arasında kesin exactly-once vaat edilmez; sabit olay/tag ve belirsiz sonuç politikası gerekir. Aynı tag mevcut bildirimi değiştirebilir; test iki görünür toast kanıtlamıyor. |
| AUTO-08 / P2 | **Bakım hatası yeşil koşu olabiliyor.** Bakım HTTP 500 + abonelik yok: edge HTTP 200, `ok=true`, içte `maintenance.error`. Curl/Actions yeşil. SQL de bazı satır hatalarını NOTICE ile geçiyor. | Bakım ve teslim alt sonuçları ayrı izlenmeli; kısmi başarı tanımlı olmalı, hata/son başarılı zaman ve hata sayısı görünmeli. Yeniden deneme ledger etkisini çoğaltmamalı. |
| AUTO-09 / P2 | **Kendi hesaplarına transfer maaş sanılabiliyor.** Aynı anda −50.000/+50.000 TL iki hareket, 50.000 TL maaş için `findSalaryDeposit=true`. | Maaş kimliği/işveren kanıtı ve transfer dışlama; yalnız tutardan kesin maaş denmesin. Bugünkü etki maaş/hedef önerisi ve push; otomatik finansal maaş kaydı/rezerv yazımı kanıtlanmadı. |
| AUTO-10 / P2 | **Otomasyon kapsamı kalabalık dönemde yanlış.** Gerçek yerel REST: 600 SMS + 600 manuel yerine son 1000 satır okunuyor; 50% yerine 60%, 600 yerine 400 manuel. | `fetchExpenseSourceRows` eksiksiz sayfalansın veya güvenli sunucu agregasyonu kullanılsın. Hatalı sayfa kısmi başarı olmasın; tarih/eşit-tarih sıralaması kararlı olsun. Bu sınır testi mevcut canlı oranın yanlış olduğunu kanıtlamaz. |
| AUTO-11 / P1 operasyon | **07:00 hatırlatma sözleşmesi sağlanmıyor.** Yedi canlı schedule koşusunda 6–8 saat gecikme. Tek saat, sessiz saat ertelemesi veya kaçan pencere telafisi sunmuyor. | Tek ana zamanlayıcı + kalıcı vade kuyruğu ve telafi penceresi; planlanan/gerçek zaman ayrımı. Yeni düzen açılmadan çakışma testi ve eski schedule'ın kapatılması; kesin saat garantisi verilmez. |

## Hata sayılmayan sınırlar ve ek borçlar

- **Sessiz saat:** 22:00–08:00 aralığı 07:00 adayını eliyor; UI bunu uyarıyor.
  08:00'de otomatik tekrar yok. Gecikmiş gerçek çalışma başka saate rastlayabiliyor;
  teslim anındaki tercih/sessiz saat doğru uygulanmalı. Plan: atmak yerine uygun
  ilk saate ertele, vadesi/önemi geçmiş bildirimi yenileyerek veya iptal ederek ele al.
- **Hedef retry:** net değer başarı damgası hedef yazımından önce konuyor.
  Hedef repo başarısız `Result` döndürse bile çağıran bunu değerlendirmiyor;
  aynı gün kendiliğinden retry yok. Bu kaynak inceleme bulgusudur; hook'un yeni
  başarısız-hedef etkileşim testi henüz eklenmedi. AUTO-04 kabulüne dahil edilmeli.
- **Yedek saklama:** artifact `retention-days:90` olsa da prune en yeni **5 yedeği**
  bırakıyor. Deploy öncesi yedekler de aynı havuzda; 5 adet, 5 gün/90 gün demek değil.
  Günlük/haftalık ve deploy yedeklerinin saklama politikası açıkça belirlenmeli.
- **Kapsam metriği:** PDF/fiş aktarımı da otomatik kaynak sayılıyor. Kullanıcının
  manuel adımını azalttığını anlatabilir; insansız işlem veya tasarruf edilen
  dakika iddiası olmamalı. Banka hareketleri dahil tüm iş akışını ölçmüyor.
- Saatlik taramaya geçmeden 48 saatlik kesim makbuzu, 26 saatlik SMS hata penceresi,
  haftalık özet ve aylık katkı adaylarının olay kimlikleri/son kullanımı tanımlanmalı;
  mevcut tek-gün log anahtarını sıklaştırmak bildirim gürültüsü yaratabilir.

## Yeni otomasyonlar — kullanıcıya kazandırdığı iş sırasıyla

| Sıra | Senaryo / görünüm | Otomasyon sınırı ve kabul |
| --- | --- | --- |
| 1 | **Bugün ne yapmalıyım?** Tek özet: bugün/geciken ödemeler, 7 günlük nakit riski, inceleme bekleyen önemli kayıt; ilgili işlemi açan bağlantı | Kullanıcının seçtiği saat; uygulama içi kalıcı liste ve isteğe bağlı tek push. Ortak yükümlülük/harcanabilir hesabı kullanılır, açık alacak nakit sayılmaz. Eksik kart takvimi/taze olmayan veri kesin tutar iddiasını kapatır. Zaten mevcut haftalık özetle aynı içerik ikinci kez gönderilmez. |
| 2 | **Gerçek vade bekçisi:** açık ekstre son ödeme, kişisel borç vadesi ve gecikme; “bugün / 3 gün kaldı / gecikti” | Kartın gerçek arşiv vadesi + kalan borç, geçmiş açık ekstre, kısmi ödeme, vade çakışması ortak kurala uyar. Ödenince aday iptal; vadesiz borca tarih uydurma. Alacak takibi ayrı dil/tercih; kişiye mesaj gönderme yok. |
| 3 | **İnceleme kutusu:** işlenemeyen SMS, belirsiz kişi/plan eşlemesi, kategorisiz işlem, mutabakat farkı | Var olan SMS hata özeti ve veri sağlığına bağlı tek liste. “Neden bekliyor?” + kanıt + tek kayıt açma/yeniden deneme. Aynı SMS kimliği korunur; kullanıcı onayı olmadan belirsiz borç kapama veya bakiye düzeltmesi yok. |
| 4 | **Abonelik değişikliği:** alışılmış tutara göre zam/yenileme, uzun süredir kullanılmayan plan incelemesi | Mevcut keşif + değişken fatura eşlemesi üzerine. Geçmiş yeterliliği, aynı sağlayıcı ve tek aday şartı; taksit/tek alışveriş ayrımı. Plan oluşturma/iptal öneridir; gerçekleşmeyen ödemeyi ödenmiş saymaz. |
| 5 | **Mutabakat ve veri tazeliği:** uzun süredir doğrulanmayan hesap/kartı önemli işlemden önce hatırlat | Mevcut haftalık mutabakat uyarısını risk/etkiyle sırala. Her sayfa açılışında tekrar uyarı yok; çözülen konu kapanır. Gerçek tutar kaynağı olmadan otomatik düzeltme yok. |
| 6 | **Uygulama kapalıyken günlük tarihçe** | Önce AUTO-04 ve ayrı retry çözülür. Sunucuda ortak değerleme kodu, fiyat kaynağı/zamanı ve kullanıcıya ait tam veri doğrulanır. Tarihsel kur yoksa bugünkü fiyatı geçmiş güne yazma; boş gün gerçek sıfır değildir. Tasarım ve maliyet doğrulamasından sonra devreye girer. |
| 7 | **Maaş sonrası hedef payı / ay sonu bütçe devri** | Mevcut katkı hatırlatıcısı/bütçe köprüsüne teklif eklenir. AUTO-09 çözülmeden tutardan maaş varsayıp otomatik rezerv yazılmaz. Önizleme ve onay, idempotent işlem kimliği; önceki onay/düzeltme izi görünür. |

## Uygulama sırası ve kullanıcı deneyimi

1. **Güvenilirlik paketi:** AUTO-01/02/04; ardından tekrar vadesi, tam okuma,
   teslim/retry ve bakım sağlık durumu. Yedek için yalnız dosya varlığı değil
   izole geri yüklemeden sonra finans işlemi kanıtı şart.
2. **Hatırlatma altyapısı:** eldeki DB zamanlayıcısı aday; ağ çağrı yetenekleri,
   extension/secret düzeni ve çalışma maliyeti uygulamadan önce doğrulanır.
   Kaynağa ait olay + hedef zaman + son kullanma + durum kalıcı tutulur.
   Worker kilidi/lease ve kullanıcı filtresiyle tek sahiplenir; kullanıcı tercihi
   teslim anında tekrar okunur. GitHub günlük koşu yedek kontrol olabilir,
   tek saatlik bildirim otoritesi olmamalı. Kesin teslim zamanı/okunma vaat edilmez.
3. **Günlük yapılacaklar + gerçek vade:** aynı olay deposundan uygulama içi liste
   ve push üret; tutarı ikinci bir SQL formülüyle yeniden icat etme. Önce yalnız
   kendimize ait sentetik kullanıcılarda, sonra kullanıcı tercihiyle etkinleştir.
4. **İnceleme kutusu + keşif genişletmeleri:** öneriyi, doğrulanmış olayı ve
   otomatik finansal yazmayı açık ayır. Yeni para yazımı ancak ayrı kabul
   testleri ve kullanıcının ürün kararıyla eklenir.

İşlemler ekranında her otomasyon için son **başarılı** çalışma, planlanan/gerçek
saat, kaynak, ne yaptığı ve bekleyen/başarısız sonuç gösterilmeli. “Çalıştı” ile
“bir değişiklik yaptı”, “push kabul edildi” ile “okundu” karışmamalı. Kullanıcı
önce önemli eylemi görmeli; teknik log ayrıntısı isteğe bağlı açılmalı.
Günlük özet için saat ve tür seçimi, tek başına “tümünü aç” ayarından daha yararlı.

Başarı ölçüleri: kaçan vade uyarısı, aynı olayın tekrar teslimi, hata sonrası
telafi süresi, inceleme kuyruğunda bekleyen işlem ve görev başına manuel adım.
Zaman tasarrufu ancak aynı görevin önce/sonra ölçümüyle raporlanır.

## Senaryo kanıtı ve doğrulama

| Test | Sonuç / kapsam |
| --- | --- |
| A01–A15 | Gerçek push/domain kaynakları bundle edilerek; yalnız repo/transport sınırları sentetik. A01/10/11/12/13/14 bulgu; A02–09 diğer kontroller geçti; A15 metrik tanımı gözlemi. A05 mevcut sessiz-saat davranışını doğrular, telafi bulunduğunu söylemez. |
| A16 | Birebir workflow dump flag'leri, iki sentetik scratch PostgreSQL DB. Dump/restore başarılı, private bağımlı çağrı başarısız; iki DB sonunda silindi. Tam üretim restore provası değildir. |
| A17 | Gerçek yerel `record_sms_account_movement`; sentetik kişi/hesap; yanlış alacak düşüşü gözlendi; `ROLLBACK`. |
| A18/A19 | İzole yerel gerçek Auth + PostgREST: 1200 harcama, 1101 bildirim log'u; sonrasında kullanıcının finans verisi ve Auth hesabı temizlendi. |
| A20 | Gerçek günlük hedef kayıt/çözümleme kodu, repo sınırı stub; başarılı kasa okumasında 500, hatada 0 yazma girişimi. Gerçek üretim tarihçesine yazılmadı. |
| Mevcut hedefli testler | 9 Vitest dosyası / 105 test geçti; push tercih, SMS parser, abonelik, maaş, günlük snapshot ve repo kontrolleri. Yeni karşı örnekler mevcut suite'in henüz kapsamadığı davranışlar. |
| Genel kapı | `npm run verify`: 176 dosya / 1848 test, 7 guard, lint/coverage, prod audit 0 açık, build, bundle 1010.8/1030 kB, 6 edge tip kontrolü başarılı. |
| Gerçek DB kapısı | `npm run db:test:all`: 53/53 geçti. Bu çalışma migration değiştirmedi; hazır yerel DB sıfırlanmadı. |

Bu denetimde yeni tarayıcı kullanılabilirlik testi veya üretimde bildirim
gönderim/finans yazma testi yapılmadı. UX önerileri görev senaryolarına dayanır;
gerçek kullanıcı araştırması sonucu değildir. Mevcut testlerin yeşil olması
yukarıdaki açık karşı örneklerin düzeldiği anlamına gelmez.

Yerel ayrıntılı kanıt klasörü:
`C:/Users/Enes/.codex/visualizations/2026/11/02/01a19e7e-ba01-70e1-b7ab-878ab10344d1/automation-audit/`.
İçerik: `scenarios.cjs` + sonuç JSON, `backup-restore.cjs` + sonuç JSON,
`sms-short-name.sql` + rollback log'u, `volume-real.cjs` + sonuç JSON,
`goal-snapshot.cjs` + sonuç JSON, `scheduled-runs.json`,
`production-aggregates.txt`, `existing-tests.log`, `verify.log`, `db-tests.log`.
Sentetik test verisi ve toplulaştırılmış operasyon kayıtlarıdır; üretim dump'ı,
SMS içeriği, push endpoint'i veya service-role anahtarı içermez.
