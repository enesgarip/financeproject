# Mobil hesap, tema ve AI özeti incelemesi — 12 Ekim 2026

İnceleme yerel Vite + gerçek yerel Supabase demo oturumunda yapıldı.
Başlangıç sorunlarının bir kısmı kaynak kodundan belirlendi; tüm maddeler için
değişiklik öncesi ekran görüntüsü bulunduğu iddia edilmez. Kontrol uygulamanın
gerçek ekranlarında yapıldı; bağımsız tasarım/maket kullanılmadı.

## Bulgular ve uygulanan düzen

| Yüzey | Bulgu | Düzen |
| --- | --- | --- |
| Tema | Sistem yalnız ilk açılışta okunup otomatik yazılan tercihle sabitleniyordu | Sistem/Açık/Koyu, canlı media-query, uygulamaya dönüş ve sekmeler arası tercih eşitlemesi |
| Üst başlık | Gerçek mobil kontrolde kontroller başlığı kesiyordu | Başlık satıra yayılır, kontroller 44px hedef taşır |
| AI özeti | Uzun kopyala etiketi dar modalın aksiyon satırını zorlayabiliyordu | Kısa etiket, mobilde tam genişlik alt alta iki düğme |
| AI içeriği | Genel toplamlarla sınırlı, ekstre/kısmi ödeme girdileri aktarılmıyordu | 14 bölüm (veriye göre boş/opsiyonel bölümler azalabilir), tam snapshot, anonim kart/hedef, eksik veri açıklaması |
| Manuel kayıt | Ana liste, kart ayrıntısı ve menüde tekrar eden girişler | Harcama/taksit girişi yalnız + / İşlem menüsünde |
| Hesap ayrıntısı | Listeye göre farklı dekoratif zemin, büyük logo ve iç içe geçmiş bloklar | Nötr zemin, küçük kimlik, çizgi ayrımları, ana eylem bakiyenin hemen altında |
| Hareketler | Dar alanda tarih/tutar/sonrası sıkışması, son 3 + tam geçmiş tekrarı | Tutar ve sonrası ayrı satır, giriş/çıkış/net özeti; tam geçmiş varken kısa liste tekrarlanmaz |
| Uzun alanlar | İsim/not/IBAN kesilebiliyordu | Satıra yayılır; büyük kahraman tutarı okunur ölçüye iner |
| Arama | Kayıtlar varken eşleşmeyen aramada “İlk kayıt” önerisi | “Aramayı temizle” eylemi |

## Doğrulama kapsamı

- 360 / 390 / 430px mobil genişlikte açık ve koyu tema hesap ayrıntısı:
  yatay taşan ana içerik öğesi 0. Uzun hesap adı, büyük tutar ve uzun not/IBAN
  geçici yerel fixture ile denendi. Negatif bakiye ve 0 bakiyeli nakit cüzdanı
  liste verisinde doğrulandı; üç fixture kesin id + test adı filtresiyle silindi,
  kalan fixture sayısı PostgreSQL'de 0 olarak doğrulandı.
- Hesap liste/ayrıntı/geri dönüş, tutar + IBAN gizleme, boş arama ve temizleme
  gerçek tarayıcıda kontrol edildi.
- 1280px masaüstünde hesap/kart ayrıntısı ve kabuk kontrol edildi; belge
  scrollWidth'ü viewport genişliğine eşit (1280px).
- AI modalı 360 / 390 / 430px: düğmeler sınır içinde; dialog scrollWidth kendi
  clientWidth'üne eşit. “Özeti kopyala” sonrası tarayıcı panosu önizlemeyle
  birebir aynı ve başarı durumu görünür. PDF düğmesinin yerleşimi kontrol
  edildi; gerçek yazdırma/PDF kaydı yapılmadı.
- + → Harcama ekle formu açıldı; hesap/kart seçimi ve taksit ayrıntısı kontrolü
  bu girişte kalır. Finansal form gönderimi/ödeme yapılmadı.
- Tema için canlı açık↔koyu geçiş, elle seçim kalıcılığı, sisteme dönüş,
  uygulamaya odaklanma, depolama hatası ve listener temizliği birim testindedir.
  Fiziksel telefonda işletim sisteminin saatli tema geçişi bu oturumda denenmedi.
- Anonim rapor regresyonları: ortak limit tek sayımı, kısmi ekstre kalanı,
  planlı taksit filtresi, iptal hariç ve aynı gün karşılaştırmalı harcama,
  kasa+tampon düşümü, eksik kaynak/kur ve isimlerin sızmaması.

Tam kapı: `npm run verify` başarılı (144 dosya / 1.532 test, lint, coverage,
üretim bağımlılık audit'i: 0 açık, build, bundle ve 6 edge fonksiyonun Deno
tip kontrolü). Coverage: statements %92,67, branches %83,88, functions %93,77,
lines %94,81. Entry gzip 19,8 kB / 22 kB; toplam JS gzip 979,5 kB / 1.030 kB.
Kaynak guard'ları ve para/domain regresyonları bu kapıya dahildir.

## Ek düzenleme — kategori girişi

Kategori düzenleme ana özet/kart kısayollarından dönem hareketleri dökümüne
taşındı. Kapalı yardımcı bölüm, mevcut kategorisiz harcama sorgusunun aynı
kart kapsamını kullanır. Yüklenirken veya satıcı grubu yokken düğme pasiftir;
boşluk açıklanır. Sorgu hatası boş veriye çevrilmez, tekrar deneme sunulur.
Harcama düzenleme/iptali ve kategori kaydından sonra yeniden kontrol edilir.
Eski kategori paneli URL'si korunur ve boş durumda artık açıklama gösterir.

Gerçek yerel demo üzerinde 390px koyu temada tüm kartlar kapsamındaki
“Çalışma masası” kaydıyla eylemin açılması, Bonus Gold kapsamında ise pasif
düğme ve “Kategorize edilecek harcama yok” durumu doğrulandı. Kategori veya
finansal kayıt gönderimi yapılmadı.

Ek düzenleme sonrası `npm run verify` yeniden başarılı: 144 dosya / 1.532 test,
lint, coverage, audit (0 açık), build, bundle bütçesi ve 6 edge tip kontrolü.
Toplam JS gzip 979,8 kB; giriş 19,8 kB. 390px ekranda belge genişliği ve
içerik genişliği eşit (380px; kaydırma çubuğu hariç), kategori eylemi DOM'da
`disabled=true` olarak doğrulandı.

Yayın hazırlığında güncel main (#248) birleştirildi: Hesaplar ve nakit varsayılanı,
ortak limit grupları ve ikonlu kart dökümü menüsü korundu; manuel/kategori
girişleri bu incelemedeki sözleşmeye göre çözüldü. Birleşmiş kodda
`npm run verify` başarılı: 144 dosya / 1.541 test, tüm kalite kapıları;
toplam JS gzip 979,9 kB (bütçe 1.030 kB).
