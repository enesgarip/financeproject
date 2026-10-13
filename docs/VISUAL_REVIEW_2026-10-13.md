# Görsel taşma ve kesilme taraması — 13 Ekim 2026

Yerel Vite ve yerel Supabase demo verisiyle uygulamanın gerçek ekranları
incelendi. Kaynak, DOM ölçümleri ve ekran görüntüleri birlikte kullanıldı;
her madde için ayrı bir değişiklik öncesi görüntü arşivi olduğu iddia edilmez.

## Düzeltilen bulgular

| Yüzey | Gözlenen sorun | Düzeltme |
| --- | --- | --- |
| Kredi kartı ayrıntısı | Üst çizgi ve ışık yuvarlak köşenin dışına taşıyordu | Dekorasyon başlığın radius'unu miras alır; menü için dış yüzey taşmaya açık kalır (`CardsPage.list.tsx`) |
| Kredi ödeme planı | 360px'te taksit tutarının sonu üç noktayla kesiliyordu | Taksit numarası ve tutar gerektiğinde ayrı satıra geçer (`LoansPage.tsx`) |
| Canlı kur bandı | BIST gecikmesi açıklaması dar alanda kesiliyordu | Açıklama tüm satırı kullanır; yenileme düğmesinin hedefi 44px'tir (`RatesBanner.tsx`) |
| Analiz metrikleri | Üç sütundaki tutarlar 60px alana sıkışıp kesiliyordu (ör. 224.226,68 ₺ için 78px gerekiyordu) | Dar ekranda iki sütun; değer kısaltılmadan sarılır (`AnalysisPage.atoms.tsx`, `AnalysisPage.trends.tsx`) |
| Borsa/ortak çizgi satırları | Miktar, ortalama maliyet, fiyat durumu ve gerçekleşmiş kazanç alt metni kesiliyordu | Ortak `LineRow` alt metni sarılır; tutar hesabı değişmez |
| Gider grubu eylemleri | Uzun ad satırı genişletiyor, Tamamla/Sil kartın altında kırpılıyordu | Satır min-width:0 kullanır; ad sarılır, eylemler küçülmez (`ExpenseContextsPage.tsx`) |
| Gider grubu harcama etiketleme | Sabit genişlikte seçici tarih/tutarı daraltıp gizliyordu | Dar ekranda metin ve seçici alt alta; tarih/tutar kısaltılmaz (`ExpenseContextsPage.tsx`) |

Gider grubu eyleminde somut ölçüm: 430px'te silme düğmesinin sağ kenarı
427,28px, kırpan kartın kenarı 400px idi. Düzeltme sonrası 360px'te düğme
296,67px, kart 330px; eylemler tamamen sınır içinde.

## Kapsam ve kanıt

- 19 rota giriş görünümü: özet, hesaplar, varlıklar, krediler, ödeme takvimi,
  hedefler, alışveriş listesi, analiz, altın, borsa, kişiler, ayrıntılı analiz,
  araçlar, maaş, Alsam mı?, veri kontrolü, gider grupları, asistan, yedek/ayarlar.
- 360px koyu temada başlangıç taraması ve 360px açık temada son DOM/taşma
  kontrolü. Gider grubu yüklenme ekranı ilk ölçümde ayrıldı; içerik hazırken
  yeniden incelendi. Son açık tema kontrolünde 19 ekranın belge genişliği
  clientWidth ile aynı; kırpılan ana eylem ve sayfa dışına taşan ana öğe 0.
- 1280px açık temada özet, hesaplar, varlıklar, krediler, takvim, hedefler,
  analiz ve gider gruplarında genişlik ve eylem sınırları kontrol edildi;
  belge taşması ve kırpılan eylem 0.
- 430px açık tema gider grubu/kredi görünümü; kartın açık/koyu köşeleri,
  açılan işlem menüsü ve 360px kayıt düzenleme penceresi ayrıca incelendi.
- Kısa isim/hareket başlıklarındaki mevcut ellipsis her yerde kaldırılmadı;
  tutarı veya gerekli açıklamayı gizleyen kısaltmalar ve kaybolan eylemler
  hedeflendi. Grafiklerin kendi kırpma/scroll kapları sayfa taşması sayılmadı.
- Fiziksel iOS/Android cihaz, tüm olası içerikler ve bütün modal/döküm durumları
  bu taramanın kapsamında değildir. Tarayıcı viewport ölçümleri kullanıldı.
- Finansal form gönderimi, ödeme, etiket ataması, tamamlama veya silme yapılmadı;
  yeni test kaydı oluşturulmadı. Finans hesapları/RPC/şema değişmedi.

Kalite kapısı: `npm run verify` başarılı (145 dosya, 1.555 test; lint,
coverage, üretim bağımlılık audit'i: 0 açık, build, bundle bütçesi ve 6 edge
fonksiyonun tip kontrolü). Son kaynakla 360px koyu temada taksit tutarları
yeniden görüldü. İskelet/yükleniyor görüntüsü tamamlanmış ekran kontrolü
sayılmadı. Örnek ekran görüntüsü ve DOM ölçüm JSON'u yerel görsel artifact
klasörüne kaydedildi.
