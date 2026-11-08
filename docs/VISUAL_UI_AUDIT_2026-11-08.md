# Son görsel/UI tutarlılık taraması — 8 Kasım 2026

9 Kasım uygulama/kabul kaydı: `docs/AUDIT_REMEDIATION_2026-11-09.md`.
M01–M23, V01–V07, F01–F05 ve T01 uygulandı. Aşağıdaki tarama durumu
bulguların tespit anını korur; güncel kanıt ve yayın kapıları düzeltme
belgesindedir. U01 gerçek telefon belirtisi birebir doğrulanmadı, açık kalır.


Kullanıcı, mantık taramalarından sonra görsel mantıksızlıklar için son bir tur
istedi. Bu çalışma bir düzeltme kaydı değildir. Uygulama revizyonu `a96910f`;
uygulama kodu, finans kuralları ve migration'lar değiştirilmedi.

## Sonuç ve kapsam

**7 yeni bulgu: V01–V07 (2 P1, 5 P2).** Önceki M01–M23 yeniden sayılmadı.
Birleşik düzeltme kapsamı **30 ürün maddesi (14 P1, 16 P2) + T01 test bakımı**.
P0 doğrulanmadı. Bu sonuç yalnız aşağıdaki kapsam için geçerlidir.

| Kimlik | Öncelik | Doğrulanan görsel/etkileşim sorunu |
| --- | --- | --- |
| V01 | P2 | Büyük bütçe tutarında kahraman sayı mobilde taşıyor, oran dört satıra dağılıyor |
| V02 | P1 | Gram/USD grafiğinin ekseni, tooltip'i ve erişilebilir özeti TL diyor |
| V03 | P1 | Düşen gram/USD trendinde yeşil artış rozeti; en yüksek değer en düşükten küçük |
| V04 | P2 | Uzun araç/bakım adı tamamlama ve silme düğmelerini kartın dışına itiyor |
| V05 | P2 | Ay kapanışı ayrıntı metinleri iki temada da düşük kontrastlı |
| V06 | P2 | Ana metinli kontrollerin dokunma alanı projenin 44px sözleşmesinin altında |
| V07 | P2 | Bakım tamamlama/silme ikonlarının genişletilmiş dokunma alanları çakışıyor |

Önceki raporlar:
`docs/LOGIC_UI_AUDIT_2026-11-08.md` ve
`docs/LOGIC_UI_AUDIT_SECOND_PASS_2026-11-08.md`.
Kanıtlar: `docs/audit-evidence/2026-11-08/visual-pass/README.md`.

### İnceleme yöntemi

- 24 rota × 3 görünüm = **72 tam sayfa görüntüsü**: 390px açık, 390px koyu,
  1280px açık. Giriş ekranı ayrıca görüntülendi. Masaüstü örnekleri ve mobil
  temas sayfaları kanıt klasöründe; ham matris yerel görsel arşivinde saklandı.
- Özet, banka/kredi listeleri ve ayrıntıları, varlık özeti/kayıtları, maaş,
  altın, hisseler, araçlar, krediler, kişiler/takip, ödemeler, hedef/bütçe,
  Alsam mı, alınacaklar, gider grupları, analiz/ayrıntılar/asistan,
  veri kontrolü/bakım tarandı. Görüntü, metin ve taşma envanteri birlikte okundu.
- **15 sentetik Chromium gözlemi geçti:** 320/390px büyük bütçe; iki temada
  gram/USD trendi; 320/390px uzun bakım satırı; iki temada kontrast/hedef
  ölçümü; ikon hit testi; 320px yüklenme/hata/boş durum/hesap ekleme modalı.
  Geçen gözlem, hatanın düzeltildiği anlamına gelmez.
- Normal demo matrisinde sayfa geneli yatay taşma veya yaprak metinde
  `scrollWidth > clientWidth` kırpılması ölçülmedi. Bu kontrol tek başına
  yeterli değildi: V04 kart içindeki taşmayı gizlediği için kontrollü uzun
  metin ve gerçek düğme koordinatlarıyla ayrıca doğrulandı.
- Ölçümler CSS pikselidir; mobil genişlik Chromium'da taklit edildi.
  Gerçek telefon, bütün tarayıcılar, native ekran okuyucu ve gerçek tarayıcı
  %200 zoom'u bu turun doğrulaması değildir. 320px reflow ayrıca sınandı.
- Üretim kullanılmadı. Yerel demo okundu; finansal bakım RPC'leri ve varlık
  senkron yazmaları ağ katmanında engellendi. Sentetik senaryoların Supabase
  istekleri tamamen karşılandı/engellendi. Normal demo oturum açma dışında
  finansal veriye yazılmadı; dış fiyat/analitik istekleri de engellendi.

## V01 — Bütçe kahramanı büyük tutarda mobil sınırına uymuyor

**Kaynak:** `src/pages/PlanningPage.tsx:326`–334.

Ay bütçesi `harcanan / limit` ifadesini sabit 46px, sıkı satır yüksekliğiyle
basıyor. Ortak HeroNumber'ın uzun sayıya göre küçültme/kırma davranışı burada
yok. Geçerli `1.234.567,89 / 9.876.543,21 ₺` verisiyle 320px ekranda:

- içerik alanı 280px; metin aralığı yaklaşık 306,38px;
- metnin sağı x=326,38; belge genişliği 326px, viewport 320px;
- sayı, `/`, limit ve para birimi ayrı satırlara dağılıyor; 390px'te yatay
  taşma kaybolsa da oran hâlâ parçalanmış görünüyor.

**Etki:** En önemli bütçe tutarı kesiliyor ve iki bağımsız sayı gibi okunuyor.
**Çözüm:** Mevcut Şerit sayı desenini kullan; gerektiğinde açıkça etiketli
harcanan/limit satırlarına geç, sayıyı ve birimini birlikte tut. Sadece
`overflow-hidden` eklemek sorunu örter.

**Kabul:** 320/390/640/1280px; küçük, milyon ve daha uzun geçerli tutar,
sıfır ve gizlilik maskesi. Kritik rakamlar eksiksiz okunmalı, yatay belge
taşması ve tek başına `/`/para birimi satırı oluşmamalı.
Kanıt: `probe-budget-320.png`, `probe-budget-320.json`, `probe-budget-390.json`.

## V02 — Seçilen birim grafik etiketine taşınmıyor

**Kaynak:** `src/pages/AnalysisPage.trends.tsx:92`–95,192;
`src/components/charts/BarChart.tsx:37`–40,117,174;
`src/components/charts/chartUtils.ts:69`.

NetWorthTrend bar değerini grama/USD'ye çeviriyor. BarChart ise erişilebilir
özet ve tooltip için her zaman TL biçimleyicisini, eksende de ortak kısa TL
biçimini kullanıyor. Gram altın seçiliyken üst özet 20→11 gram; eksen
`₺0, ₺5 … ₺20`, tooltip `20,00 ₺`. USD seçiliyken `$2.500` değerinin tooltip'i
`2.500,00 ₺` oluyor. İki temada da yeniden üretildi.

**Etki:** Sayının temsil ettiği fiziksel/finansal birim yanlış bildiriliyor;
aynı grafik görsel ve erişilebilir sunumda çelişiyor.
**Çözüm:** BarChart'a mevcut varsayılan TL davranışını koruyan birim/değer/
eksen biçimleyici desteği ver. Tooltip, eksen, aria özeti ve gizlilik aynı
seçili birimi kullanmalı. Eksen genişliği de yeni biçimle hesaplanmalı.

**Kabul:** TRY/GRA/USD için eksen + hover/dokunma tooltip'i + aria özeti;
gizlilik kapalı/açık. Gram/USD panelinin hiçbir sayısal etiketi TL dememeli.
Kanıt: `probe-trend-light-gra-panel.png`, `probe-trend-dark-usd-panel.png` ve
aynı adlı panel eki olmayan JSON gözlemleri.

## V03 — Trendin artış rozeti ve uç değerleri seçili birimle çelişiyor

**Kaynak:** `src/pages/AnalysisPage.trends.tsx:99`–109,126,178–186;
`src/utils/realValue.ts:83`–94.

Kontrollü iki günlük seri:

| Fotoğraf | Net değer | Gram kuru | USD kuru | Altın karşılığı | USD karşılığı |
| --- | ---: | ---: | ---: | ---: | ---: |
| 25 Ekim | 100.000 TL | 5.000 | 40 | 20 gr | 2.500 USD |
| 26 Ekim | 110.000 TL | 10.000 | 55 | 11 gr | 2.000 USD |

Seçili gram grafiği düşerken yeşil **+1,00 gr** rozeti çıkıyor. “En yüksek”
11 gr, “En düşük” 20 gr. USD'de benzeri: yeşil **+$182**, en yüksek $2.000,
en düşük $2.500. Doğru değişim gramda **−9 gr**, USD'de **−500 USD**.

Neden: uç noktalar ham TL'ye göre seçiliyor; rozet TL farkının bugünkü kurla
karşılığını alıyor; rozet rengi de TL farkının işaretine bağlı. Bunlar seçili
birimin zaman içindeki değişimi değil. Eksen biçimini düzeltmek V03'ü çözmez.

**Çözüm:** Seçili serinin dönüştürülmüş değerleri üzerinden fark, işaret,
minimum/maksimum üret. Güncel canlı değer ile tarihsel son fotoğrafın farklı
kur kullanımı tanımlı kalmalı; bir karşılaştırmada tutarlı esas kullanılmalı.
Geçersiz/eksik kuru sıfır performans gibi göstermemeli.

**Kabul:** TL artarken gram/USD azalması ve tersi; yatay seri; negatif net
değer; eksik kur; 90 gün/1 yıl/tümü. En yüksek ≥ en düşük, rozet yönü ve farkı
gösterilen seriyle tutarlı olmalı. Mevcut TRY para yardımcıları korunmalı.
Kanıt: dört `probe-trend-*.json` ve `probe-trend-*-panel.png` dosyası.
Bu panellerdeki gizlilik kapsamı ayrıca mevcut M06 ile birlikte ele alınır.

## V04 — Uzun bakım satırı eylemleri kartın dışına itiyor

**Kaynak:** `src/pages/CarsPage.tsx:519`–523;
`src/components/ui/card.tsx:59`–63.

Uzun ama geçerli araç adı ve bakım başlığıyla 320/390px'te bakım listesi
yaklaşık **599px** genişliğe çıkıyor. 320px viewport'ta tamamlama düğmesi
x≈551, silme x≈591 konumunda. Kartın `overflow-hidden` davranışı sağ tarafı
kesiyor; düğmeler görünmüyor ve dokunarak ulaşılamıyor. İki benzer başlığın
sonundaki ayırt edici “ön/arka takım” bilgisi de kesiliyor.

**Etki:** Bakımı tamamlamak/silmek mümkün görünmüyor; tarih/km ve kimlik
bilgileri de eksiliyor. Sayfa genelinde taşma olmaması bu durumu gizliyor.
**Çözüm:** Grid/flex çocuklarının minimum genişliklerini kontrol et;
etiket, başlık, durum ve eylemleri dar ekranda sarılabilir/alt satırlı düzenle.
Kritik metni yalnız truncate etmek yerine okunur tut. Kartın taşma kuralını
tek başına kaldırıp tüm sayfayı yatay kaydırmak yeterli değildir.

**Kabul:** Uzun araç/başlık ayrı ayrı ve birlikte; gecikmiş/yaklaşan/planlı;
320/390px. Başlık, tarih/km, durum ve iki eylem görünür; eylem merkezlerinde
`elementFromPoint` doğru düğmeyi döndürür.
Kanıt: `probe-car-320-panel.png`, `probe-car-390-panel.png`, ilgili JSON'lar.

## V05 — Ay kapanışı ayrıntılarının kontrastı düşük

**Kaynak:** `src/pages/AnalysisPage.panels.tsx:409`; uyarı özeti:393.

11px açıklamalara uygulanan `opacity-70`, mevcut metin ve yüzey renklerini
zayıflatıyor. Computed renklerin alfa birleşimiyle ölçülen yaklaşık oranlar:

| Metin/yüzey | Açık tema | Koyu tema | Normal metin eşiği |
| --- | ---: | ---: | ---: |
| Başarılı kontrolün ayrıntısı | 2,95:1 | 3,35:1 | 4,5:1 |
| Bekleyen kontrolün ayrıntısı | 2,95:1 | Bu örnekte eşik üstü | 4,5:1 |
| “2 kontrol dikkat istiyor” uyarı özeti | 4,41:1 | Bu örnekte eşik üstü | 4,5:1 |

**Etki:** Kontrol sonucunu açıklayan kritik küçük metinler zor okunuyor;
özellikle yeşil başarılı kutularda düşük kontrast iki temada da mevcut.
**Çözüm:** Ayrıntı için opaklık yerine yeterli kontrastı olan mevcut metin
token'ını kullan; başarı rengi işaret/başlıkta kalabilir. Uyarı token'ının
kullanıldığı gerçek zeminleri ayrıca ölç; bütün token'ları körlemesine değiştirme.

**Kabul:** Her iki temada başarılı/bekleyen durum ve uyarı özeti ≥4,5:1;
hover/focus içinde de açıklamalar okunur. Bu bir tam WCAG uygunluk belgesi
değildir; native ekran okuyucu testi yapılmadı.
Kanıt: `probe-contrast-light.json`, `probe-contrast-dark.json` ve görüntüleri.

## V06 — Ana metinli kontroller 44px dokunma sözleşmesini karşılamıyor

**Kaynak:** `src/components/ui/button.tsx:50`–52;
`src/components/HubNav.tsx:40`; trend seçimleri
`src/pages/AnalysisPage.trends.tsx:138`–172.

İkonlara ek hit alanı var; metinli boyutlarda yok. Örnek ölçümler:
Analiz hub sekmeleri yaklaşık **33,33px** yükseklik; “AI özeti”, “Görsel
indir”, “Sayfayı yazdır” **36px**; ortak varsayılan düğme **40px**.
Bu örneklerde `::before`/`::after` ek hedefi de bulunmuyor. Normal demo
envanterinde varlık “Değer güncelle” gibi daha kısa özel kontroller de var.

**Etki:** Aynı uygulamada ana işlemleri parmakla seçme kolaylığı değişiyor.
**Çözüm:** Ana mobil kontrollerin etkili hedefini en az 44px yap. Hub yatay
kaydırmasını koru. Sıkışık görseli korumak için ek alan kullanılacaksa komşu
kontrollerle çakışmadığını V07 yöntemiyle doğrula. Satır içi metin linkleri
otomatik olarak aynı ihlal listesine alınmamalı.

**Kabul:** İlgili kontrollerin gerçek hit alanı ≥44×44 CSS px, klavye odağı
görünür, label/sekme taşması yok. **44px burada proje sözleşmesidir;
WCAG 2.1 AA'nın tüm düğmelere getirdiği zorunlu ölçü diye sunulmuyor.**
Kanıt: `inventory.json`, `probe-contrast-*.json` içindeki targets listeleri.

## V07 — Genişletilmiş tamamlama/silme alanları birbirine giriyor

**Kaynak:** `src/pages/CarsPage.tsx:523`;
`src/components/ui/button.tsx:59`; `src/index.css:476`–485.

Bakım eylemleri 36px ikon düğmesi + 4px boşluk; her düğmenin görünmez hedefi
44px. Bu yüzden hedefler **4px çakışıyor**. Kısa “Bakım” başlığıyla 390px'te:

- Tamamlandı görünür kutusu x=260…296; genişletilmiş kutu x=256…300.
- Sil görünür kutusu x=300…336; genişletilmiş kutu x=296…340.
- `elementFromPoint(297,450)` tamamlama yerine **Hatırlatıcıyı sil** döndürüyor.
  Bu nokta tamamlamanın vaat edilen ek alanının içinde; DOM'da sonraki sil
  düğmesi üstte kalıyor. Görünen ikonun merkezine yanlış işlem bağlanmış değil.

**Etki:** Tamamlama ikonunun sağındaki tolerans alanına dokunma silme
işlemine gidebiliyor. Görsel boyut küçük kalırken ek alanın güvenli olduğu
varsayımı bozuluyor. Aynı `icon-sm + gap-1` deseni diğer komşu eylemlerde de
kontrol edilmeli; hepsinin yanlış işleme gittiği iddia edilmiyor.

**Çözüm:** Etkili hedefleri çakıştırmayan aralık/yerleşim kullan. 36px kutuda
iki taraftaki 4px genişlemeyi karşılamak için en az 8px boşluk veya gerçek
44px düzen kutuları uygun seçeneklerdir. Silme eyleminin geri alınabilirlik/
onay davranışı da mevcut ürün deseniyle birlikte değerlendirilmeli.

**Kabul:** 320/390px ve uzun/kısa başlık; tüm etkin hedefler ayrık; merkez ve
kenar noktalarındaki hit testleri doğru eylemi bulur. Testte gerçek silme
çağrılmamalı; sentetik istek/spy yeterli.
Kanıt: `probe-hit-overlap.json`, `probe-hit-overlap.png`.

## Doğru çalışan veya bu turda bulgu sayılmayan noktalar

- Açık/koyu ana yüzeyler, standart sayılarda kahraman hiyerarşisi ve alt
  mobil gezinme genel olarak tutarlı. Ana rota isimleri Türkçe ve okunur.
- Modal, yüklenme, kalıcı hata ve boş bütçe durumunun 320px örneklerinde
  belge yatay taşması ölçülmedi. Bu sonuç bütün modal varyantlarına genellenmez.
- Normal demoda altın özeti olup işlem listesi olmaması geçmiş varlık
  kaydından kaynaklanabilir; salt görüntüden yeni finans hatası sayılmadı.
- Tam sayfa screenshot'ta sabit alt çubuğun sayfanın ortasında görünmesi,
  çekim anındaki viewport'un kaydıdır; tek başına içerik örtme kanıtı sayılmadı.
- Renk/yuvarlaklık/boşluk tercihleri kaynak sözleşmeyle veya gözlenen kullanıcı
  etkisiyle çelişmediği sürece hata diye listelenmedi.
- İlk prob denemelerinde seçici ve ekran çekimi sorunları giderildi. Kanıtın
  repo içine yazılması geliştirme yenilenmesini tetikleyebildiği için son
  koşu repo dışına yazdı; **15/15 geçen son koşu** arşivlendi. Bu hazırlık
  sorunları ürün bulgusuna dönüştürülmedi.

## Birleşik çözüm sırası ve kapanış

1. Önce önceki raporların yanlış/çift yazım, altın bütünlüğü ve karar güveni
   maddeleri. M11 birim toleransı açık iş kuralı olarak kararlaştırılır.
2. V02/V03 aynı trend paketi içinde; birim, hesap, gizlilik ve grafiğin
   erişilebilir özeti birlikte doğrulanır. M06 ile test kapsamı ortaklaştırılır.
3. V01/V04 responsive metin ve eylem yerleşimi; V06/V07 birlikte ele alınır.
   Yalnız boyut büyütmenin yeni çakışma üretmediği gerçek hit testleriyle görülür.
4. V05 kontrast, önceki taslak/sohbet/storage/cache sorunları ve T01 test bakımı.

Geçici gözlem dosyaları normal test paketinden kaldırılır; düzeltmede kusurlu
davranışı bekleyen testler yerine doğru kabul koşulları yazılır. Davranış
değişince `docs/UI_ARCHITECTURE.md` ve ilgili finans source-of-truth belgeleri
aynı değişiklikte güncellenir. Bu taramada yalnız rapor/kanıt/backlog/index
güncellenmiştir. **`npm run verify` geçti:** 1930 test, lint/guard/coverage,
production audit 0 açık, build, 1038,7/1060 kB bundle ve 6 edge tip kontrolü.
Sonuç ve tam çıktı kanıt klasöründe tutulur.
