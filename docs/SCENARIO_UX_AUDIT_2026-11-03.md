# İkinci tur — yoğun kişisel kullanım ve UX denetimi

**Takip durumu:** Bu tarihsel denetimdeki sekiz bulgunun düzeltme/kabul kaydı
`docs/SCENARIO_UX_FIXES_2026-11-03.md` içindedir. R2-F03'ün kalıcı cache teşhisi
orada düzeltilmiştir: sorun kısa süreli eski boş gösterimdir; mount sonrası
yenileme zaten çalışıyordu. Aşağıdaki ilk gözlemler yeni sürümün davranışı değildir.

3 Kasım 2026; incelenen sürüm `5d0b9ab07785ea0fa7c5947a2dcbe2ffd3bc3fdc`
(PR #283 sonrası main). **Bu kayıt bulgudur; düzeltme/yayın yapılmadı.**
Önceki düzeltmelerin kaydı `docs/SCENARIO_FIXES_2026-11-03.md` içindedir.

## Yöntem ve sınırlar

16 ana görev, ek varyasyonlarla 21 tarayıcı akışı ve 19 saf tarih/hesap kontrolü.
Gerçek yerel Supabase Auth → UI → RPC/REST → Postgres/ledger → UI kullanıldı.
Son tarayıcı kanıtları yerel **production build** üzerinde alındı. Saat gerçek;
tarih sınırları saf fonksiyon girdileriyle ayrı denetlendi. Donmuş saatle ilk
denemede oluşan token yenileme sorunu ürün bulgusu sayılmadı.

Kur/BIST yanıtları sabit sentetik veridir. Test kullanıcıları ve finans verileri
izole oluşturuldu; her akış sonunda kullanıcı finansı ve Auth kullanıcısı silindi.
Üretim Supabase'ine test yazması, canlı banka işlemi veya deploy yoktur.
İki sekme testi aynı yerel backend'e bağlı iki tarayıcı context'idir; farklı
gerçek cihaz/ağ testi değildir. Tutar/form etiketlerini yanlış seçen otomasyon
denemeleri düzeltilip tekrarlandı; ürün hatası sayılmadı.

Personalar: yoğun maaşlı/çok kartlı kullanıcı, ilk kez başlayan, nakdi yetersiz
kullanıcı, borç/alacak takipçisi, altın borçlusu, birikim hedefi olan, kalabalık
geçmişte kayıt arayan ve bağlantısı kesilen kullanıcı. Gerçek insan katılımcı,
insan görev süresi veya kullanılabilirlik puanı ölçülmedi. UX sonuçları görev
yürüyüşü ve görsel/etkileşim gözlemleridir.

## Doğrulanmış hatalar — açık

### R2-F01 / P1 — Gecikmiş ekstre açıkken dönem içi harcama bir ay öteleniyor

3 Kasım: kesim 20 / vade 30, 20 Ekim ekstresinden açık 5.000 TL ve dönem içi
4.000 TL. Eski ekstre hemen yükümlülüktür; dönem içi harcama 20 Kasım kesimi /
30 Kasım ödemesine aittir. Forecast iki ay için **[9.000, 0]** olmalı; gerçek
sonuç **[5.000, 4.000]**. Aynı kartın 10 Kasım'daki scheduled taksiti doğru
olarak 30 Kasım'a yerleşiyor; sorun genel taksit eşlemesi değildir.

Yoğun profilde bağımsız hesap:

```text
127.000 likit
−15.000 açık ekstre
− 4.000 bu ay ödenecek dönem içi
− 3.000 bu ay ödenecek scheduled taksit
−10.000 cari planlı ödeme −1.000 eski açık ödeme
− 7.000 kişisel borç −5.000 tampon −10.000 rezerv
=72.000 TL
```

Özet **76.000 TL** gösterdi. Henüz tahsil edilmemiş 12.000 TL alacağı doğru
dışarıda bıraktı. Eski 5.000 TL ekstreyi ödeyince banka ve ayrılan ekstre aynı
tutarda azalmasına rağmen Özet 76.000 → 72.000 oldu. Bu ikinci sonuç aynı hatanın
başka kanıtıdır; ayrı bulgu sayılmaz. Ödeme yazması/borç/ekstre kapanışı doğrudur.

Kaynak: `src/utils/obligations.ts` / `currentPeriodPaymentDueDate` açık ekstre
varsa `nextDue + 1 ay` kullanır; ekstrenin hangi kesime ait olduğunu ayırmaz.
Kanıt: `first-results.json` R2-01/02; `boundary-results.json` son kontrol.
Kabul: eski ekstre ödemesi harcanabiliri değiştirmemeli; aynı ay/sonraki ay
vadeli kartlar, kesim öncesi/sonrası ve kısmi eski ekstre birlikte sınanmalı.

### R2-F02 / P1 — Sunucu kaydettiği halde yanıt kaybolursa tekrar çift ödeme yazıyor

Borç 1.000, banka 10.000 TL; kullanıcı 100 TL kısmi ödeme kaydeder. İlk RPC
sunucuda tamamlandıktan sonra yalnız tarayıcıya dönecek yanıt kesildi.
DB: borç **900**, banka **9.900**, geçmiş **1**. Modal teknik hata ve eski
1.000/10.000 rakamlarıyla açık kaldı. Aynı düğmeye yeniden basınca aynı payload
ikinci kez işlendi: borç **800**, banka **9.800**, geçmiş **2**.

Bu kayıt ekranı bankadan para göndermez; hata uygulamadaki borç/bakiye/geçmişi
iki kez değiştirir. İlk yanıt kaybı ile ilk isteğin hiç ulaşmaması aynı durum
olarak sunulmamalı. Düğmeyi işlem sürerken kilitlemek yeterli değildir: çift
tıklama ayrı senaryoda tek istek üretti, kayıp yanıt sonrası tekrar çift yazdı.

Kaynak: `src/services/financePaymentActions.ts` / `settle_personal_debt` çağrısı;
mevcut payload işlem kimliği taşımıyor. Kanıt: `recovery-results.json` R2-04.
Kabul: aynı kullanıcı niyeti için kalıcı işlem kimliği; ilk commit + kayıp yanıt
sonrası aynı kimlikle tekrar, tek hesap hareketi/borç değişimi/geçmiş sonucu;
gerçek yeni ödeme için ayrı kimlik. Diğer finans RPC'leri de ayrı taranmalı.

### R2-F03 / P2 — İlk hesap kaydedilince Özet eski boş snapshot'ta kalıyor

Boş kullanıcı Özet'i açar; SPA üzerinden Hesaplar'a gidip 10.000 TL bakiyeli
banka hesabı oluşturur ve Özet'e döner. POST 201 ve DB 10.000 TL; ekran hâlâ
“Hesaplamak için veri yok” / “Önce bir banka hesabı ekle” diyor. Snapshot istek
sayısı kayıt öncesi ve dönüş sonrası **1** kaldı. Sayfa yenilendiğinde 5.000 TL
tampon düşülmüş doğru **5.000 TL** geliyor. Dev ve production build'de tekrarlandı.

Kaynak inceleme alanı: `src/components/CrudPage.tsx`, `src/pages/CardsPage.tsx`,
`src/app/useFinanceSnapshot.ts`. **afterSave/invalidation callback'i zaten var**;
“callback eksik” teşhisi konmadı. Kesin kök neden düzeltme aşamasında izlenmeli.
Kanıt: `account-cache-results.json` R2-12b. Kabul: 30 saniyelik cache süresi veya
sayfa yenilemesi beklemeden SPA dönüşünde yeni tutar; create/update/delete ve
boş/dolu cache varyasyonlarıyla gerçek backend regresyonu.

### R2-F04 / P2 — Tarayıcı Geri, kirli ödeme formunu uyarısız kaybettiriyor

Özet → Borçlar → Kişiler → Ödeme kaydet; tutar 1.000'den **100**'e değiştirilir.
Tarayıcı Geri ile Krediler'e dönülür; **onay sayısı 0**, modal kapanmış, girilen
tutar kaybolmuştur. DB'de yazma yoktur. `page.goBack()` ile tekrar doğrulandı.
Aynı formda Escape denemesi uyarı verdi, vazgeçilince 100'ü korudu; bu iki çıkış
yolu aynı korumayı sağlamıyor.

Kaynak inceleme alanı: `src/lib/navigationSafety.ts` popstate/DOM temizliği ve
router dinleyici sırası. Kesin kök neden henüz izlenmedi. Kanıt:
`back-navigation-results.json` R2-13c, önce/sonra ekranları.
Kabul: Geri/İleri, bağlantı, Escape ve kapatma için vazgeçildiğinde aynı rota,
aynı modal ve aynı alanlar; kabul edildiğinde gezinme ve sıfır finansal yazma.

## UX iyileştirme alanları — açık

| Kimlik / öncelik | Görev ve gözlem | Öneri / kabul |
| --- | --- | --- |
| R2-U01 / P2 | 1.206 hesap hareketinde 606. kayıt 76. sayfada. En yeni/en eski ve tek sayfa ileri/geri var; not/tarih araması ve sayfa atlama yok. Seçilen kayda mevcut gezinmeyle en az **75** sayfa geçişi gerekir. Bu sayı yapısal alt sınırdır, insan süresi değildir. | Tam geçmişte not/tarih/tutar filtresi veya erişilebilir sayfa atlama; toplamlar filtreden bağımsız açık etiketlenmeli. |
| R2-U02 / P2 | 320px'de “Muhammed Emin Abdülkadir Karahasanoğlu” ile “… Karaosmanoğlu” aynı görünen ön ada kırpılıyor. 194px alanda 351/357px metin; title yok. Tam ad ödeme modalı ve erişilebilir DOM'da var; yatay taşma yok. | Ödeme yapılacak kişiyi eylemden önce ayırt ettiren sarılan tam ad veya kolay ayrıntı; uzun benzer adlarla görsel kabul. İnsan yanlış ödeme oranı ölçülmedi. |
| R2-U03 / P2 | Açık uygulama 31 saniye çevrimdışıyken eski 5.000 TL'yi bağlantı/son okuma etiketi olmadan gösterdi. Bağlantıda 7.000'e doğru yenilendi. Isıtılmış SW ile soğuk offline açılışta kabuk geldi, son özet yerine “Özet yüklenemedi / TypeError: Failed to fetch” çıktı. | Son başarılı okuma + çevrimdışı durumu açık olmalı; soğuk offline görünümün veri saklama kapsamı belirlenmeli. Saklanan finans verisi için kullanıcı/oturum temizliği ve gizlilik kabulü gerekir. Mevcut uygulamanın kalıcı offline finans cache'i varmış gibi davranılmamalı. |
| R2-U04 / P2 | Kayıp yanıtta teknik fetch hatası; diğer sekmede 600 TL ödeme sonrası kalan 400 iken açık modal hâlâ 1.000 gösteriyor ve ikinci 600 denemesinde SQL metniyle reddediliyor. Sunucu ikinci yazmayı doğru engelliyor. | Kullanıcıya anlaşılır sonuç ve güncel kalan; belirsiz commit'te tekrar güvenliği R2-F02 ile birlikte çözülmeli. İki sekme reddinden sonra form güncel veriyle toparlanmalı. |

## Görev matrisi ve sağlam kalan davranışlar

| Görev | Sonuç |
| --- | --- |
| R2-01 yoğun Özet / hesap dökümü | R2-F01; alacak dışlama doğru |
| R2-02 gecikmiş ekstre ödeme | Yazma/ledger/kapanış doğru; R2-F01 aynı tutar kayması |
| R2-03 kısmi alacak tahsilatı | 2.000 tahsilat: alacak −2.000, banka +2.000, tek geçmiş, Özet +2.000 |
| R2-04 kayıp yanıt ve tekrar | R2-F02 |
| R2-05 yetersiz bakiye ve düzeltme | Başarısızlıkta sıfır yazma, alan korunuyor; 25 TL'ye düzeltince banka 25 / borç 975 |
| R2-06 kısmi altın borcu ve not düzenleme | 1 gram / 5.000 TL'den 1.666,67 ödeme → 0,666666 gram / 3.333,33; yalnız not düzenlemede miktar/değer korunuyor |
| R2-07 transfer | 10.000 + 5.000 → 9.000 + 6.000; toplam nakit ve Özet değişmedi; önizleme doğru |
| R2-08 takip dışından fatura ödeme | 500 TL ödendi, tek geçmiş; izlenen banka 10.000 kaldı; açıklama açık |
| R2-09 geçmişten kayıt bulma | Tam 1.206 kayıt erişilebilir; R2-U01 |
| R2-10 hedef kaynakları | Kategori + aynı tekil varlık 10.000 TL'yi 20.000 yapmadı; form/kayıt tutarı aynı |
| R2-10b rezerv | 5.000 TL ayırma bankayı değiştirmedi; tampon sonrası Özet 5.000 → 0; ikinci ayırmada açık uyarı, vazgeçince ikinci rezerv yok |
| R2-11 tarih / ay geçişi | 19 bağımsız kontrolden 18 geçti; bir R2-F01 karşı örneği |
| R2-12 ilk hesap | Forma ulaşma/kayıt doğru; R2-12b ile pozitif bakiyede R2-F03 kesinleşti |
| R2-13 çift tıklama | Geciktirilmiş RPC'de tek istek, tek 100 TL yazma |
| R2-13b klavye / Escape | 12 Tab adımında odak modalda; vazgeçince tutar 100; onaylı kapanışta odak tetikleyiciye döndü; sıfır yazma |
| R2-13c tarayıcı Geri | R2-F04 |
| R2-14 açık/soğuk offline | Yeniden bağlanmada tutar yenilendi; R2-U03 |
| R2-15 uzun adlar / gizlilik | R2-U02; Özet + hedef gizlilikte görünür TL rakamı sızdırmadı |
| R2-16 iki sekmede eski ödeme | İlk 600 sonrası borç 400; ikinci 600 reddedildi; banka 9.400 ve tek geçmiş korundu; R2-U04 |

Tarih varyasyonları: kesim günü/gün sonrası; kesim-vade aynı/sonraki ay;
Şubat 2027 ve artık yıl 2028; 30/31 gün kırpma; Aralık/Ocak; aylık tekrarın
başlangıç/bitişi; hafta sonundan ilk iş gününe maaş; Aralık'ta gerçek eski açık
kayıt + cari aylık tekrar + vadesiz borç. Maaşta resmî tatil takvimi test edilmedi.

Altın formunda native `stepMismatch` gözlendi fakat form `noValidate` ve kendi
doğrulamasını kullanıyor; not gerçekten kaydedildi, miktar korundu. Bu gözlem
“not düzenlenemiyor” hatası olarak raporlanmadı.

## Doğrulama ve sonraki uygulama sırası

`npm run verify` geçti: 174 dosyada 1.838 test, 7 guard, lint, coverage,
production dependency audit 0 açık, build, 1.007,1 / 1.030 kB gzip bütçesi ve
altı edge tip kontrolü. Bu mevcut otomatik regresyonların durumudur; yukarıdaki
karşı örnekler henüz kalıcı regresyonlara/düzeltmelere dönüştürülmedi.
Bu tur SQL migration/trigger değişmedi; DB reset yapılmadı.

Önerilen sıra:

1. R2-F02: ödeme niyeti/idempotency; kayıp yanıtı ve geri dönüşünü gerçek DB'de kanıtla.
2. R2-F01: dönem içi borcun gerçek kesim/vade eşlemesi; bütün harcanabilir/forecast tüketicileri.
3. R2-F03 ve F04: gerçek backend cache + gezinme regresyonları; kullanıcı girişini/veri tazeliğini koru.
4. R2-U03/U04: bağlantı, son okuma, belirsiz sonuç ve çakışma geri bildirimi.
5. R2-U01/U02: geçmişte bulma ve ödeme hedefini ayırt etme.

Önceki raporun F006 eksik şema kapsamı görünürlüğü, tarihsel yuvarlanmış miktarlar,
gerçek banka/SMS/PDF ve canlı piyasa/push testleri açık sınır olarak sürüyor.
Mevcut E2E paketinin dört live-backend testi bu tur ayrıca çalıştırılmadı; burada
yazılan gerçek yerel backend akışları onların tüm kapsamını geçti iddiası taşımaz.
Safari/iOS, fiziksel cihaz, ekran okuyucu ve insan kullanıcı doğrulaması yapılmadı.

Yerel ayrıntılı kanıt paketi: Codex artifact alanındaki
`round2/REPORT.md`, `round2/results.json`, senaryo script'leri, ham sonuçlar,
ekran görüntüleri ve `round2/verify.log`. Yeniden üretimde yalnız yerel API'ye
izin veren `runtime.cjs` kullanılır; fixture'lar çalışırken oluşturulup silinir.
