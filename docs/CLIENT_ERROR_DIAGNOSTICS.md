# İstemci hata teşhisi

20 Ekim 2026: `lib/errorReport.ts` kendi Supabase `client_errors` tablosuna teknik
olay yazar. Üçüncü taraf hata servisi veya yeni servis anahtarı gerekmez.
Finans kayıtları, bakiyeler ve ledger bu akışa dahil değildir.

## Yakalanan olaylar

- `error`: JavaScript hatası; dosya, 1 tabanlı satır/sütun, varsa hata izi.
- `boundary`: React çökmesi; hata izi, bileşen izi ve neden zinciri.
- `unhandledrejection`: karşılanmamış Promise; Error dışı nesnelerde yalnız
  name/message/code/cause/errors teknik alanları, sınırlı derinlik.
- `resource`: script, stylesheet veya görselin yüklenememesi; kaynak adresi.
- `security`: CSP ihlali; yönerge, engellenen adres ve varsa kaynak konumu.
- `network`: fetch bağlantı hatası veya HTTP başarısızlığı; yöntem, sorgusuz
  teknik adres, durum, süre, varsa `sb-request-id` / `x-vercel-id`. İptal edilen
  AbortError raporlanmaz; özgün response/error çağırana aynen döner.

`diagnostics` nesnesi olayın gerçek yakalanma zamanını, rastgele oturum kimliğini,
bağlantı/görünürlük durumunu, dili, viewport'u, PWA modunu, service worker
kontrolünü ve son 20 teknik olayı taşır. Gezinme, etkileşim türü, bağlantı ve
istek sonucu bağlamı vardır. `created_at` sunucu kayıt zamanıdır; kuyrukta
bekleyen olay için `captured_at` kullanılır. Sürüm `commit_sha` alanındadır.

## Veri sınırı

İstek/yanıt gövdeleri, header'lar (iki teknik request-id hariç), cookie,
localStorage, form değerleri, DOM metinleri ve console payload'ları toplanmaz.
URL kullanıcı/parola/sorgu/hash bölümleri atılır; sayfa yolundaki tanımsız
segmentler `:param` olur. Teknik API tablo/RPC adı ve build asset adı korunur.
`lib/errorDiagnostics.ts` bilinen token, parola, e-posta, IBAN, UUID, uzun
numara, TL/döviz tutarı ve Postgres satır ayrıntısı kalıplarını maskeler.
Serbest hata mesajlarında keyfi kişisel metni kusursuz tanımak mümkün değildir;
yeni hata mesajlarına kullanıcı/veri payload'ı eklenmemelidir. Oturum kimliği
kullanıcının auth token'ı değildir. Kopyalanan rapora `user_id` eklenmez.

## Gönderim ve kapsam sınırları

Mesaj bazlı günlük dedupe kaldırıldı: farklı konum/ekran/sürüm/hata izleri ayrı
fingerprint üretir; tekrarlar da ayrı olay olarak saklanır. Aynı raporun
taşıma retry'ı UUID + INSERT ON CONFLICT DO NOTHING ile çoğalmaz. UPDATE yetkisi
yoktur. Mevcut own-row RLS okuma/yazma/silmeyi kullanıcıyla sınırlar.

Oturum başına en çok 50 olay, bellekte en çok 20 bekleyen olay ve olay başına
en çok üç gönderim denemesi vardır (ilk deneme + 5/10 saniye). Kuyruk çevrimdışı
durumda bekler, online/görünürlük/oturum olayıyla yeniden denenir. Hesap değişimi
kuyruğu ve bağlamı temizler; başka kullanıcı adına gönderilmez. Girişsiz olaylar
saklanmaz; ilk auth durumu gelmeden yakalananlar yalnız ilk oturum varsa gönderilir.
Kuyruk diske yazılmaz: sekme kapanması, kalıcı bağlantı sorunu veya sınır aşımı
kayıp yaratabilir. Liste bu nedenle kesin hata sıklığı sayacı değildir.
Bağlam UTF-8 boyutuyla sınırlandırılır; SQL 32 KiB JSON nesnesi sınırı uygular.
Başlangıçta en iyi çabayla 90 günden eski kendi kayıtları silinir.

Üretimde dinamik import hemen başlatılır; eski sabit üç saniye gecikmesi yoktur.
Dinleyiciler yüklenmeden önceki bootstrap hataları, importun hiç yüklenememesi,
tarayıcı/işletim sistemi kapanması ve engellenen ağ tam olarak yakalanamaz.
Tarayıcının cross-origin güvenliğiyle gizlediği `Script error.` olaylarında
`opaque=true` yazılır; kaynak ve hata izi sonradan üretilemez. Bu durumda olay
sırasındaki tarayıcı konsolu veya kontrollü yeniden üretim gerekir.

## İnceleme ve kaynak koduna dönme

Bakım → İstemci hataları son 7 günün en yeni 50 kaydını gösterir. Her kaydın
**Teşhis ayrıntıları** bölümü hata izi, tarayıcı ve teknik bağlamı açar;
**Teşhis raporunu kopyala** JSON raporu panoya alır. Eski kayıtların mevcut
stack/user_agent alanları da görünür; yeni bağlam yoksa açıkça belirtilir.
Temizle yalnız hata kayıtlarını siler, finans verisini değiştirmez.

`npm run build` hidden source map üretir; `scripts/archive-source-maps.mjs`
haritaları public `dist/assets` dışına `.diagnostics/source-maps/<release>`
altına taşır. Manifest bundle adı + SHA-256 içerir. Yerelde release `local`,
GitHub'da tam `GITHUB_SHA`'dır; hata kaydındaki ilk 12 karakterle eşleştirilir.
Production workflow staged yüklemeden **önce** hem dist hem Vercel static çıktıda
map bulunmadığını doğrular; eşleşen `client-error-maps-<sha>` artifact'ını
90 gün saklar. Erişim depo/Actions izinlerini izler; repo herkese açıksa artifact
erişimi de depo politikasına bağlıdır. Haritalar uygulama web sunucusuna verilmez.

Doğru release artifact'ını indir; hata izindeki asset adının map dosyasını ve
1 tabanlı satır/sütunu kullan:

```bash
node scripts/trace-client-error.mjs .diagnostics/source-maps/local/DashboardPage-HASH.js.map 1 12345
```

Sonuç özgün kaynak dosyası:satır:sütundur. Başka sürümün haritasıyla çözümleme
yapma. Yeni arşiv geçmiş sürümler için geriye dönük harita oluşturmaz.

## Kanıt

`lib/errorDiagnostics.test.ts`, `lib/errorReport.test.ts`,
`tests/guards/source-maps.guard.test.mjs`, `components/finance/ClientErrorsPanel.test.tsx`;
gerçek DB: `supabase/tests/client_error_diagnostics.sql`.
`tests/e2e/client-error-diagnostics.spec.ts` yalnız loopback production preview
ve seed yerel Supabase ile gerçek hata → DB → panel → pano zincirini çalıştırır.
`PLAYWRIGHT_BASE_URL`, `DIAGNOSTICS_LOCAL_API`, `DIAGNOSTICS_LOCAL_ANON_KEY`
yerel ortama verilir; bu koşullar yoksa yazma testi atlanır. Yerel anon key
`supabase status -o env` üzerinden alınır; üretim adresi kullanılmaz.
