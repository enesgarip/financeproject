# Kullanım istatistikleri

Kontrol › Kullanım, bugünü içeren son 7 veya 30 İstanbul takvim gününün
açılış ve işlem sayılarını gösterir ve hemen önceki eşit takvim aralığıyla
karşılaştırır. Bir satırdaki **Gün**, ilgili olayın
görüldüğü farklı takvim günü sayısıdır. **Başarılı gün**, tamamlanma olayları
üzerinden hesaplanır. Geçmişe dönük tahmin üretilmez.

## Ölçülen davranışlar

| Olay | Sayım noktası |
| --- | --- |
| Sayfa açılışı | Giriş sonrası korumalı rota içeriği görünür olduğunda. Kullanım ekranı hariç tutulur. Aynı rota içinde arama parametresi, kayıt kimliği veya bağlantı parçası değişirse sayfa sayacı artmaz. |
| Sekme açılışı | Hesaplar ve kartlar, kart dökümleri, Ödemeler'deki Vadeler ve Kayıtlı planlar ilk seçildiğinde veya kullanıcı tekrar döndüğünde. |
| İşlem açılışı | Harcama, transfer, ödeme/tahsilat, araç bakımı ve “Alsam mı?” formu görünür olduğunda. Transfer kısayolunda kaynak hesap seçimi de aynı akışa dahildir. |
| İşlem denemesi ve sonucu | Harcama, transfer, ödeme/tahsilat, hedefe para ayırma, araç bakımı ve JSON yedek alma için. Sonuç, uygulamanın aldığı yanıta göre sayılır. Sonucu doğrulanamayan bir deneme hata sayacına girer. Tekrar deneme yeni bir denemedir. |
| Değerlendirme | “Alsam mı?” ekranı veya Alınacaklar içindeki ortak form ilk kez geçerli bir sonuç gösterdiğinde. |
| Keşif | Ara ve keşfet sonucu veya favori kısayolu seçildiğinde. Sonuçsuz arama durumu en az 750 ms sürerse bu kesintisiz durum için bir olay sayılır. |

## İşlem akışları ve başlangıç noktaları

`hooks/useUsageFlow.ts`, görünür form başına rastgele bir ölçüm kimliği
üretir. Kaydetme denemeleri, alınan sonuç ve uygulamada gözlemlenen kapanış
aynı kimliğe yazılır. Rapor açılış günü seçili döneme giren formları sayar.
İlk tamamlanma akışı bitirir. Form açıkken yapılan ek kayıtlar genel
işlem sayaçlarına girer. Eski ölçümler genel sayaçta görünür.

Kaydetmeden kapanma, uygulamada kapanışı gözlenen ve denemesi kaydedilmeyen
formdur. “Alsam mı?” için karşılığı sonuç gösterilmeden kapanmadır.
Tarayıcının kapatılması veya ağ kaybı son adımı eksik bırakabilir.
Hata sonrası tamamlanma, aynı açık formda ikinci veya sonraki bir deneme
sonunda başarı görüldüğünde sayılır.

Başlangıç noktası, formun açıldığı yerdeki sabit uygulama etiketidir.
Hızlı işlem, alt bar, keşif, ilgili sayfa ve doğrudan bağlantı gibi
kaynaklar izlenir. Rezerv ve JSON yedek alma kaynağı ilk denemede yazılır.

## SMS otomasyonu

Kart ve hesap SMS'lerinde sahibine ait başarılı ve hatalı işleme yanıtları
`sms_log` üzerinden sayılır. Sayaçlar günlük satırlarına dayanır ve tekrar
gelen yanıtlar da bu toplamda görünür. Dövizli SMS'in bekleme listesine
alınması otomatik kart kaydı sayısına girmez. Elle tamamlananlar
`foreign_card_sms.completed_at` ile seçili döneme bağlanır. Toplam
bekleyen ve en az 24 saattir bekleyen, güncel kuyruk göstergeleridir.

## Veri sınırı

`app/usageStatistics.ts` görünürlük olaylarını toplar. `lib/usageTelemetry.ts`,
olayları `data/repositories/usageStatisticsRepo.ts` üzerinden girişli
kullanıcının kimliği ile üretim derlemelerinde en iyi çabayla kaydeder.
Ağ kaybında istatistik eksik kalabilir. Ölçüm isteği finans işleminin
sonucunu bekletmez.

`public.usage_events` hesap sahibi, sunucunun varsayılan zaman damgası,
sabit olay türü ve konusu ile uygun olaylarda başlangıç noktası ve rastgele
ölçüm kimliğini saklar. SQL kısıtı serbest metni, tam URL'yi,
form değerlerini, finans kaydı kimliklerini ve tutarları dışarıda bırakır.
Yeni ölçüm noktası eklerken katalogla SQL izin listesini birlikte güncelle.
RLS, girişli hesabın kendi satırlarını okumasına ve yazmasına izin verir.
`fetch_usage_insights` bu sınır içinde dönem, akış, kaynak ve SMS
sayaçlarını toplar. Günlük
`prune-usage-events` işi 90 günden eski kayıtları siler. Uygulama içi
finans yedeği finans tablolarını kapsar.

Mevcut Vercel sayfa ölçümünde bilinen rotaların yalnız yol bölümü kullanılır.
Ayrıntılı işlem ve keşif olaylarının hedefi Supabase'dir.
