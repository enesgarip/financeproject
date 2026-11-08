# Uygulama ve UI mantık denetimi — 8 Kasım 2026

9 Kasım uygulama/kabul kaydı: `docs/AUDIT_REMEDIATION_2026-11-09.md`.
M01–M23, V01–V07, F01–F05 ve T01 uygulandı. Aşağıdaki tarama durumu
bulguların tespit anını korur; güncel kanıt ve yayın kapıları düzeltme
belgesindedir. U01 gerçek telefon belirtisi birebir doğrulanmadı, açık kalır.


**İkinci tarama eklendi:** `docs/LOGIC_UI_AUDIT_SECOND_PASS_2026-11-08.md`.
Bu dosya ilk turun 11 maddesini korur; iki tur toplamı M01–M23 + T01'dir.
Birleşik çözüm sırası ve yeni kanıtlar ikinci rapordadır. Henüz düzeltme yok.

Durum: **araştırma tamamlandı; düzeltmeler uygulanmadı**. İncelenen başlangıç
commit'i `a96910f`. Üretime yazılmadı, migration değiştirilmedi, commit/push yapılmadı.
Bu rapor uygulamanın hatasız olduğu iddiası değildir; aşağıda kanıtlanan kapsamı
ve henüz sınanmayan koşulları birbirinden ayırır.

## Sonuç ve öncelik

**11 ürün bulgusu ve 1 test bakım bulgusu** var. Beşi P1, altısı P2 ürün
bulgusudur; test bakım bulgusu ayrıca P2'dir. P0 düzeyinde bir açık doğrulanmadı.
P1 burada çift finans kaydı, yanlış karar önerisi veya mevcut finans planının
yanlışlıkla yeniden kurulmasına yol açabilen durumu ifade eder.

| Kimlik | Öncelik | Sorun | Kanıt |
| --- | --- | --- | --- |
| M01 | P1 | Kredi sonrası plan hatasında tekrar Kaydet ikinci kredi yaratıyor | Tarayıcı, kontrollü POST hatası |
| M02 | P1 | Kayıp yanıttan sonra aynı rezerv ayırma tekrar uygulanıyor | Tarayıcı + gerçek PostgreSQL |
| M03 | P1 | Rezerv veya taksit kapsamı bilinmezken olumlu alım kararı çıkıyor | Tarayıcı, iki ayrı hata senaryosu |
| M04 | P1 | Alım kararının gelecek ayları kasa rezervini korumuyor | Saf hesap senaryosu + tüketici incelemesi |
| M05 | P2 | Karar/liste/analiz hedefi eksik kaynaklarla çözüyor | Tarayıcı + kaynak incelemesi |
| M06 | P2 | Tutar gizleme karar metinlerine uygulanmıyor | Tarayıcı + görüntü |
| M07 | P1 | Kredi taksit sorgusu hatası “Ödeme planı yok” oluyor | Tarayıcı, kontrollü GET hatası |
| M08 | P2 | Kategori limitinden sonra bütçe listesi eski cache'i kullanıyor | Tarayıcı + görüntü + istek sayısı |
| M09 | P2 | Eksik tablo ay kapanışında erişim başarılı gösteriliyor | Tarayıcı |
| M10 | P2 | Bazı tam-geçmiş okumaları API'nin 1000 satır sınırında kesiliyor | Kaynak + yerel API yapılandırması |
| M11 | P2 | TL toleransı gram hedefinin eksik miktarını tamamlanmış sayıyor | Geçerli şema hassasiyetiyle saf hesap |
| T01 | P2 | Varsayılan koşuda atlanan canlı kova testi eski alan adında takılıyor | Yerel gerçek backend, zaman aşımı |

## İnceleme yöntemi ve sınırlar

Kanonik giriş `CLAUDE.md` ve `docs/AI_CONTEXT_INDEX.md`; iş kuralı dayanakları
`docs/FINANCE_RULES.md`, `docs/KNOWN_RISKS.md` ve
`docs/LINKED_FINANCE_WORKFLOWS.md` idi. Önceki senaryo/otomasyon/UI denetimleriyle
kapatılmış konular yeniden açık bulgu olarak kopyalanmadı.

İnceleme; ortak finans snapshot'ı, nakit akışı/alım kararları, hedef ve rezerv
hesapları, kredi planı yazımları, bağlı gelir/bakım akışları, sorgu hataları,
cache yenilemesi, gizlilik ve ay kapanışı üzerinde derinleştirildi. Standart
tarayıcı paketi 19 ekranı 320/390/1280 px genişliklerde dolaşıyor. Yeni hata
enjeksiyonu senaryoları masaüstü Chromium'da çalıştırıldı; bunların tümüne
ayrıca mobil cihaz doğrulaması yapıldığı iddia edilmez.

Sentetik tarayıcı testlerinde dış istekler karşılandı veya engellendi. SQL
regresyonları yalnız `supabase_db_financeproject` üzerinde çalıştı. Rezerv
kanıtı `BEGIN/ROLLBACK` ile izole edildi. Mevcut canlı UI testlerinin oluşturduğu
iki demo kayıt, yalnız bu koşuya ait tam adlarıyla yerel DB'den temizlendi.
DB reset edilmedi; başka yerel veriler topluca silinmedi.

### Mevcut kapılar

| Kontrol | Sonuç | Ne kanıtlar / sınır |
| --- | --- | --- |
| `npm run verify` | Geçti | Lint, 189 dosya / 1930 test, coverage, production audit, build, bundle, 6 edge tip kontrolü |
| Coverage | Satır %95,33; branch %86,16 | Kapsam esas olarak saf util katmanıdır; bütün UI hata akışlarının kapsamı değildir |
| Production dependency audit | 0 açık | İş mantığı doğruluğunu kanıtlamaz |
| Bundle | 1038,7 / 1060 kB gzip | Başlangıç uygulaması bütçe içinde |
| `npm exec -- playwright test` | 55 geçti, 4 atlandı | Sentetik akışlar ve responsive tarama dahil |
| `npm run db:test:all` | 59/59 geçti | Mevcut gerçek SQL regresyonları |
| Canlı `goal-sources` + `money-mutation` | 2 geçti, 1 başarısız | Hedef kaynağı ve kart harcaması/ledger geçti; kova testi T01'deki eski seçicide kaldı |
| Bu denetimin özel tarayıcı gözlemleri | 9/9 geçti | Testler mevcut hatalı davranışın yeniden üretildiğini doğrular; düzeltme testi değildir |
| Bu denetimin saf hesap gözlemleri | 2/2 geçti | M04 ve M11'in mevcut çıktısını doğrular |

Kanıt kaynakları `docs/audit-evidence/2026-11-08/` altındadır. Geçici testler
otomatik test paketinden çıkarılıp `.txt` olarak arşivlendi; hatalı davranış
beklentileri kalıcı regresyon testine dönüştürülmedi. Düzeltmede beklentiler
doğru davranışı doğrulayacak şekilde yazılmalıdır.

## M01 — Kredi sonrası hata ikinci kredi yaratabiliyor

Kaynak: `src/components/CrudPage.tsx:363`, `src/components/CrudPage.tsx:371`,
`src/pages/LoansPage.tsx:398`, `src/pages/LoansPage.helpers.ts:239`.

**Senaryo:** Yeni krediyi doldur → Kaydet. `loans` INSERT başarılı olur;
`loan_installments` POST isteği 500 döner. Form açık ve tekrar gönderilebilir
kalır. Tekrar Kaydet ikinci `loans` INSERT'ini gönderir. Tarayıcıda aynı
formdan iki farklı kredi kimliği üretildi.

**Neden:** `afterSave` hatasında CRUD akışı yalnız hata yazıp döner. Başarılı
oluşturmanın kimliğini `editing` durumuna almıyor ve oluşturma niyetini
sonlandırmıyor. İlk kayıt DB'de dururken form hâlâ yeni kayıt formudur.

**Etki:** Aynı borcun iki kredi olarak sayılması; net değer ve gelecek ödeme
yükünün şişmesi. İlk kredi de plansız kalabilir. Bu, ledger trigger'ının
bozulması değil, iki ayrı geçerli kaydın yanlış kullanıcı akışıyla üretilmesidir.

**Çözüm:** Başarılı ana kayıt ile başarısız sonraki işi ayrı durumlar olarak
koru. Ana kayıt kimliğini saklayıp tekrar INSERT'i engelle; “Kredi kaydedildi,
plan kurulamadı” ve mevcut kredi üzerinde planı tamamlama eylemi sun. Kredi ve
ilk planın atomik RPC'ye taşınması ayrıca değerlendirilebilir; genel bir
refaktörü bu hatanın önkoşulu yapma.

**Kabul:** INSERT başarılı/plan başarısızken sonraki tıklama yeni kredi
oluşturmamalı. Mevcut paid taksitler korunmalı. Aynı hata, diğer `afterSave`
tüketicilerinde de parametrik kontrol edilmeli.

## M02 — Rezerv ayırma belirsiz yanıtta iki kez uygulanıyor

Kaynak: `src/pages/PurchaseDecisionPage.tsx:193`,
`src/data/repositories/kasaBucketsRepo.ts`,
`supabase/migrations/20260825190000_today_ist_single_source.sql:205`.

**Senaryo:** Kovada 9.000 TL var. Vazgeçtim ile 2.000 TL ayır. Sunucu uygulasın,
yanıt bağlantıda kaybolsun. Hata sonrası aynı düğmeye yeniden bas.
Tarayıcı gözleminde iki RPC çağrısı ile rezerv 13.000 TL oldu; tek niyetin
sonucu 11.000 TL olmalıydı. Gerçek PostgreSQL'de aynı RPC'nin aynı alanlarla
iki çağrısı sırasıyla 11.000 ve 13.000 döndürdü; transaction geri alındı.

**Neden:** RPC artış yapıyor ve istek kimliği kabul etmiyor. İstemci hata
sonrasında durumu tekrar `idle` yapıyor. Başarının kaybolduğu durumda güvenli
tekrar ile yeni ayırma ayırt edilemiyor. Diğer tüketicilerdeki onay diyaloğu
da kayıp yanıtı tekilleştirmez.

**Etki:** Banka bakiyesi/ledger değişmez; rezerv ve harcanabilir tutar yanlış
değişir. Kova hedef kaynağıysa hedef ilerlemesi de yanlış artar.

**Çözüm:** Kullanıcı + UUID + canonical payload makbuzuyla idempotent ayırma;
belirsiz istemci niyetini kalıcı saklama ve aynı istekle sonucu doğrulama.
Mevcut ödeme/bakım desenini örnek al. Gerçek ikinci ayırma yeni niyet olmalı.
Tüketiciler: karar ekranı, hedef paneli, bütçe artığını ayırma.

**Kabul:** Commit sonrası yanıt kaybı, sayfa yenileme ve iki sekme tekrarında
tek artış; aynı UUID/farklı gövde reddi; reset/restore sözleşmesi açık olmalı.

## M03 — Veri doğrulanmadan olumlu satın alma kararı

Kaynak: `src/pages/PurchaseDecisionPage.tsx:98`, `:100`, `:135`, `:488`.
Karşılaştırma: `src/pages/WishlistPage.tsx:68`.

İki koşul **ayrı ayrı** tarayıcıda doğrulandı:

1. Kasa sorgusu 500 dönerken 500 TL için “Plana göre uygun” çıkıyor. Sayfanın
   aşağısındaki rezerv uyarısı olumlu kararı ve harcanabilir rakamı kapatmıyor.
2. Snapshot `missing_tables=['card_installments']` bildirirken aynı olumlu
   karar gösteriliyor; eksik taksit kapsamına ilişkin karar engeli yok.

**Neden:** `reservedKnown` hesap kapısı değil, yalnız alt açıklama.
`missingTables` alım kararında kontrol edilmiyor. Aynı ürünün liste önizlemesi
bu iki durumda hesap üretmeyi zaten durduruyor.

**Çözüm:** Alım kararının gerekli veri koşullarını listeyle hizala. Rezerv,
taksit, ekstre ve kısmi ödeme kapsamı doğrulanmadan olumlu/olumsuz kesin
karar veya doğrulanmış harcanabilir rakam sunma. Hangi veri bekleniyor ve
nasıl yeniden denenir açıkça gösterilsin. Son başarılı veri varsa son okuma
ile güncel doğrulama durumunu ayrı tut.

**Kabul:** İlk yükleme, kalıcı hata, eksik capability ve hatalı refetch için
ayrı test; liste içindeki ortak karar formu da aynı davranmalı.

## M04 — Gelecek ay değerlendirmesi ayrılmış parayı harcanabilir sayıyor

Kaynak: `src/pages/PurchaseDecisionPage.tsx:137`,
`src/utils/purchaseImpact.ts:121`. Karşılaştırma:
`src/pages/WishlistPage.tsx:99`, `src/utils/wishlistPlan.ts:91`.

**Geçerli örnek:** Likit 10.000, tampon tercihi 1.000, rezerv 8.000 TL;
gelir ve mevcut yükümlülük yok. Bugünkü harcanabilir 1.000 TL. 2.000 TL'lik
kart alımı dört taksitte 500 TL olsun. Mevcut kodun aylık bakiyeleri
10.000 → 9.500 → 9.000 → 8.500 → 8.000 TL; karar `rahat`.
Son iki ödeme tampon + rezerv tabanı olan 9.000 TL'yi ihlal ediyor.

**Neden:** Bugünkü `safeToSpend` rezervi düşüyor, gelecek ayların alt sınırına
ise yalnız tampon gönderiliyor. Taksit 500 <= bugünkü harcanabilir 1.000
olduğu için ek aylık taksit uyarısı da bunu yakalamıyor.

**Çözüm:** Gelecek ay alt sınırını tampon + rezerv ile kur. Bugünkü
harcanabilir hesabında rezervi ikinci kez düşme. Mevcut aylık modelin ilk kart
ödemesini gelecek aya koyma kararı bu düzeltmenin konusu değildir.

**Kabul:** Aynı girdilerde en az dikkat sonucu; rezervsiz normal senaryo ve
nakit/kart ayrımı korunmalı. Liste/ortak karar aynı taban anlamını kullanmalı.

## M05 — Hedefler eksik referanslarla çözülüyor

Kaynak: `src/pages/PurchaseDecisionPage.tsx:151`,
`src/pages/WishlistPage.tsx:101`, `src/pages/AnalysisPage.data.ts:64`.
Doğru ve daha eksiksiz referans örneği:
`src/components/finance/SavingsGoalsPanel.tsx:263`.

**Tarayıcı örneği:** Hedef 10.000 TL, tek takip kaynağı 9.000 TL rezervli
kova; saklı `current_amount=0` sözleşmeye uygun. 2.000 TL alımdan vazgeçme
önizlemesi kalan 1.000 TL'yi karşılayacağını söylemesi gerekirken kalan
10.000 TL gibi değerlendirilip genel “eklenir” metnine düşüyor.

**Neden:** Karar ekranı kova listesini ayrıca okuyor fakat hedef resolver'ına
vermiyor; `.goals` seçilerek missing/stale çözüm durumları da atılıyor.
Liste ve analiz de kova referanslarını geçmiyor. Kur/gider çıpalı hedeflerin
gerekli yan girdileri de tüketiciye göre farklı.

**Çözüm:** Mevcut resolver'a gerekli referansları geçir; `goalResolutions` ve
`targetResolutions` güven durumunu tüket. Kaynağı bilinmeyen hedef için
tamamlanma/aylık pay/varış iddiasını durdur. Kaynak yokluğunu gerçek sıfırla
birleştirme. Yeni finans formülü veya DB'de türetilmiş kopya ekleme.

**Kabul:** Aynı hedef plan, karar, liste ve analizde aynı biriken/kalan
değerini üretmeli; kova güncellenince önizleme de yeniden hesaplanmalı.

## M06 — Gizlilik açıkken cümlelerde tutar görünüyor

Kaynak: `src/pages/PurchaseDecisionPage.tsx:394`, `:509`, `:513`.
Ortak çözüm zaten `src/hooks/useBalancePrivacy.tsx` içindeki `maskText` ve
`formatAmount`.

**Senaryo:** Tutarları gizle; 99.000 TL, üç taksit. Rakam kutuları maskeli
olduğu halde gerekçeler “Aylık 33.000,00 ₺” ve “3 ay boyunca aylık
33.000,00 ₺” yazıyor. Görüntüyle doğrulandı. Vazgeçme önizlemesi ve başarı
metni de doğrudan `formatCurrency` kullanıyor.

**Çözüm:** Gerekçeleri `maskText`'ten, görüntü tutarlarını `formatAmount`'tan
geçir. DB'ye yazılan otomatik ürün adının gerçek tutar taşıması ayrı veri
sözleşmesidir; görüntü maskelemesi saklanan veriyi değiştirmemeli.

**Kabul:** Gizlilik açıkken statik/dinamik tüm karar ve başarı metinlerinde
hesaptan türeyen TL tutarı görünmemeli. Kullanıcının düzenlediği giriş alanı
içeriğinin gösterilip gösterilmeyeceği ayrı ürün kararıdır.

## M07 — Kredi taksit sorgusu hatası boş plan gibi davranıyor

Kaynak: `src/pages/LoansPage.tsx:63`, `:200`, `:405`.

**Senaryo:** Krediler sorgusu başarılı, taksit GET isteği 500. UI
“Ödeme planı yok” ve “Plan oluştur” gösteriyor; taksit yükleme hatası yok.
Tarayıcıda doğrulandı.

**Neden:** `setInstallments(result.ok ? result.data : [])` gerçek boş plan ile
okunamayan planı aynı değere çeviriyor. `afterSave` içindeki `hasPlan` de bu
boş diziye dayanıyor. Hata sırasında kredi düzenlenirse var olan planın yok
olduğu varsayılıp şablon senkronu çalışabiliyor; bu senkron pending satırların
elle düzenlenmiş tutar/tarihlerini yeniden yazabilir. Bu sonraki yazma etkisi
kaynak incelemesidir; hata tarayıcı probunda Plan oluştur'a basılmadı.

**Çözüm:** Taksitler için loading/error/success durumları; hata durumunda
tekrar dene ve plan değiştirme eylemlerini kapatma. Eski başarılı veriyi
hatada boşaltma. Plan varlığına göre yazma kararı doğrulanmış sunucu verisine
dayanmalı; paid geçmişin mevcut korunması sürmeli.

**Kabul:** Başarısız GET sonrası yanlış boş durum/Plan oluştur olmamalı;
pending satırları özelleştirilmiş kredi düzenlemesi hatada yeniden kurulmamalı.

## M08 — Kategori limitinden sonra eski bütçe cache'i

Kaynak: `src/components/finance/CategoryBudgetControl.tsx:29`,
`src/app/useFinanceSnapshot.ts:23`, `src/app/useCrudRows.ts:14`.

**Senaryo:** Bütçe sayfasını aç; Market limiti 1.000. SPA içinde Analiz'e git,
takvim ayındaki kategori limitini 2.000 yap; bütçeye dön. Üst kahraman toplam
2.000 TL, kategori satırı hâlâ 1.000 TL. Görüntüde iki rakam aynı anda var.
Bütçe GET sayısı 1 kaldı; saat sabit, 30 saniyelik stale süresi geçmedi.

**Neden:** Snapshot yenileniyor fakat ortak CRUD invalidation tablosunda
`budgets` yok. Kategori eylemi `useInvalidateCrudRows('budgets')` çağırmıyor.

**Çözüm:** Bütçe yazımı tüm bütçe tüketicilerini yenilemeli; mevcut prefix
anahtarlarıyla dar invalidation yeterli. Diğer bağımsız cache'leri gerekçesiz
temizleme.

**Kabul:** Sayfayı yenilemeden ve stale süresini beklemeden üst toplam,
kategori satırı ve düzenleme formu 2.000 TL olmalı.

## M09 — Ay kapanışında eksik tabloya rağmen yeşil erişim

Kaynak: `src/pages/AnalysisPage.data.ts:29`, `:73`,
`src/pages/AnalysisPage.panels.tsx:388`.

**Senaryo:** Snapshot `missing_tables=['card_statement_payments']` bildiriyor.
Ay kapanışındaki Veri erişimi “Veri tablolarına erişilebiliyor” diyor.
Tarayıcıda doğrulandı.

**Neden:** Analiz, eksik tablo listesini yalnız taksit ve ekstre arşivinin
bulunduğu eski etiket sözlüğüne süzüyor. Ay kapanışı bu süzülmüş listeyi
uygulamanın bütün veri erişimi gibi adlandırıyor.

**Çözüm:** Ham kapsam bilgisini koru; sunum etiketlerini ayrı türet.
Kontrol gerçekten yalnız iki tabloyu denetleyecekse ad ve kapsam açık olmalı;
finans kararları için gerekli tabloların kaybı genel başarıya dönüşmemeli.

**Kabul:** Kısmi ödeme/hedef kaynağı/bütçe gibi her eksik tablo için doğru
kapsam uyarısı; tüm tablolar mevcut olduğunda normal yeşil durum.

## M10 — Tam geçmiş okumalarında örtük 1000 kayıt kesintisi

Kaynak: `supabase/config.toml:18` (`max_rows=1000`),
`src/data/repositories/financeSnapshotRepo.ts:168`,
`src/data/repositories/analysisRepo.ts:93`, `:107`, `:124`,
`src/data/repositories/crudRepo.ts:6`, `src/data/repositories/loansRepo.ts:5`.

**Doğrulanan yapı:** Snapshot RPC fallback'inde işlem/harcama geçmişi tek
SELECT; sayfalama yok. Net değer serisi `.limit(1500)`, hedef serisi
`.limit(2000)` istiyor; API yapılandırması yine en çok 1000 satır verebiliyor.
Genel CRUD ve kredi taksit tam okumaları da sayfalanmıyor. Buna karşılık
kategori geçmişi ve ledger panelleri zaten sayfalı desene sahip.

**Etki:** Fallback ortamında yoğun geçmiş sessizce eksik kalabilir; “1500/
2000 satır okurum” sınırı fiilen uygulanmaz. Tarihçe/trend/bütçe ve taksit
listelerinin kapsamı daralabilir. **Birincil snapshot RPC'sinin bu API satır
sınırına takıldığı iddia edilmiyor**; JSON agregasyonu ayrı yoldur.

**İlk tur kanıt sınırı:** Kod + yapılandırma incelemesiydi. İkinci turda
yerel gerçek API'de 1001 geçici sıfır-değerli fixture ile doğrulandı:
exact count 1001, limit isteği 1500, dönen kayıt 1000. Fixture'ların tamamı
temizlendi; ayrıntı ve script ikinci raporun kanıt arşivindedir.

**Çözüm:** Tam okunması gereken sorgulara mevcut immutable-PK sayfalama
desenini uygula; bilinçli özetleri sınırlı tut ve adlandır. Sorgu başarısını
tam kapsamla karıştırma. Sayfa hatası kısmi başarı dönmemeli.

**Kabul:** 1001 ve 1501 kayıtlı fixture, eşit tarihli kayıtlar, sayfa hatası,
RPC/fallback kapsam eşitliği; yüksek limit yazmak çözüm sayılmamalı.

## M11 — Gram hedefine TL toleransı uygulanıyor

Kaynak: `src/utils/savingsGoal.ts:51`, `src/utils/savingsSuggestion.ts:43`,
`src/utils/goalSources.ts:247`.

**Geçerli örnek:** Hedef 1,23 gram; mevcut 1,22 gram. Her iki değer DB'nin
iki ondalık hassasiyetine uygun. `savingsGoalTargetReached` true,
`buildSavingsSuggestion` ise `pace='reached', remaining=0` döndürüyor.
Oransal ilerleme %99,19 olduğundan miktar/progress ile tamamlandı kararı farklı.
Kaynağa bağlı karma hedefin tamamlanan bileşen sayısı da aynı helper'ı kullanır.

**Neden:** TL'de korunması test edilmiş olan 1 kuruşluk legacy toleransı,
birim bilgisi almayan helper üzerinden 0,01 gram/adet toleransına dönüşüyor.
Bu TL için bilinçli mevcut karardır; TL davranışını gelişigüzel kaldırma.

**Çözüm önerisi / ürün kararı:** TL toleransı korunsun; gram/çeyrek hedefin
kalan ve tamamlanma karşılaştırması kendi birim hassasiyetiyle yapılsın.
Saf helper'ın birim girdisi ve bütün çağrıları birlikte güncellensin.

**Kabul:** 1,22 / 1,23 gram tamamlanmış sayılmamalı; gerçekten eşit miktar
tamamlanmalı. Mevcut TRY 99,99 / 100 legacy davranışı ayrı testle korunmalı.

**Elenen aday:** Kaynak toplamasında 1,234 gram örneği ilk taramada fark
üretiyordu; ancak mevcut `assets.amount` ve hedef alanlarının DB ölçeği 2
olduğundan bu örnek mevcut kayıt sözleşmesinde temsil edilemiyor. Bu nedenle
“mevcut varlık kaynakları üçüncü haneyi kaybediyor” ayrı bug olarak sayılmadı.
Aylık checklist'in daha hassas miktar sözleşmesi ayrı kalır.

## T01 — Canlı kova testinin seçicisi eski

Kaynak: `tests/e2e/goal-sources.spec.ts:72`,
`src/components/finance/SavingsGoalsPanel.tsx:1341`.

Yerel backend ile üç canlı testten ikisi geçti. Kova testi
`getByLabel('Kasa kovası')` beklediği için 30 saniyede kaldı. Mevcut alanın
erişilebilir adı “Ayrılan para bölümü”. Sonraki “Kasada ayrılan” metni gibi
seçiciler de mevcut UI diliyle gözden geçirilmeli. Varsayılan E2E koşusu bu
testi atladığı için 55 yeşil senaryo bu akışı doğrulamıyor.

**Çözüm:** Mevcut ürün dilini esas alarak test seçicilerini güncelle ve canlı
testi tekrar çalıştır. Testi yeşil yapmak için eski UI metnini geri getirme.
Canlı test fixture'ları `try/finally` temizliğiyle kendine ait kayıtları kaldırmalı.

## Çözüm paketleri ve bağımlılıklar

### Paket 1 — Yanlış/çift yazım ve hatalı güven

M01, M02, M03 ve M07. Önce her kusur için **doğru davranışı bekleyen ve
mevcut kodda kırılan** regresyon ekle; sonra dar düzeltme yap. M02 yeni
migration gerektirir: timestamp dosya ve git geçmişinde benzersiz seçilmeli;
gerçek Postgres retry/rollback/sahiplik/reset/restore testleri zorunlu.
Kredi yazımını atomikleştirme seçilirse o da ayrıca SQL sınırından doğrulanmalı.

### Paket 2 — Hesap ve ekran tutarlılığı

M04, M05, M08, M09, M11. Mevcut resolver/hesap/cache desenlerini kullan.
M11'in altın birim kararı ve M04'ün rezerv tabanı açıkça kabul edilerek
`docs/FINANCE_RULES.md` ve ilgili hedef sözleşmelerine yansıtılsın.

### Paket 3 — Gizlilik, kapsam ve test bakımı

M06, M10, T01. M06 küçük olduğundan Paket 1'e de alınabilir. M10 için
her sorgunun “tam geçmiş / bilinçli son N” sözleşmesi önce sınıflandırılsın;
bütün sorguları sınırsız okumaya çevirme. T01, düzeltme paketlerinin canlı
kanıtını güvenilir kılmak için erken ele alınabilir.

### Kapanış kapısı

Her uygulama paketinde backlog, AI index ve etkilenen domain dokümanı aynı
değişiklikte güncel kalmalı. Kart borç geçişi değişirse ayrıca
`docs/CARD_DEBT_TRANSITIONS.md` güncellenmeli; bu araştırma kart geçişini
değiştirmedi. Sonunda `npm run verify`; ilgili tarayıcı akışları, migration
varsa temiz yerel seed + gerçek SQL regresyonları. Yeşil kapı bulgu kanıtının
yerini tutmaz: her M kimliğinin ayrı kabul testi olmalı.

## Bu turda hata diye değerlendirilmemiş davranışlar

- Maaşın ilk iş günü itibarıyla bakiyede varsayılması mevcut açık iş kuralıdır;
  banka tahsilatı tespitiyle aynı şey olduğu varsayılmadı.
- Kart alım senaryosunda ilk ödemenin sonraki aya konması açıklanmış mevcut
  basitleştirmedir. Kartın gerçek günüyle modelin hizalanması ayrı ürün işi olur.
- Raporlama amaçlı araç/kişi kayıtlarının banka bakiyesini değiştirmemesi
  sözleşmeye uygundur; ikinci bir gider yazımı istenmedi.
- Aylık hedef checklist'i toplam birikimi/rezervi artırmaz; yeni para yazmaması
  kusur değildir.
- Soğuk çevrimdışı açılış için kalıcı finans cache'i bulunmaması bilinen kapsam
  sınırıdır; bu turda yeni veri kaybı bulgusu olarak sayılmadı.

Üretim hesap verileri, gerçek banka/PDF/SMS çeşitlerinin tamamı, cihaz/push
teslimi, gerçek ağda eşzamanlı yük ve her olası auth değişimi bu denetimde
tüketilmedi. Gerçek backend UI'de başarısız T01 tam doğrulanmış sayılmıyor.
