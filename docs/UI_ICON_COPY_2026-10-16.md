# Safir ikonlar, metin ve kırpılma kontrolü

16 Ekim 2026. Kullanıcı ikonların safir temaya uymasını, anlaşılmayan veya
kırpılan metinlerin düzeltilmesini ve paketin canlıya alınmasını istedi.

## Uygulanan düzeltmeler

- Yeşil marka SVG'si safire taşındı. Aynı SVG'den 180px iOS, 192px ve 512px
  PWA PNG'leri Sharp ile üretildi; uygulamaya yeni paket bağımlılığı eklenmedi.
  Marka, favicon, manifest ve bildirim ikonları aynı sürümlü adresi kullanır.
  Tarayıcı/PWA tema bandındaki eski yeşilimsi zeminler de düzeltildi.
- Gezinme, üst araçlar, takvim satırı, yardım ve boş durum ikonları safirdir.
  Yardımda Unicode işareti yerine Lucide Info kullanılır. Banka logoları ve
  anlam taşıyan başarı/uyarı/tehlike renkleri korunur. Boş durumda işlevsiz
  “İlk kayıtla ekran anlam kazanır” alt bandı kaldırıldı.
- 360px'te Özet'te iki ekstre adı ellipsis ile kesiliyordu. Ortak `LineRow`
  mobilde ad/açıklama ile tutar/eylemi ayırır; masaüstü yatay kalır.
  Analiz raporunda kredi adları, ayrıntılı analizde hesap/kart işlem
  açıklamaları ve kart kıyaslarında kart adları sarılır. Taksit tutarı da
  ellipsis kullanmaz; kayıtları/para biçimini değiştirmez.
- “Takvim” ana sekmesi “Ödemeler” oldu; iki görünüm Yaklaşanlar/Takvim.
  “Kalan ay yükü” ve “Beklenen giriş” sadeleşti. Yedi günlük pencere
  “Önümüzdeki 7 gün” diye anlatılır; maaş satırının yanlış Borç etiketi
  Maaş oldu. Gruplama, tarih hesabı ve tutarlar değişmedi.
- Banka ile kontrolün kullanıcı metinleri karşılaştırma/uyum dili kullanır.
  Fark da kaydedebilen düğme “Karşılaştırmayı kaydet”tir; borç düzeltme
  ayrı eylemdir. Teknik “kova projeksiyonu” sadeleştirildi. Eksik kart vadesi
  “Vade günü tanımlı değil”dir. Ayrıntılı adlandırmalar `UI_COPY_REVIEW.md`'de.
- PWA Harcama ekle kısayolu işlemler bölümünden mevcut doğrudan harcama görev
  rotasına düzeltildi. Finansal form/API/ledger/SQL davranışları değişmedi.

## Kontrol kapsamı

Yerel Supabase demo hesabı ve gerçek Vite ekranları kullanıldı. Finans kaydı,
ödeme, düzeltme veya silme gönderilmedi; normal açılış otomasyonları engellenmedi.

360 × 800 koyu tema: Özet, Hesaplar, Varlıklar, Maaş, Altın, Borsa, Araçlar,
Krediler, Kişiler, Ödemeler, Hedefler, Alsam mı?, Alışveriş listesi, Gider
grupları, Analiz, Ayrıntılı analiz, Asistan, Veri kontrolü ve Yedek/ayarlar.
DOM ölçümü yükleme iskeletleri kapandıktan sonra yapıldı. Ekran okuyucu için
gizli `.sr-only` metinler ve genişletilmiş dokunma hedefi pseudo-element'leri
gerçek metin kesilmesi sayılmadı. Yatay kaydırmalı sekme/grafik kapları
bilinçli kaydırma yüzeyleridir. Son taramada açık içerikte kırpılan metin 0,
belge genişliği viewport'u aşan rota 0. Bu bütün olası veri uzunlukları ve
kapalı pencerelerin tüm durumları için garanti değildir.

Aynı 19 rota 360px açık temada, Özet/Hesaplar/Ödemeler/Analiz/Ayrıntılı
analiz/Alsam mı? 1280 × 900 açık temada da ölçüldü: açık içerikte kırpılma
ve belge taşması 0. 390px açık temada sonraki aya geçilerek maaş satırında
Maaş rozeti görüldü. Kart ayrıntısındaki yaş bilgisi “Son karşılaştırma”
etiketiyle bağlama kavuştu; banka/kart/kişi adı tam gösterilir. Son küçük
etiket düzenlemeleri finansal hesap kaynağını değiştirmez.

Fiziksel iOS/Android, ana ekran ikonunun işletim sisteminde yenilenmesi,
büyük sistem yazısı ve tam ekran okuyucu testi bu kontrolün kapsamında değildir.
Görsel/DOM kanıtları sohbetin repo dışındaki yerel görsel klasöründedir;
demo finans görüntüleri repoya eklenmez.

## Doğrulama ve yayın

`npm run verify` son kaynakla başarılı: lint, 150 dosyada 1.634 test,
coverage eşikleri, üretim bağımlılık audit'i (0 açık), TypeScript/Vite build,
bundle bütçesi (JS gzip 988,3 kB / 1.030 kB) ve altı edge tip kontrolü.
Yeni düşük etkili metin/renk değişikliklerini aynalayan test eklenmedi;
mevcut projeksiyon, ödeme görünümü/eylem/gizlilik ve odak regresyonları geçti.
React incelemesinde yeni sorgu, effect, katman ihlali veya bağımlılık yok;
mevcut erişilebilir ad, `aria-hidden` ve gizlilik akışı korunur.

Yayın kullanıcının onayıyla korumalı PR → CI → Deploy Production hattından
yapılır; üretim sonucu PR ve workflow kaydından izlenir. Migration/edge yayını
gerekmiyor. DOM JSON'ları, ekran görüntüsü ve verify log'u repo dışındadır.

## Canlı masaüstü giriş eki

İlk paket yayınlandıktan sonraki giriş kontrolü, tanıtım panelinin global
safiri eski yeşil yerel `--primary` değeriyle ezdiğini gösterdi. Yerel tema
token'ları kaldırıldı; panel açık/koyu temayı miras alır. Örnek nakit akışı
paneli marka SVG'siyle aynı safir renkleri kullanır; sabit tutarların örnek
olduğu ve ay sonu değerinin tahmin olduğu açıklandı. Bu ek kullanıcının
sonraki dil sözlüğü isteğiyle birlikte uygulanır; sözlük `UI_GLOSSARY.md`,
doğrulama/yayın kaydı `UI_COPY_REVIEW.md`'dedir.
