# UI Architecture

Last reviewed: 2026-07-27

Bu belge uygulamanın görsel kaynak gerçeğidir. Finans kurallarını veya veri
erişimini tanımlamaz; route ve component'lerin aynı premium-fintech dilinde
kalmasını sağlar.

## Görsel İlkeler

1. Nötr ve sakin canvas kullan; indigo yalnız marka, aktif durum ve ana aksiyon
   için öne çıksın.
2. Bir viewport'ta en fazla bir veya iki koyu "imza yüzeyi" kullan. Her kartı
   gradient veya koyu yüzeye çevirmek hiyerarşiyi bozar.
3. Finansal rakamlar `finance-value` ile tabular ve gerektiğinde mono görünür;
   başlıklar display, gövde metinleri sans ailede kalır.
4. Yeşil, amber ve kırmızı yalnız başarı, uyarı ve risk anlamı taşır.
5. İç içe kart üretme. Ana gruplama `Card`/`FinancePanel`, satır gruplama border
   veya `finance-list-row` ile yapılır.
6. Hover dekorasyonu işlevin önüne geçmez; klavye odağı ve azaltılmış hareket
   tercihleri korunur.

## Ortak Omurga

| İhtiyaç | Kaynak | Sözleşme |
| --- | --- | --- |
| Uygulama kabuğu | `src/components/Layout.tsx`, `src/components/BottomNav.tsx` | Koyu masaüstü sidebar, yarı saydam header, mobil yüzen ana navigasyon |
| Route bilgisi | `src/components/navigation.ts` | Başlık, açıklama, genişlik ve hub ikonları tek yerde |
| Hub geçişleri | `src/components/HubNav.tsx` | İkonlu, yatay taşabilen, tek aktif renkli segmented navigation |
| Sayfa komutu | `PageCommandHeader` in `src/components/finance/FinanceUI.tsx` | Label, başlık, açıklama, meta ve araç sırası |
| CRUD sayfaları | `src/components/CrudPage.tsx` | Ortak komut başlığı, filtre, görünüm ve ekleme aksiyonu |
| Karar/özet yüzeyi | `PageHero`, `FinancePanel`, `FinanceMetric` | Birincil rakam ve karar bağlamı; domain hesabı içermez |
| Finans varlık kartı | `premium-entity-card` + route-specific content | Kimlik başlığı, tek ana değer kuyusu, kısa metrikler, opsiyonel aktivite ve ana aksiyon |
| Form ve aksiyonlar | `src/components/ui/input.tsx`, `button.tsx`, `card.tsx` | Ham form kontrolü yerine erişilebilir ortak primitive |

## Finans Kartı Anatomisi

Hesap, kredi kartı, altın lotu ve gelecekteki benzer finans varlıkları aynı
okuma sırasını izler:

1. Marka/tür rozeti + varlık adı + ikincil kimlik + menü.
2. Karttaki en önemli tek rakamı taşıyan geniş değer kuyusu.
3. En fazla iki-dört kısa destek metriği.
4. Gerekiyorsa son hareketler veya güven durumu.
5. Kartın birincil aksiyonu.

Karmaşık Hesap/kredi kartı yüzeyleri masaüstünde en fazla iki sütuna iner.
Daha kompakt lot kartları route ihtiyacına göre iki veya üç sütun olabilir;
`CrudPage.listGridClassName` bu yoğunluğu davranışı çatallamadan ayarlar.

## Route Şablonları

- Dashboard ve Hesaplar, ana kararı göstermek için sınırlı koyu imza kartı
  kullanır.
- Varlıklar, Borçlar ve Ödemeler hub'ları `HubNav` + `CrudPage` düzenini izler.
- Analiz ve Veri Sağlığı hub'ları `HubNav` + `PageCommandHeader` + domain
  panellerini izler.
- Alışveriş kararı ve alışveriş listesi, dar karar sayfası şablonunda ortak
  header ve form primitive'lerini kullanır.
- Login, masaüstünde marka imza paneli ve ayrı açık form kartı; mobilde tek form
  kartı olarak kalır.

## Responsive ve Erişilebilirlik

- Ana dokunma hedefi en az 44px olmalıdır.
- Hub navigation dar ekranda kırılmak yerine yatay taşar.
- Mobil ana navigasyon içerik üstüne binmemesi için safe-area boşluğu kullanır.
- İkon-only aksiyonların erişilebilir adı olmalıdır.
- Renk tek başına durum anlatmaz; metin veya ikonla desteklenir.
- `prefers-reduced-motion` altında dekoratif hareketler kapanır.

## Yeni UI Eklerken

1. Önce mevcut ortak primitive veya şablonun ihtiyacı karşılayıp karşılamadığına
   bak.
2. Domain hesabını component'e taşımadan yalnız sunum katmanını değiştir.
3. Yeni renk/radius/gölgeyi component içinde çoğaltma; gerekiyorsa `index.css`
   token veya semantik sınıf ekle.
4. Masaüstü ve 390px mobilde taşma, odak, loading, empty ve hata durumunu kontrol
   et.
5. `npm run lint && npm run test:unit && npm run build` kapılarını çalıştır.
