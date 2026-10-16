# Mürekkep ve Safir — uygulama ve görsel kontrol

16 Ekim 2026. Kullanıcı, telefon öncelikli UI/UX önerilerini ve Mürekkep ve
Safir yönünü ikonlarla birlikte onayladı. Yerel doğrulama tamamlandı;
kullanıcının canlıya alma onayıyla paket korumalı PR → CI → üretim yayın
hattından yayınlandı: [PR #258](https://github.com/enesgarip/financeproject/pull/258),
[başarılı production koşusu](https://github.com/enesgarip/financeproject/actions/runs/38882330501).
Sonraki ikon/dil ekleri #259/#260'tadır. Güncel README demo ekranları ve çekim
kaynağı `docs/screenshots/README.md`'de tutulur; aşağıdaki ölçümler ilk paketindir.

## Uygulanan kapsam

- Açık temada serin zemin/safir, koyu temada mürekkep/lacivert yüzeyler.
  Ana eylem mavi, pozitif finans hareketi ve başarı yeşil. Nötr grafik dolgusu
  metne taşınmaz; normal vade türü otomatik tehlike rengi taşımaz.
- Başlıklar daha okunur cümle düzeninde; ana tutar mobilde 36px tabanla
  kompakt, kuruşlar ve tutar gizleme korunur. Grafik kırılım etiketleri iki
  sütunda sarılır. Varlık açıklamasındaki tutar ve para birimi birlikte kalır.
- Lucide gezinme/işlem/bölüm ikonlarında ortak boyut/çizgi yaklaşımı;
  dekoratif ikonlar ekran okuyucudan gizlenir. Hesaplar için WalletCards,
  Plan için CalendarDays kullanılır. Harcama Kaydet/bekleme/başarı geri
  bildirimleri ikon ve metinle birlikte gösterilir.
- Yüzen FAB yerine alt gezinmeye bağlı Harcama ekle ve diğer işlemler
  alanı. Harcama görev ekranında yinelenen ekle satırı yoktur; form alanına
  odaklanınca mobil alt bar geri çekilir.
- `panel=manuel` toplam/listelerden önce doğrudan formu gösterir. Hesap,
  tutar, açıklama ve Kaydet öndedir; fiş/pano/son harcamalar/favoriler ve
  kart kıyasları açılır yardımcı bölümlerdedir. Validasyon ve mevcut yazma
  yolları korunur. Ekstre otomasyonu bu görünümde de bağlı kalır.
- Özet'te mobil yaklaşan üç vade ana tutarın ardından gelir; Öde/Tahsil et
  işaretleri görünür. Alacak ve bilinmeyen rezerv açıklamaları korunur.
- Hesap/kart listeleri kompakt toplamdan sonra; kırılım ve ortak limit
  yönetimi katlanır. Kart satırında açık ekstre varsa aynı kanonik kaynaktan
  kalan/vade, yoksa etiketli dönem içi tutar gösterilir. Doğrulanamayan
  ekstre sıfır olarak sunulmaz. Kart ayrıntısı nötr yüzeyde; ödeme eylemi
  dönem/limit/taksit dökümünden önce gelir.
- Ödemeler'de Yaklaşanlar/Takvim seçimi aynı projeksiyon ve ödeme çekmecesine
  bağlıdır. Görünüm `denge:payments-view` ile yerel tarayıcıda hatırlanır.
  Fatura özeti kendi dar kapsamını adlandırır; tüm takvimin temiz olduğunu
  iddia etmez.
- Basma 120ms, sayfa/ayrıntı 180ms, panel 240ms. Gecikmeli sıralı dashboard
  belirmesi kaldırıldı. Tutar değişiminde gerçek sayı hemen görünür; kısa
  zemin vurgusu yapılır. Azaltılmış hareket CSS tercihi korunur. İşlem
  menüsü aramaya otomatik odaklanmaz. Kapalı details öğeleri odak döngüsünden
  çıkarılır; summary dahil edilir.

## Kaynaklar

Tema/hareket `src/index.css`; ortak sayı/ton/kırılım `src/components/serit/*`.
Kabuk `src/components/Layout.tsx`, `BottomNav.tsx`, `QuickActions.tsx`.
Hesap/kart akışı `src/pages/CardsPage.tsx`, `.summary.tsx`, `.list.tsx`,
`.expense.tsx`. Takvim `src/components/finance/ObligationsCalendar.tsx`.
Finans hesabı, para biçimlendirme util'i, RPC, migration veya ledger
kurallarında değişiklik yoktur. Mevcut kayıt, ödeme ve otomasyon kaynakları
sunumdan ayrılmaya devam eder.

## Ölçümler ve tarayıcı kontrolü

Mevcut yerel Supabase demo hesabı kullanıldı; üretim hesabı veya fiziksel
telefon kullanılmadı. Bilinçli finans kaydı/ödeme/alım/satım yapılmadı.
Form geçerli tutar/açıklamayla açıldı, Kaydet'in etkinleştiği görüldü;
girdiler temizlenerek kaydetmeden geri dönüldü. Normal uygulama açılışındaki
yerel kur/net değer/ekstre otomasyonlarının çalışması engellenmedi.

| Kontrol | Sonuç |
| --- | --- |
| Varlık yüzde metni, açık | #59667a / #f5f7fb; 5,43:1 (önce 1,47:1) |
| Varlık yüzde metni, koyu | #abb8cc / #101623; 9,01:1 (önce 1,89:1) |
| Safir metin / kart zemini | Açık 6,16:1; koyu 7,30:1 |
| Koyu grafik paleti / yeni kart zemini | 14 slotun tamamı ≥3:1; en düşük 3,15:1. Kategori anahtarı/sırası korunur. |
| Özet, 390 × 844 | İlk vade yaklaşık y=332px; üç vade ilk görünümde (önce ilk vade yaklaşık y=848px) |
| Harcama formu, 390 × 844 | Tutar alanı yaklaşık y=337px (önce y=1.387px); hesap/açıklama/Kaydet ilk görünümde |
| Hesap ve kredi kartı listesi, 390px koyu | İlk kayıt görünür; kartta kalan ekstre ve tarih etiketli |
| Kart ayrıntısı, 390px koyu | Ekstre tutarı/vade ve ödeme eylemi ilk görünümde; dönem dökümü kapalı |
| Özet/Varlıklar, 360px açık | Belge yatay taşması yok; üç vade ve tutarlar okunur |
| Özet, 1280px açık | Belge yatay taşması yok; iki kolon ve masaüstü ödeme eylemleri korunur |
| İşlem menüsü, 360px açık | Açılış odağı kapsayıcıda; Shift+Tab kapalı Diğer işlemler summary'sine gider; Escape tetikleyiciye döner |
| Yaklaşanlar/Takvim, 390px açık | Görünüm değişir; 20 Ekim seçimi iki ekstreyi aynı ödeme eylemleriyle gösterir |
| Takvim gizlilik modu | Ay toplamı ve satır tutarları maskelenir; görünür 17.400,00 ₺ metni kalmaz |

Kontrast oranları gerçek tarayıcı renkleri ve WCAG göreli parlaklık
formülüyle hesaplandı. Ölçümler bu demo içerik/viewport içindir; tüm tutar
uzunlukları ve bütün ekran/durum kombinasyonları test edildiği iddia edilmez.
Fiziksel iOS/Android klavye, büyük sistem yazısı, VoiceOver/TalkBack ve tam
WCAG denetimi kapsam dışıdır. Azaltılmış hareket kuralı kaynakta korunur;
bu turda işletim sistemi tercihiyle ayrı fiziksel cihaz testi yapılmadı.

## Doğrulama

`npm run verify` başarılı: lint, 150 dosyada 1.634 test, coverage eşikleri,
üretim bağımlılık audit'i (0 açık), TypeScript/Vite build, bundle bütçesi
(toplam JS gzip 988,1 kB / 1.030 kB) ve altı edge fonksiyonunun tip kontrolü.
`git diff --check` temiz.

Yeni davranış regresyonları:

- `src/components/finance/ObligationsCalendar.view.test.tsx`: varsayılan görünüm,
  kanonik ödeme argümanı, görünümün hatırlanması, takvim günü ve gizlilik.
- `src/components/ui/use-dialog-a11y.test.tsx`: kapalı/açık details odak
  döngüsü ve Escape ile odağın geri dönmesi.

Ekran kanıtları ve tam verify çıktısı repo dışında bu sohbetin yerel görsel
klasöründedir (`safir-*.jpg`, `safir-verify.log`); demo finans görüntüleri
kaynak depoya eklenmedi. Kaynak sözleşmeler aynı değişiklikte güncellendi:
UI_ARCHITECTURE, AI_CONTEXT_INDEX, BACKLOG, CARDS_ARCHITECTURE,
DASHBOARD_ARCHITECTURE ve CARD_DEBT_TRANSITIONS.
