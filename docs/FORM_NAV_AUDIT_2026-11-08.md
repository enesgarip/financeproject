# Form, iptal ve mobil gezinme denetimi — 8 Kasım 2026

9 Kasım uygulama/kabul kaydı: `docs/AUDIT_REMEDIATION_2026-11-09.md`.
M01–M23, V01–V07, F01–F05 ve T01 uygulandı. Aşağıdaki tarama durumu
bulguların tespit anını korur; güncel kanıt ve yayın kapıları düzeltme
belgesindedir. U01 gerçek telefon belirtisi birebir doğrulanmadı, açık kalır.


Kullanıcı telefonda bir formu iptal ettikten sonra navbarın ekranın ortasına
geldiğini bildirdi; hangi form olduğu hatırlanmıyor. Bu tur form yaşam döngüsünü
ve kabuk etkileşimlerini inceler. Revizyon `a96910f`; uygulama/migration değişmedi.

## Sonuç

**5 yeni doğrulanmış madde: F01–F05 (1 P1, 4 P2).** Birleşik kapsam M01–M23,
V01–V07, F01–F05 = **35 ürün maddesi (15 P1, 20 P2) + T01**.
Kullanıcının tam navbar belirtisi **U01 olarak açık**; doğrulanmış beş maddenin
hiçbiri tek başına o belirtinin kesin kök nedeni diye sunulmuyor.

| Kimlik | Öncelik | Doğrulanan davranış |
| --- | --- | --- |
| F01 | P2 | Satır menüsünden açılan form kapanınca odak tetikleyici yerine body'ye düşüyor |
| F02 | P1 | Bekleyen kaydı kapatıp yeni form açınca eski yanıt yeni taslağı kapatıyor; busy kapanış yolları tutarsız |
| F03 | P2 | İlgisiz pencereyi kapatmak alttaki formun kirli durum korumasını temizliyor |
| F04 | P2 | Form içindeki aşağı sürükleme arka plandaki aktif sorguları yeniliyor |
| F05 | P2 | touchcancel sonrasında yenileme göstergesi/80px boşluk form kapandıktan sonra kalıyor |

Kanıt dizini: `docs/audit-evidence/2026-11-08/form-pass/README.md`.
Önceki kapsam: `docs/VISUAL_UI_AUDIT_2026-11-08.md`,
`docs/LOGIC_UI_AUDIT_SECOND_PASS_2026-11-08.md`.

## Kapsam ve kanıt sınırı

- Chromium/Pixel 7 ve WebKit/iPhone 13 bağlamlarında **23 senaryo × 2 motor =
  46 başarılı gözlem**. Bunlar mobil viewport ve dokunma yeteneği taklididir;
  Windows'taki WebKit, gerçek iPhone Safari/klavyesi değildir.
- Hesap, kredi kartı, kredi, kişisel borç, ödeme, varlık, maaş, altın, bütçe
  CRUD açılışları; hedef, hareket düzenleme ve PDF işleme akışı incelendi.
  X/Escape, onayı reddetme/kabul etme, tekrar açma, tarayıcı geri, uzun listeden
  kaydırılmış açılış, ekran yüksekliği değişimi, hareketli/azaltılmış animasyon,
  hızlı işlem ve üst menü ile birlikte çalışma kapsandı.
- Her aşamada body position/top/overflow, scrollY, aktif element,
  visualViewport ve navbar kutusu kaydedildi. Görüntüler **viewport çekimidir**;
  sabit navbarı tam sayfa screenshot tekniğiyle ortada göstermiyoruz.
- DOM dokunma probları gerçek hook'a hedef/bubble ve dokunma Y koordinatları
  verir; gerçek işletim sisteminin jesti ne zaman iptal edeceği taklit edilmez.
  PDF probunda çözümleyici bekleyen bir Promise ile değiştirilir; gerçek PDF
  çözümlemesi veya içe aktarma yazması yapılmaz. Geç POST yanıtı da mock'tur.
- Supabase ve dış ağ istekleri karşılandı/engellendi. Üretime veya gerçek
  finans verisine yazılmadı. Yeşil gözlem mevcut kusurun giderildiği anlamına gelmez.

## U01 — Bildirilen “navbar ortada kaldı” belirtisi açık

Standart iptallerde iki motorda da navbar tekrar altta göründü; body sabit
konum/kaydırma kilidi temizlendi. Uzun listede kapanış öncesi/sonrası scrollY:
Chromium 1545→1545, WebKit 1716→1716. Normal animasyonlu 440/490/590/690/790/844px
yükseklik örneklerinde navbar altı ile visualViewport yüksekliği farkı 0px idi.

Hedef formunun 450px'e daraltılıp kapatıldığı deneyde odak geri verme
sayfayı 0→270px kaydırdı; 844px'e büyüyünce bu konum kaldı. Navbar yine alttaydı.
Bu, odak/kaydırma sıçraması için ipucudur; **gerçek klavye yarışının veya
ortada kalan navbarın yeniden üretimi değildir**.

Bu aşamada belirtiyi yalnız CSS `bottom` değeriyle açıklamak veya rastgele
yükseklik/transform düzeltmesi yapmak için kanıt yok. Düzeltme paketinin gerçek
telefon kabulü şu verilerle yapılmalı: form/çıkış yolu, klavye açık-kapalı,
tarayıcı/PWA, ekran yönü; kapanışta ve sonraki viewport resize/scroll olaylarında
innerHeight, visualViewport height/offsetTop, scrollY, body stilleri ve nav rect.
Hedef: klavye tamamen kapandıktan sonra doğru görsel viewport altında navbar,
yeniden kullanılabilir menüler ve doğru bağlama dönen odak. Gerçek cihaz kontrolü
tamamlanmadan U01 “çözüldü” işaretlenmemeli.

## F01 — Satır düzenlemesinde odak geri dönüşü boşa düşüyor

Kaynak: `src/components/CrudPage.tsx:486`–488;
`src/components/ui/use-dialog-a11y.ts:37,82`.

Maaş satırı işlemleri → Düzenle → alanı değiştir → Escape/onay veya X/onay.
Modalın açılışında kayıt edilen previouslyFocused, hemen DOM'dan kaldırılan
**menü öğesi**. Cleanup o ölü elemana focus çağırıyor; kapanışta aktif element
BODY. İki motorda ve uzun kaydırılmış listede doğrulandı. Navbar bu örneklerde
altta kalıyor; bu maddeyi navbar konum hatasıyla eşitlemiyoruz.

Etki: Klavye/yardımcı teknoloji kullanan kişi düzenlediği satıra geri dönmüyor;
sonraki gezinme bağlamını kaybediyor. Yeni kayıt düğmesiyle açılışta ise sağlam
tetikleyici DOM'da kaldığından odak geri dönüşü çalışıyor.

Çözüm: Mevcut ortak diyalog deseninde kalıcı tetikleyiciyi açıkça taşı;
bağlı/görünür olmayan element yerine satırın işlem düğmesine güvenli dönüş yap.
Odak ve scroll restore sırasını birlikte değerlendir; görünmez bir elemana
focus çağırmak başarı sayılmamalı.

Kabul: Yeni/düzenle/sil, X/Escape ve kaydırılmış liste; kapanış sonrası aktif
element doğru görünür tetikleyici, odak halkası görünür, navbar altta.
Kanıt: `*-row-menu-cancel.json`, `*-scrolled-row-cancel.json`.

## F02 — Bekleyen işlemin kapanışı yeni form oturumunu bozabiliyor

Kaynak: `src/components/CrudPage.tsx:360,379,627`;
`src/pages/CardsPage.hooks.ts:332`–334,363–378.

Maaş formunu geçerli değerle kaydet; POST yanıtını beklet; X/onay ile kapat;
yeniden Maaş ekle deyip ikinci taslağı yaz; ilk yanıtı serbest bırak.
**Yeni taslak uyarısız kapanıyor.** Eski handleSubmit yeni modal oturumunu
ayırt etmeden `setModalOpen(false)` yapıyor. POST sayısı 1; ikinci taslak
kaydedilmiyor. İki motor aynı sonucu verdi. Bu M01 çift INSERT bulgusundan
farklıdır: burada geç eski yanıtın yeni formu kapatması söz konusudur.

Kapanış tutarsızlığı PDF'te de gözlendi: çözümleme beklerken Escape kapatmıyor,
X ise global onay kabul edilince kapatıyor. Kaynakta import/apply sırasında da
Escape guard'lı, X doğrudan onClose'a bağlı. PDF probu yalnız parsing durumunu
doğrular; gerçek import yarıda kesilip veri bozulduğu iddia edilmiyor.
İlgili kaynaklar: `src/components/finance/StatementImportModal.tsx:434,465`,
`src/components/finance/CurrentMovementImportModal.tsx:530,559`,
`src/pages/CardsPage.tsx:413,423`.

Çözüm: Gönderim/sonuç-belirsizliği/kapanış sözleşmesini tüm çıkışlara uygula.
Kapanış engellenecekse X de durumu göstermeli; kapanışa izin verilecekse
isteğin iptal olmadığı açık olmalı ve eski callback yeni oturumu değiştirmemeli.
Mevcut kilit/oturum desenini kullan; finansal isteği iptal etmekle arayüzü
kapatmayı birbirine karıştırma. Alanların pending sırasında düzenlenmesi de
aynı sözleşmeye bağlanmalı.

Kabul: Kaydet→geç başarı/geç hata/bağlantı belirsizliği; X/Escape/geri;
kapat→yeni form. Yeni taslak kaybolmaz, ilk işlemin sonucu izlenebilir kalır.
PDF parsing/import/apply için çıkış yolları aynı kilidi uygular.
Kanıt: `*-pending-save-cancel.json`, `*-pdf-busy-close.json`.

## F03 — Kapatma koruması yanlış formu temizleyebiliyor

Kaynak: `src/lib/navigationSafety.ts:3,27`–31.

Alınacaklar'da ürün adı taslağı yaz → Ara ve keşfet'i aç → bu pencerenin X'ine
bas. Global koruma alttaki taslak için onay soruyor. Kabul edilince yalnız
keşif penceresi kapanıyor; ürün taslağı hâlâ alanda duruyor ama **edited.clear()**
tüm izlemeyi temizliyor. Ardından Özet'e gidince ikinci onay yok; taslak kayboluyor.
Her iki motorda afterClose=1, afterNavigation=1; arada ürün alanı değişmemişti.

Etki: Hangi formun bırakıldığı belirsiz; görünür bir taslak korumasız kalıyor.
Korumanın click capture anında, gerçek kapatma/gezinme sonucundan önce bütün
formları temizlemesi temel sorun. Busy guard kapanışı reddederse de koşulsuz
temizleme yaklaşımı aynı açıdan incelenmeli; bu varyant ayrıca denenmedi.

Çözüm: Kirli alanları form/diyalog kapsamına bağla; yalnız gerçekten kapatılan
veya bırakılan kapsamı temizle. İlgisiz pencere kapatılırken alttaki taslağın
korumasını ve değerini koru. Reddedilen/geçersiz kapatma temizleme yapmamalı.

Kabul: Kirli form + temiz/arama modalı; X/Escape, reddet/kabul, sonraki rota
değişimi. Alttaki form ya korunmalı ve uyarı vermeli ya da açıkça bırakılıp
değeriyle birlikte temizlenmeli; görünür değer ile dirty izleme çelişmemeli.
Kanıt: `*-unrelated-close-dirty.json`.

## F04 — Modal içindeki jest arka planı yeniliyor

Kaynak: `src/hooks/usePullToRefresh.ts:21`–40,47–55,62–64;
`src/components/PullToRefresh.tsx:10`–11.

Maaş modalı açıkken modal hedefinden touchstart→aşağı touchmove→touchend
gönderildi. Aktif maaş listesi GET sayısı **1→2**; kullanıcı arka planı çekmedi.
İki motorda da doğrulandı; ilk yükleme tamamlandıktan sonra sayım yapıldı.
Hook pencere düzeyindeki tüm dokunmaları dinliyor; modal, iç kaydırma veya
alan hedefini ayırmıyor. Body kilitliyken scrollY=0 olması da başlangıcı geçiriyor.

Etki: Modal kaydırması gereksiz arka plan yenilemesi ve yüklenme durumu üretiyor;
bu finans yazması değildir. Veri değişimi/yeniden çizim form kapatma ve odak
akışına ek bir hareket katıyor. Probdan taslak bozulduğu sonucu çıkarılmıyor.

Çözüm: Jest yalnız ana içerikte, izin verilen başlangıç hedefinde ve modal/
scroll kilidi yokken başlamalı. İç scroll ve yatay hareketle yarışmamalı.
Kapanış/refetch ve existing query davranışını koru.

Kabul: Modal içi kaydırma aktif sorgu GET sayısını artırmaz; normal ana sayfa
çekmesi bir kez yeniler. Form odağı, dropdown, yatay sürükleme ve iç scroll
ayrıca doğrulanır. DOM probuna ek gerçek telefon jesti gerekir.
Kanıt: `*-modal-background-refresh.json`.

## F05 — İptal edilen dokunma sayfada kalıcı boşluk bırakıyor

Kaynak: `src/hooks/usePullToRefresh.ts:35`–40,62–68;
`src/components/PullToRefresh.tsx:18`.

Modalda 160px aşağı dokunma hareketi → touchcancel → formu X ile kapat.
Yenileme göstergesinin yüksekliği **80px→80px** kalıyor; 250ms sonra da
sıfırlanmıyor. Görüntüde gösterge ve boşluk duruyor. Hook touchend dinliyor,
touchcancel dinlemiyor; başlangıç/izleme ve görsel mesafe temizlenmiyor.

Etki: Form kapanınca içerik beklenmedik biçimde aşağı itilmiş kalıyor.
Nav rect ölçümünde navbar yine ekran altında; bu, U01'in kesin açıklaması değil.
F04 modal dışlama ile aynı çözüm değildir: normal sayfadaki iptal edilen jestin
temizliği de gereklidir. Tarayıcı/işletim sistemi touchcancel üretebilir; prob
belirli bir fiziksel telefonun bunu hangi anda ürettiğini doğrulamıyor.

Çözüm: touchcancel/iptal için izleme ve mesafeyi güvenli sıfırla; iptal yenileme
başlatmamalı. Modal açılışı, yön değişimi ve unmount temizliğini de değerlendir.

Kabul: Eşik altı/üstü touchcancel → gösterge 0, refresh 0; touchend normal
yenilemeyi korur. Form kapanışı ve sonraki hareket temiz bir durumla başlamalı.
Kanıt: `*-touchcancel-spacer.json` ve viewport PNG'leri.

## Tutarlılık kararı ve önceki maddelerle ilişki

Hareket düzenlemede X kirli form uyarısını gösteriyor; uyarı reddedilince form
açık kalıyor. Aynı formdaki **Vazgeç** doğrudan kapatıyor ve uyarı göstermiyor
(iki motorda xPrompts=1, cancelPrompts=0). “Vazgeç” açık bir bırakma eylemi
olduğundan bunu tek başına yeni ürün hatası saymadım. Ancak X/Escape/Vazgeç/
geri davranışının aynı taslak sözleşmesiyle tanımlanması gerekiyor.

M18'in satır içi taslak koruması kapsamı ve M01/M12/M17'nin tekrar yazım
güvenliği bu pakette korunmalı. Bu tur onları yeniden saymıyor. Standart
geri onayını reddetme/kabul etme, normal tekrarlı hızlı menü aç/kapat ve sağlam
tetikleyiciden açılan formun focus restore akışında ek sorun doğrulanmadı.

## Çözüm paketi ve kapanış

Önce F02/F03 ile taslak ve istek oturumunu güvenceye al; ardından F01 odak
ve scroll geri dönüşünü dar kapsamda düzelt. F04/F05 jest başlangıcı ve iptal
temizliğini birlikte çöz. U01 gerçek telefon doğrulamasıyla açık tutulur;
kanıtsız navbar koordinatı düzeltmesi yapılmaz. Modal/iptal sözleşmesi değişince
`docs/UI_ARCHITECTURE.md`, backlog ve context index aynı değişiklikte güncellenir.

Geçici gözlem dosyaları normal paketten kaldırılır; doğru davranışı bekleyen
kalıcı kabul testleri düzeltme aşamasında eklenir. Kalite kapısı ve çalıştırma
bilgisi kanıt README'sinde saklanır. Bu tur uygulama kodu değiştirilmedi.

**9 Kasım kapanışı:** `npm run verify` geçti: 1930 test, lint/guard/coverage,
production audit 0 açık, build, 1038,7/1060 kB JS gzip ve 6 edge tip kontrolü.
Geçici test/yapılandırma kaldırıldı. U01 gerçek telefon doğrulaması bekliyor;
bu kapanış araştırmanın tamamlandığını, ürün sorunlarının çözüldüğünü söylemez.
