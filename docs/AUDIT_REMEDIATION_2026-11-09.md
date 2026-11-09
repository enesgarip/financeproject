# Denetim düzeltmeleri ve yayın — 9 Kasım 2026

Kullanıcı tüm doğrulanmış maddelerin düzeltilmesini ve canlıya alınmasını
istedi. Kaynak raporlar: mantık M01–M23, görsel V01–V07, form F01–F05;
T01 test bakımı. U01 gerçek telefondaki navbar belirtisi ayrıca izlenir.

## Uygulama ve doğrulama durumu

- [x] M01 ana kayıt sonrası hata / aynı kimlikle devam
- [x] M02 rezerv ayırmada kalıcı idempotent niyet
- [x] M03 eksik/hatalı veriyle karar üretmeme
- [x] M04 gelecek ay tampon + rezerv tabanı
- [x] M05 tam hedef referansları / çözüm güveni
- [x] M06 bütün birimlerde ve metinlerde gizlilik
- [x] M07 kredi taksit okuma hata durumu
- [x] M08 bütçe/maaş cache matrisi
- [x] M09 ay kapanışı tam erişim kapsamı
- [x] M10 tam geçmiş sayfalama
- [x] M11 TL toleransı korunarak birim bazlı hedef karşılaştırması
- [x] M12 manuel hareket/transfer/al-sat idempotency
- [x] M13 native sayı alanlarının ondalık semantiği
- [x] M14 miktar projeksiyonu hassasiyeti
- [x] M15 altın yönü ve başarılı senkron anahtarı
- [x] M16 altın tüm envanter zinciri / sunucu yazma koruması
- [x] M17 katkılı değer niyeti idempotency
- [x] M18 satır içi taslak koruması
- [x] M19 geçersiz para girişini sıfır saymama
- [x] M20 devam eden sohbet / temizleme koordinasyonu
- [x] M21 başlangıç tercihlerinde engelli depolama
- [x] M22 sessiz kredi planı kesintisini kaldırma
- [x] M23 restore belirsiz sonucu ve güvenli doğrulama
- [x] V01 büyük bütçe tutarında responsive düzen
- [x] V02 grafikte seçili birim
- [x] V03 seçili seriden fark ve uç değerler
- [x] V04 uzun bakım satırında görünür eylemler
- [x] V05 ay kapanışı kontrastı
- [x] V06 ana dokunma alanları
- [x] V07 ayrık ikon hedefleri
- [x] F01 kalıcı tetikleyiciye odak dönüşü
- [x] F02 gönderim ve form oturumu kapanışı
- [x] F03 form bazında dirty kapsamı
- [x] F04 modal / iç kaydırmada jest izolasyonu
- [x] F05 iptal edilen jestin temizlenmesi
- [x] T01 güncel canlı test seçicileri ve fixture temizliği
- [ ] U01 gerçek telefonda navbarın ortada kalması: birebir yeniden üretim yok; açık tanı sınırı

Takip düzeltmesi: `CrudPage` aynı gezinme kaydındaki `?new=1` isteğini bir
kez tüketir. URL değiştirme işlemi tamamlanmadan gelen render önceden formu
tekrar açabiliyordu. İptal sonrası formun kapandığı ve sayfa kaydırma kilidinin
kalktığı mevcut Playwright senaryolarıyla doğrulanır.

## Yayın kapıları

- [x] `npm run verify`
- [x] Temiz yerel migration/seed, gerçek SQL suite, şema/RLS/grant denetimi
- [x] Gerçek dump/restore ve ilgili finans API akışları
- [x] Chromium + WebKit form/karar/görsel kabul testleri
- [x] Güncel backlog, context index, domain ve tamamlanan audit kayıtları
Yayın kapıları bu commit sonrasında PR'ın yeşil CI/merge kaydı ve main
production workflow'undaki backup/migration/promote/smoke sonuçlarından izlenir.
Bu belge yayın sonucunu önceden başarılı ilan etmez.

Yayın mevcut GitHub Actions hattıyla yapılır; ikinci bir manuel Vercel deploy'u
oluşturulmaz. Değişiklikler veri kaybı üreten geçmiş düzeltmesi içermez;
makbuzlar ve ledger geçmişi korunur. U01, gerçek telefon kanıtı olmadan
“yeniden üretildi/çözüldü” diye işaretlenmez.

## Kabul kanıtı ve sözleşme

- `npm run verify`: 1947 test / 192 dosya; coverage statements %93,39,
  branches %86,16, functions %94,84, lines %95,37; prod audit 0 açık;
  build + 1060 kB toplam ve 22 kB entry bütçeleri + 6 edge tip kontrolü.
- `npm run db:seed:local`, `npm run db:test:all`: 60/60 SQL dosyası.
  `audit_operations_and_gold.sql`: beş para yazma yolu ve restore için aynı
  UUID replay/no-op, değişen payload reddi, kesin hatanın rollback'i, yeni
  bilinçli ayırma, 4 haneli gram, alım silme/tarih değişiminde stok reddi,
  deferred toplu yükleme ve restore retry sırasında yeni kaydın korunması.
- `npm run db:lint:local`: hata yok. SQL suite RLS ve grant denetimini içerir.
  `npm run db:test:twins`: iki gerçek SQL↔TS karşılaştırma testi geçti.
  `node scripts/test-backup-restore.mjs`: gerçek dump/restore, makbuz,
  yetkiler ve ödeme retry'sı geçti.
- Canlı **yerel** Supabase hedef kaynakları: 2/2; güncel etiket ve her test
  sonrası yalnız kendi rastgele önekli hedef/kova fixture'ını temizleyen
  afterEach (hatalı assertion'da da çalışır). Sonrasında 0 test hedefi/kova.
- `tests/e2e/audit-remediation.spec.ts`: dokuz CRUD ailesinde iptal/nav,
  kalıcı menü tetikleyicisi, pending X/Escape, farklı formun kirli taslağı,
  modal jesti/touchcancel, 320/390px bütçe/bakım, gram trend/gizlilik,
  rezerv hata durumunda kararın durması, açık/koyu kontrast ve PDF busy.
  Mobil iki motor: `npx playwright test --config=playwright.audit.config.ts`.

İşlem niyeti kullanıcı+işlem+kaynak kapsamındadır; UUID ve kanonik payload
hash'i istekten önce kalıcı saklanır. Storage engelliyse para isteği çıkmaz.
Kayıp yanıtta niyet korunur; farklı alanlar yeni UUID oluşturamaz. Ortak
inceleme alanı aynı isteği doğrular. Restore payloadı cihazda saklanmaz;
aynı dosya yeniden seçilerek hash doğrulanır. Sunucuda yalnız UUID/hash,
mevcut özel ödeme makbuzu tablosunda domain yazmasıyla tek transaction'da
saklanır. Reset/restore bu makbuzları korur. Eski domain RPC'leri korunur;
yeni istemci belirsiz sonuçta eski, makbuzsuz yola düşmez.

Altın stoğu tarihsiz açılış → tarih → aynı gün alış önce → created_at/id
sırasıyla her tür için ayrı denetlenir. TS ve deferred SQL constraint aynı
kuralı kullanır. Geçmiş otomatik değiştirilmez. Assets.amount numeric(24,8),
altın kaynak toplamı dört hanelidir; para hâlâ money.ts/kuruş yolundadır.
TRY hedefindeki eski 1 kuruş toleransı korunur, gram/çeyrek buna tabi değildir.

WebKit ek kabul turunda odaklı alanın DOM'dan çıkışında focusout gelmeden
menünün gizli kalması görüldü; QuickActions DOM değişiminde de odak durumunu
yeniler. Bu bulgu U01'in gerçek telefondaki orta ekran belirtisiyle aynı
sayılmadı. Gerçek soft keyboard/PWA/yön değişimi fiziksel cihaz doğrulaması
halen gereklidir.

Yayın: korumalı main'e PR/CI/merge; otomatik DB yedeği, migration, staged
frontend promote ve /login smoke. Smoke hatasında mevcut pipeline önceki
frontend'e döner. Migration geriye uyumlu RPC ekler ve miktar hassasiyetini
genişletir; ledger satırları değiştirilmez. Üretime ikinci elle deploy yok.

Tarayıcı son kabulü: mobil Chromium/WebKit 42/42; genel Chromium 76 geçti,
4 varsayılan live-only test atlandı (iki hedef kaynak live testi ayrıca 2/2).
Görsel kanıt: `docs/audit-evidence/2026-11-09/README.md`.
