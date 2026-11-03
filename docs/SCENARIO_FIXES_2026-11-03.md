# Kişisel kullanım denetimi — düzeltme kaydı

Başlangıç: `eacd115` üzerindeki 3 Kasım senaryo raporu. Bu kayıt önceki
denetimin ölçümlerini yeni sürümün sonucu saymaz; düzeltmelerin kendi kalıcı
regresyonlarını ve kapsam sınırlarını tutar. Kullanıcı eski açık/vadesiz
yükümlülüklerin düşülmesini ve altının kalan maliyet havuzuna geçmesini onayladı.

## Bulgular

| Bulgu | Son davranış | Kalıcı kanıt |
| --- | --- | --- |
| F001 / F002 | Planlı taksit nakit çıkışı gerçek kesim/vadede bir kez; döngü forecast'a tekrar eklemez. 100.000 nakit / 3.000 taksit sonunda 97.000 olur. | `src/utils/cashFlowForecast.test.ts`, `src/utils/cardPaymentCycle.test.ts` |
| F003 | Talimatın başlangıç, bitiş ve bekliyor durumu gerçek kesim döneminde kontrol edilir. | `src/utils/statementProjection.test.ts` |
| F004 | Kesim 25 / vade 5, 28 Kasım taksiti 25 Aralık kesimi / 5 Ocak ödemesidir. Kısa tahmin de aynı eşlemeyi kullanır. | `src/utils/statementProjection.test.ts`, `src/utils/statementEstimate.ts` |
| F005 | Eksik takvimde ana tutar/günlük öneri yerini açıklama ve kart bağlantısına bırakır. Karar/liste/plan/rapor/asistan aynı kapsamı gözetir; hızlı kontrol uyarır. | `tests/e2e/simplification.spec.ts`, `src/utils/dataHealthSummary.test.ts`, rapor/asistan testleri |
| F007 | Banka/nakit hesap geçmişinde 8'li sayfalar, en eski/en yeni erişimi, odak ve sayfadan bağımsız toplam. | `src/components/finance/LedgerPanels.test.tsx`, 1.206 kayıtla 320/390/1280px tarayıcı senaryoları |
| F008 | İşaretli binlik ve Unicode eksi korunur; −1.234 artık −1234'tür. | `src/utils/formatCurrency.test.ts` |
| F009 | Bütün açık ekstreler + son 120 ödenmiş arşiv. Eski açık ekstrenin özgün vadesi kaybolmaz. REST açık arşiv/taksit/ödeme kanıtlarını sayfalar. | `supabase/tests/snapshot_open_statement_scope.sql`, `supabase/tests/finance_snapshot_rpc.sql`, repository testleri |
| F010 | Kart ve hesap hareket notları bütün türlerde görünür; gizlilikte metin içi para maskelenir. | Ledger panel testleri; debit notlu 1.005 kart hareketiyle mobil/masaüstü E2E |
| F011 | Gelecek kısmi ödemelerde miktar hassasiyeti korunur; TL kalan aynı sabit kurda değişmez. Eski kaybolmuş hassasiyet tahminle geri yazılmaz. | `supabase/tests/debt_quantity_precision.sql`: dört birim × iki yön, tekrarlı kısmi + tam ödeme, bakiye/geçmiş koruması |
| F012 | Hedef kaynakları varlık kimliklerinin birleşimini toplar; kategori+tekil varlık aynı değeri iki saymaz. | `src/utils/goalSources.test.ts`, sıra/tekrar testleri |

## Onaylanan ürün kararları

Eski açık ödeme, gerçek kredi taksiti, kalan açık ekstre ve kişisel borçlar ile
vadesiz kişisel borçlar cari ayın kalan nakit çıkışına girer. Kapananlar/alacaklar
katılmaz; kayıtlı olmayan geçmiş aylık tekrarlar uydurulmaz. Forecast ilk ayda
bu yükü bir kez taşır. Kart döngüsü senaryosu aynı vadesiz borcu rezervde tekrar
düşmez. Kanıt: `cashFlowForecast.test.ts`, `CardPaymentCyclePanel.test.tsx`, E2E.

Altın: 10 × 1.000 alış → 9 satış → 9 × 2.000 alış sonunda 10 birimin kalan
maliyeti 19.000 TL'dir. Özet ve grafik aynı havuz kuralını kullanır; sırasız
girdi, fiyatsız satış, tam satış sonrası yeni alış ve bilinmeyen maliyet sınanır.

## Migration ve yayın sınırı

- `supabase/migrations/20261103090000_debt_quantity_precision.sql` mevcut 12
  tamsayı hanesini koruyarak miktarı `numeric(38,26)` yapar; kısmi kapamanın
  dört haneli ara yuvarlamasını kaldırır. Eski satırlar tahminle düzeltilmez.
- `supabase/migrations/20261103091000_snapshot_open_statements.sql` snapshot
  geçmiş sınırını yalnız ödenmiş arşive uygular; security invoker/RLS korunur.
- Yerel doğrulama aşamasında `npm run db:seed:local` bütün migration zinciriyle
  sıfırdan kuruldu; bu aşamada üretime migration, finansal yazma veya push yapılmadı.
- Kullanıcı 3 Kasım'da canlı yayını istedi. Yayın korumalı `main` için PR → CI →
  merge → yedek/DB kontrolleri → migration → staged production promote/smoke
  hattından yürütülür. CI/deploy sonuçları ilgili GitHub Actions koşusundadır.

## Doğrulama

`npm run verify` geçti: **174 dosyada 1.838 test**, **7 guard**, lint,
coverage, production dependency audit (**0 açık**), build ve altı edge tip kontrolü.
Coverage: %93,22 statement / %85,76 branch / %94,48 function / %95,26 line.
JS gzip toplamı 1.007,1 kB / 1.030 kB bütçesidir.

`npm run test:e2e`: **30 geçti, 4 live-backend testi atlandı**; gerçek üretim
uçlarına bağlanılmadı. 19 ekranın 320/390/1280px taraması, eksik kart takvimi,
gecikmiş/vadesiz yük, 1.206 hesap / 1.005 debit kart hareketi, odak/sayfalama,
not görünürlüğü ve gizlilik dahil. 320px hesap listesi ve 390px kart geçmişi
ekran görüntüleri de görsel olarak incelendi.

Yerel gerçek Postgres: `npm run db:test:all` **52/52** geçti; snapshot/RLS/grant,
kısmi ödeme, ledger, restore, SMS ve diğer mevcut SQL regresyonları dahil.

## Açık kalan gözlemler

- F006 eksik taksit şemasında Özet kapsam uyarısı: önceki denetim yanlış cari
  harcanabilir tutarı kanıtlamadı. Eksik taksitli tüm-kart tahmini ve alınacaklar
  değerlendirmesi mevcut korumasını sürdürür. Ayrı kapsam görünürlüğü işi.
- Çevrimdışı son okuma etiketi ve soğuk PWA açılışı bu paketin düzeltmesi değildir.
- Sunucu commit edip yanıt kaybolduktan sonra kısmi ödeme tekrarının uçtan uca
  idempotency senaryosu henüz doğrulanmadı; yeni garanti verilmez.
- Daha önce yuvarlanmış altın/döviz miktarı geçmiş işlem/banka kanıtıyla
  mutabakat gerektirir. Migration kayıp tarihsel hassasiyeti geri üretemez.
- Gerçek banka/SMS/PDF, canlı piyasa, üretim push ve çok cihazlı yarışlar yeni
  uçtan uca test kapsamına alınmadı. Sentetik E2E dış ağı kapatır; SQL yereldir.
