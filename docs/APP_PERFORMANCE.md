# Uygulama çalışma zamanı performansı

Last reviewed: 2026-10-16

## 16 Ekim 2026 — Uygulanan paket

- `src/App.tsx` bütün `Routes` ağacını pathname ile yeniden kurmaz. Layout,
  tema/gizlilik sağlayıcıları ve günlük snapshot zamanlayıcısı sayfa geçişinde
  korunur. Sayfanın `PageTransition` anahtarı ve lazy/Suspense sınırı sürer;
  ayrılan sayfanın form durumu yeni açılışa taşınmaz.
- `src/pages/CardsPage.hooks.ts` detay verilerini kullanıcıya özel
  `src/app/cardPageDataKey.ts` prefix'i altında TanStack Query ile tutar.
  Global tazelik 30 sn, bellekte tutma süresi 30 dk; süresi geçen veri sonraki
  açılış/odaklanmada yenilenir. Oturum yokken sorgu çalışmaz.
- Ekstre + kısmi ödemeler tek query sonucu olarak yayımlanır. Gerçek ödeme
  sorgusu hatası boş ödeme sayılmaz; eski ortamın eksik tablo uyumluluğu korunur.
  Taksitlerin 500'lük tam sayfalaması, tüm açık + son 24 ödenmiş ekstre kapsamı
  değişmez. Yüklenmemiş/hatalı toplam doğrulanmış sıfır gösterilmez.
- Hesaplar görünümünde kart taksitleri/provizyon/karşılaştırmalar yüklenmez.
  Ekstre kesim adayı varsa arşiv kontrolü yine çalışır: önce mevcut kart
  alanlarıyla `canCutCurrentStatement`, sonra gerçek arşivlerle mevcut
  `DueStatementAutomation`. Otomatik kesim doğrudan hesap/harcama açılışında
  atlanmaz; sorgu hatasında boş arşivle kesim başlatılmaz.
- Kredi bölümünde özet için ekstre/taksitler, provizyon dökümünde provizyonlar,
  seçili kart ayrıntısında karşılaştırmalar yüklenir. CrudPage ile kart listesi
  aynı anahtarı paylaşır; ek observer ikinci HTTP isteği oluşturmaz.
- `useInvalidateFinanceSnapshot` para hareketlerinden sonra kart detay cache'ini
  de geçersiz kılar. Aktif detaylar yenilenir; kapalı query sonraki etkinleşmede
  tazelenir. Bakım gerçekten satır değiştirdiyse kart listesi/detayları da yenilenir.
  Veri sağlığı düzeltme/geri alma/ödeme/karşılaştırma işlemleri ortak snapshot
  ve kart listesi/detay cache'lerini yeniler. Geri yükleme girişimi (kısmi yazma
  olasılığı dahil) ve başarılı sıfırlama paylaşılan query'leri geçersiz kılar.
  Salt okunur veri sağlığı taraması cache'i gereksiz yere geçersiz kılmaz.
- `src/components/ui/deferred-details.tsx` taksit düzenleme, taksit niyeti,
  ortak limit, kart kayıt geçmişi ve banka ayrıntılarındaki çocukları ilk açılışa kadar kurmaz.
  İlk açılıştan sonra kapanıp açılınca form taslağı korunur ve yükleme tekrarlanmaz.
  Başlangıçta açık ledger hemen kurulur. Yerel `details/summary` klavye davranışı
  korunur. PDF modalları ve PDF motoru önceki gibi ihtiyaç anında yüklenir.

## Karşılaştırma

Üretim Vite build'i, yerel Supabase demo hesabı; Chromium, 1320×900, 4× CPU
yavaşlatma, 100 ms gecikme, 1,6 Mbps indirme. Service worker kapalı, dış ağ
engelli. Her adımda bekleyen isteklerin bitmesi ve en az 700 ms ağ sessizliği
beklendi. Akış: giriş → Özet → Hesaplar → Analiz → Plan → Özet → Hesaplar → Analiz.

| Ölçüm | Önce | Sonra |
| --- | --- | --- |
| Hesaplar ilk giriş, Supabase HTTP isteği | 7 | 4 |
| Hesaplar kısa dönüş, Supabase HTTP isteği | 6 | 0 |
| Özet / Analiz kısa dönüş, Supabase HTTP isteği | 0 / 0 | 0 / 0 |
| Kabuk DOM'unun korunduğu SPA geçişi | 0 / 6 | 6 / 6 |
| Girişte sıkıştırılmış JavaScript | yaklaşık 192 KiB | yaklaşık 192 KiB |
| Bu akışta PDF motoru indirildi mi? | Hayır | Hayır |

Demo kartı kesim adayı olduğu için ilk Hesaplar girişinde kart listesi + iki
arşiv + kısmi ödemeler olmak üzere dört istek gereklidir. Aday olmayan normal
hesap görünümünde yalnız kart listesi gerekir. Taksit düzenleyicisi kapalıyken
harcama sorgusu yok; ilk açılışta bir harcama sorgusu, tekrar açılışta yeni istek yok.
Gizlilik seçimi altı geçişte korundu; tarayıcıda yakalanmamış JS hatası görülmedi.

Bunlar yerel demo ölçümleridir; üretim gecikmesi veya büyük veri geçmişi için
hız yüzdesi iddiası değildir. Tek örnek CPU süreleri kararlı benchmark sayılmaz.
Finans formülleri, RPC/ledger/şema ve tarihsel veri kapsamı değiştirilmedi.

## Doğrulama ve geri dönüş

Regresyonlar: `src/App.test.tsx`, `src/pages/CardsPage.data.test.tsx`,
`src/components/ui/deferred-details.test.tsx`, `src/pages/DataHealthPage.cache.test.tsx`. Cache tazeliği/kullanıcı ayrımı,
aktif ve kapalı query invalidation'ı, kısmi ödeme hatası, eksik tablo uyumluluğu,
doğrudan Hesaplar açılışında kesim adayı, kabuk sürekliliği ve form durumu kapsanır.
Tam kapı `npm run verify`; tarayıcı smoke `npm run test:e2e`.

Yerel doğrulama: verify başarılı (153 Vitest dosyası / 1.655 test + dört Node
guard; coverage %92,91 statement / %84,46 branch / %94,04 function / %95,04 line;
production audit 0 açık; build, bundle ve altı edge tipi). Varsayılan Playwright
10 geçti / canlı backend gerektiren üç test koşuluyla atlandı.
`tests/e2e/money-mutation.spec.ts` güncel İşlem → Harcama ekle ve alan adlarına
taşındı; ayrıca yerel gerçek Supabase ile geçti: yeni test kartına 500 TL harcama,
SPA Plan/Hesaplar dönüşünde güncel borç, aynı kabuk DOM'u ve açılan ledger'da
borç artışı doğrulandı. Üretim finans verisinde test yazması yapılmadı.

Yayın mevcut `docs/PIPELINE.md` hattından yapılır. Giriş/sayfa geçişi bozulursa
veya ödeme sonrası kart tutarı yenilenmezse önceki başarılı production build'e
geri dönülür; şema değişikliği olmadığı için veri geri taşıması gerekmez.
