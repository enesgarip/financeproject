# Birlikte kullanılan özelliklerin sadeleştirilmesi — 8 Kasım 2026

İkinci paket (kullanıcı onaylı 1/2/3/5): `docs/LINKED_FINANCE_WORKFLOWS.md`.
Altın alımı (4) kapsam dışıdır. Bu dokümanın aşağıdaki sunum/şema değişmezliği
ilk paketi tanımlar; ikinci paket ayrı iki tablo ve RPC içerir.

Alışveriş, birikim, düzenli gider, kategori bütçesi ve bekleyen kontroller mevcut
akışlarda birleştirildi. Ana gezinme, finans formülleri, şema ve ledger korunur.

## Alışveriş

Alınacaklar'da ürün adı veya değerlendirme düğmesi liste içinde ortak
`PurchaseDecision` formunu açar. Fiyatsız ürün de açılır; ad ve kimlik korunur.
Hızlı Alsam mı? rotası aynı bileşendir; mevcut hesapları kullanır. Bileşen ilk
açılışa kadar dinamik yüklenir. İhtiyaç testi listeye eklerken isteğe bağlıdır.

Listede beklet kapanır ve yazmaz. Aldım yalnız mevcut wishlist kaydının
`is_purchased`/`purchased_at` alanlarını günceller; finansal harcama üretmez.
SMS/ekstre/manuel harcama ayrı yollardır. Yazma hatasında tekrar denenebilir;
liste içinden ikinci ürün oluşturulmaz. Hızlı kararda tüm sonuçlarda listeye
eklenebilir. Karar girdileri `data-navigation-transient` ile geçici simülasyondur.

## Birikim

Hedef kartı toplam birikim/hedefi, bu ayın planı/gerçekleşeni/kalanını ve
hedefe ayrılan parayı birlikte gösterir. TL/gram/çeyrek birimleri ve karma
bileşen kapsamları korunur. Geçmiş Aylık takip'te açılır. Aylık özet aynı
`buildGoalMonthlyRows` ve kullanıcı bazlı `goal-monthly` cache'ini paylaşır.
Kayıtsız gerçekleşme sıfır değildir; miktarlar gizlilik maskesine uyar.

Aylık takip toplam birikime eklenmez, rezerv/ledger yazmaz. Tarihe göre ayırma
önerisi, kullanıcının aylık planından ayrı adlandırılır. Para ayırma, kaynak
bağlama ve tekrar ayırma onayı mevcut yollardır.

## Düzenli giderler

Ödemeler'de `#abonelikler` bölümü abonelik adaylarını ve zam radarını açar;
bileşen/fiyat sorgusu ilk açılışa kadar başlamaz. Analiz aylık plan toplamını ve
yönetim bağlantısını gösterir, kullanılmayan fiyat sorgusunu artık çalıştırmaz.
Eski Analiz hash'i özet alanına ulaşır. Özellik dizini yeni yönetim adresini
kullanır; favori kimlikleri korunur. `app/usePriceTrends.ts` mevcut repo/tespit
kurallarını kullanır. Aday planlaması mevcut `SubscriptionDiscoveryPanel` yoludur;
adaylar onaylanmadan borç sayılmaz.

## Kategori bütçesi

Kategori ayrıntısındaki bütçe yalnız **cari takvim ayı + tüm kartlar** seçiminde
görünür. Ekstre/tek kart/geçmiş ayda limit düzenlenmez. Kullanım mevcut
`buildBudgetUsage` hesabıdır; provizyonları da kapsadığı açıkça yazılır.
Limiti düzenle/Bütçe belirle mevcut CRUD'u kullanır. Çıpalı bütçe sabit limite
geçeceğini kaydetmeden önce söyler. Hata formda kalır; başarı finans snapshot
ve CRUD cache'lerini yeniler.

## Özet inceleme listesi

Dövizli SMS kapsam uyarısı, son karşılaştırmadaki açık hesap/kart farkları,
hafif veri bulguları ve aktif abonelik adayları ortak İncelenecekler alanındadır.
Sayaç **başlık sayısıdır**; örtüşen bulgular tekil kayıt toplamı gibi sunulmaz.
Karşılaştırma `latestReconciliationByCard`/`buildReconciliationItems` kullanır;
corrected/matched ölçümler tekrar açılmaz. Geçmiş güncellenmez. Snapshot hatasında
o kaynaktan yeni iddia yoktur; SMS hata/kurtarma uyarısı ve dövizlerin toplam
dışında olduğu bilgisi korunur. Bağlantılar ilgili yönetimi açar; otomatik yazmaz.

## Doğrulama

Kalıcı kanıt: `tests/e2e/simplification.spec.ts` birleşik alışveriş, hedef,
kategori bütçesi ve inceleme senaryoları; mevcut aylık/bileşen/keşif testleri.
Ağ sentetiktir, üretime yazılmaz. Son sonuçlar `docs/BACKLOG.md` kaydındadır.
