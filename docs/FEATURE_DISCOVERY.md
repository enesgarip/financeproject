# Özellik arama ve keşif

12 Kasım. Başlık ve arama alanı panelde sabit kalır. Favoriler, sonuç sayısı
ve özellik listesi tek iç alanda kayar. Kaydırma çubuğu tema metin rengine
bağlıdır ve klasik çubuk kullanan tarayıcıda sonuç sayısı değişirken içerik
genişliği korunur. Yeni arama sonuç alanını başa getirir.

8 Kasım ikinci paket: Araç/gider grupları ortak harcama ve mevcut hareket
bağlantıları taşır. Hesap hareketlerinde para girişi sınıflandırma, Araçlar'da
bakım tamamlama/geçmiş, ay kapanışında ilgili işe geçiş vardır. Mevcut özellik
kimlikleri korunur. Kaynak: `docs/LINKED_FINANCE_WORKFLOWS.md`.

8 Kasım: abonelik adayının favori kimliği korunur; yönetim bağlantısı
`/odemeler?view=plans#abonelikler` olur. Alınacaklar açıklaması liste içi karar
akışını içerir. Eski Analiz hash'i özet/yönetim bağlantısına ulaşır.
`docs/SIMPLIFICATION_FLOWS_2026-11-08.md`.

7 Kasım 2026. Kullanıcı bazı özellikleri bulmakta zorlandığını ve bir kısmının
varlığını sonradan fark ettiğini belirtti. Kabul edilen kapsam: her sayfadan
**Ara ve keşfet**, açıklamalı rehber ve kullanıcıya özel favori kısayollar.

- Kabuk başlığında mobil/masaüstü metinli düğme vardır. İlk açılışta
  `FeatureExplorer.tsx` ve dizin yüklenir; kapalı keşif finans sorgusu yapmaz.
- `utils/featureDiscovery.ts` özellik adı, kısa amaç açıklaması, mevcut menü
  yolu, bağlantı ve eş anlamlı arama kelimelerini tutar. Arama boşken tüm
  özellikler konu başlıkları altında görünür. Türkçe büyük harf ve aksan
  farkları katlanır; çok kelimeli aramada her kelimenin eşleşmesi gerekir.
- Bu dizin uygulama özelliklerinindir. Kullanıcının hareket/tutar verileri
  veya arama geçmişi dizine, sunucuya veya analitik olaya yazılmaz.
- Yıldızla eklenen favoriler `denge:feature-favorites:<userId>` altında bu
  tarayıcıda saklanır. Farklı kullanıcı kimliği farklı depodur; kullanıcı
  değişiminde panel yeniden kurulur. Bozuk/eskimiş kimlikler elenir.
  Depolama hatasında oturum içi seçim sürer, kalıcı olmadığı açıklanır.
- Sonuçlar mevcut sayfa/görev adreslerine gider. Bölüm hash'i kapalı
  bildirim/otomasyon/kasa, abonelik, ay kapanışı, ayrıntı araçları veya aylık
  hedef takibini açar. `FeatureSection.tsx` veri/lazy içerik geldikten sonra
  odağı ve kaydırmayı hedefe taşır; sabit başlık payı vardır. Yalnız hedef
  bağlantısı bunu tetikler, sıradan veri yenilenmesi odağı çalmaz.
- `DeferredDetails.openRequestKey` yeni bağlantıda açmayı ister; kullanıcı
  kapatabilir. İlk açılış sonrası çocuk/form durumu korunur. Aylık takip
  bağlantısı hedef kartlarındaki takipleri açar; karma bileşen seçimi kullanıcıda.
- Ortak SimpleModal odak hapsi, Escape ve kapatınca odağı geri verme
  davranışını sağlar. Arama girişinin `data-navigation-transient` işareti
  geçici filtreyi kaydedilmemiş finans formu saymayı önler; diğer form
  alanları ve linkle gezinme koruması korunur.

Yeni özellikte dizin kaydı ve gerekiyorsa bölüm bağlantısı aynı değişiklikte
eklenir. Ana gezinme adlarının kaynağı `components/navigation.ts`, özellik
açıklamaları/arama kelimelerinin kaynağı `utils/featureDiscovery.ts`'dir.

Kanıt: `featureDiscovery.test.ts`, `ui/deferred-details.test.tsx` ve
`tests/e2e/simplification.spec.ts`: 320/390/1280px açık/koyu kullanım, arama,
favori kalıcılığı, Escape/odak, doğrudan ve aynı bölüme yeniden bağlantı,
boş sonuç, depolama hatası ve hedefin sabit başlık altında kalmaması.
Şema, para hesabı ve finansal yazma yolu değişmez.
