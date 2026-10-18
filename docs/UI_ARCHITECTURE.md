# UI Architecture

Last reviewed: 2026-10-18

Kredi kartları özetinde “Borç kırılımı ve dökümler” `DeferredDetails`
katmanında, toplam yükün ardından “Önümüzdeki 3 ay · tüm kartlar” bulunur.
Ayrı bir açılır bölüm yoktur. Borç kırılımının ilk açılışında snapshot sorgusu kurulur;
aylık toplam ve dönem içi/taksit/abonelik-talimat kırılımı gösterilir.
Mobilde ay ve tutar ayrı satırlara geçer; kırılım sarılır, tutar kırpılmaz.
Kesim ayı/son ödeme ayı ayrımı, kapsam eksikleri ve tahmin sınırı görünürdür.
Hata/eksik veri sıfır sayılmaz; toplam ve kırılım ortak gizlilik maskesindedir.

18 Ekim alt menü eki: Alınacaklar, Bütçe ve hedefler, Hisseler ve Bakım
sekme ve sayfa başlıklarında ortak adlardır. Bulgular ve ana menü korunur.
`navigation.ts` tek ad kaynağıdır; Plan araçları etiketi yeniden adlandırmaz.
Uzun Bütçe ve hedefler sekmesi mevcut yatay kaydırma davranışını kullanır.
Dil sözleşmesi: `docs/UI_GLOSSARY.md`; rotalar ve finans hesapları değişmez.

Abonelik satırında ay etiketli eşleşme durumu ve banka işlem tarihi/gerçek
tutar görünür; Ödemeler'de takvim ayı, Analiz'de bu ay kullanılır. Aylık kart
talimatında manuel ödeme düğmesi yerine otomatik takip vardır. Plan tutarı,
eşleşme tutarı ve sıradaki ödeme metni gizlilik tercihine uyar. Kaynak:
`components/finance/PaymentMatchStatus.tsx`, `docs/FINANCE_RULES.md`.

Sayfa geçişlerinde Layout ve tema/gizlilik sağlayıcıları korunur; yalnız
sayfa geçiş sınırı yenilenir. `components/ui/deferred-details.tsx` veri çeken
ikincil panelleri ilk açılışa kadar kurmaz, sonra kapatıp açınca taslağı korur.
Native details/summary klavye davranışı ve başlangıçta açık ledger sürer.
Çalışma zamanı ölçümü ve kaynaklar: `docs/APP_PERFORMANCE.md`.

GitHub README'leri güncel Mürekkep ve Safir tasarımını gösterir. Demo görselleri
ve tekrar çekim kaynağı: `docs/screenshots/README.md`. Tarihsel audit ekranları
mevcut uygulamanın görsel sözleşmesi yerine kullanılmaz.

Bu belge uygulamanın görsel kaynak gerçeğidir. Finans kurallarını veya veri
erişimini tanımlamaz; route ve component'lerin aynı **Şerit / Mürekkep ve Safir** görsel dilinde
kalmasını sağlar. Şerit 2026-08-10/11'de tüm uygulamaya uygulandı (PR #108,
#112; tarihçe için `docs/BACKLOG.md` Ş0–Ş15 günlüğü). Kaynak gerçeği kod:
`src/index.css` (token'lar), `src/components/Layout.tsx`, `BottomNav.tsx`,
`HubNav.tsx`, `QuickActions.tsx`, `src/components/serit/*`.

## Güncel görsel sözleşme — 16 Ekim 2026

Kullanıcı onaylı yön Mürekkep ve Safir'dir. Şerit'in çizgi listesi, tek ana
tutar, kuruş hassasiyeti ve gizlilik kuralları korunur. Ana eylem safir mavisi,
başarı/pozitif finans hareketi yeşil; tehlike kırmızı, uyarı kehribardır.
Dolgu için kullanılan nötr grafik rengi metinde kullanılamaz: `SERIT_TEXT`
nötr/idle/accent tonlarını okunur `--ink-*` değerlerine bağlar.

Özet'te mobil yaklaşan üç ödeme ana tutarın hemen ardından gelir; Öde/Tahsil et
metni ve yön ikonu eylemi açıklar. Tahsil edilmemiş alacak ve doğrulanamayan
kasa rezervi açıklamaları görünür kalır. Hesaplar listesi kompakt toplamdan
sonra gelir; kırılımlar kapalı ayrıntılardadır. Kart satırında açık ekstre varsa
kalan tutar ve vade, yoksa dönem içi tutar etiketlenir. Sorgu belirsizliği
sıfır gibi gösterilmez. Kart ayrıntısında açık ekstre/vade/eylem, dönem-limit
dökümünden önce gelir; banka kimliği küçük logo ile korunur.

`/kartlar?section=kartlar&panel=manuel` doğrudan harcama görev ekranıdır.
Hesap, tutar, açıklama ve Kaydet önce gelir. Fiş/pano/tekrar/favoriler ve kart
kıyasları gerektiğinde açılır. Kayıt ve validasyon aynı repo/RPC'leri kullanır.
Ödemeler'de Yaklaşanlar varsayılandır; Takvim seçimi `denge:payments-view`
ile yerel tarayıcıda hatırlanır. Her iki görünüm aynı kanonik yükümlülükleri
ve ödeme eylemini kullanır; kapalı ek bilgiler hesapları değiştirmez.

İkonlar Lucide çizgi ailesindedir: gezinme 21px/1,8 (aktif 2,1), ana işlem ve
bölüm ikonları 18–20px/1,8. Dekoratif ikon `aria-hidden`, ikon düğmesi açık
erişilebilir ad taşır. Hesaplar WalletCards, Plan CalendarDays kullanır.
Nötr gezinme, araç, yardım ve boş durum ikonları safirdir. Yardım işareti
Unicode karakter yerine Lucide Info'dur. Durum ikonları başarı/uyarı/tehlike
anlamını, banka logoları kurum kimliğini korur. Marka SVG'si `public/icon.svg`;
iOS 180px ve PWA 192/512px PNG'leri aynı SVG'den üretilir. Favicon, uygulama
markası, manifest ve push ikonu `?v=sapphire-20261016` kullanır. Tarayıcı/PWA
bandı açık `#f5f7fb`, koyu `#101623` değerlerini tema tercihiyle izler.
Masaüstü giriş tanıtım paneli global tema token'larını miras alır; yerel
`--primary` override'ı kullanamaz. Sabit tanıtım tutarları açıkça örnektir;
safir zemin üzerindeki küçük beyaz etiketler okunur kalır.
Mobil alt bar etiketli Harcama ekle ve diğer işlemler düğmesini içerir; form
girişinde yinelenen ekle satırı gösterilmez. Yüzen FAB kaldırılmıştır.

Hareketler: basma 120ms, sayfa/ayrıntı 180ms, panel 240ms. Dashboard'da
gecikmeli sıralı belirme yoktur. Tutar değişince gerçek değer hemen görünür;
yalnız kısa zemin vurgusu yapılır. Azaltılmış hareket tercihi korunur. İşlem
menüsü aramaya odaklanıp klavye açmaz; odak içeride tutulur ve kapanınca geri
verilir. Kapalı details içindeki öğeler odak döngüsüne dahil edilmez.

Uygulama/kanıt kaydı: `docs/UI_SAPPHIRE_2026-10-16.md`.
İkon ve metin eki: `docs/UI_ICON_COPY_2026-10-16.md`. `LineRow` mobilde
ad/açıklamayı tam genişlikte, tutar/eylemi altta gösterir; masaüstünde yan yana
kalır. Kritik ad, tutar ve işlem açıklaması ellipsis/line-clamp ile gizlenmez.
Plan sekmesi “Ödemeler”dir; Yaklaşanlar ve Takvim onun iki görünümüdür.
Yedi günlük kayan pencere “Önümüzdeki 7 gün”, gelir satırında maaş “Maaş”
diye adlandırılır. Karşılaştırma sonucu kaydı ile borç düzeltme ayrı eylemlerdir.

## Şerit İlkeleri

### Para gösterimi (2026-09-09)

`formatSeritParts` / `formatSeritAmount` başlık ve liste tutarlarını varsayılan
iki ondalık basamakla, Türkçe ayraçlarla ve sembol sonda gösterir:
`12.480,62 ₺`, `500,00 ₺`. Kuruşlar tam TL'ye yuvarlanmaz. Açık `decimals: 0`
seçeneği ve grafik/takvim için `formatCompactCurrency` kısa gösterimi korunur.
Bu bir sunum kuralıdır; finans hesaplarını ve saklanan tutarları değiştirmez.

### Arayüz dili (2026-09-05)

Kişiler ekranı (2026-10-13) iki bölüm sunar: Borç / alacak ve Sadece takip.
`section=takip` bilgi amaçlı kayıtlara doğrudan gider; kişi toplamları nötr
çizgi listesinde, kayıtlar tarih sırasıyla gösterilir. Tutar gizleme hem
kayıt hem toplamı kapsar. Finansal kapsam `docs/FINANCE_RULES.md` içindedir.

Kaynak ve uygulama listesi: `docs/UI_COPY_REVIEW.md`. Kısa/doğal Türkçe ve
mevcut “sen” hitabı kullanılır. Başlıklar cümle düzeninde, düğmeler eylemle
yazılır. Gider bağlamının kullanıcıya görünen adı “Gider grubu”; DB anahtarı
ve rota değişmez. “Detay” sayfası “Ayrıntılı analiz”, sekmesi “Ayrıntılar”dır.
Kelime/işlem sözleşmesi `docs/UI_GLOSSARY.md`'dir. “Ödeme kaydet” ve
“Tahsilat kaydet” kayıt formunu açar; son düğme “Ödemeyi/Tahsilatı kaydet”tir.
Uygulamanın bankadan para göndermediği ortak formda açıkça söylenir. “Ödendi
say” nakit hareketi oluşturmayan ayrı geçmiş işaretleme eylemi olarak korunur.

Finans rakamlarında hesap bakiyesi, kart borcu sonrası bakiye, bu ay
harcanabilir tutar ve net değer ayrı kavramlardır. Analizde “Gelirden kalan”,
beklenen gelir eksi kaydedilen ödemedir; yakın açıklama zorunludur. Ay kapanış
başlıkları başarı iddiası yerine kontrol konusunu söyler. Karar ekranı
modelin sınırını açıklar; “Plana göre uygun” kesin alışveriş tavsiyesi değildir.
Kart/nakit açıklaması seçime uyar. Kritik açıklama yalnız hover'a bırakılmaz;
uzun etiket ve kontrol ayrıntısı satıra yayılır. Finans hesapları bu metin
düzenlemesiyle değişmemiştir.

1. **Ayrımı önce çizgi yapar, kart hak edilir.** Varsayılan ayrım 1px çizgi
   (`--line`, `--line-strong`) ve zemin tonudur (`--page` / `--raised`);
   tekil ayıraç için `serit/Divider`. Kart bir *biçim* değil bir *iddiadır*:
   "bu blok kendi başına duran bir şey". Üç meşru gerekçesi vardır — başka
   gerekçeyle kart açılmaz:

   | Biçim | Ne zaman | Örnek |
   | --- | --- | --- |
   | Çizgi listesi (`LineGroup`) | Homojen, karşılaştırmalı satır verisi | Hesap listesi, taksit dökümü, ekstre satırları |
   | Kart (`ui/card`) | **Bağımsız nesne** — kendi kimliği ve aksiyonu var | Araç, kredi, tasarruf hedefi, kredi kartı |
   | Kart (`ui/card`) | **Aksiyon/araç bloğu** | Form, import sihirbazı, "Alsam mı?" hesaplayıcı, ayar paneli |
   | Kart (`ui/card`) | **Grafik bloğu** | Chart + efsane |

   Kartın görüntüsü: `bg-raised` + 1px `line-strong` + **tek kademe hafif
   gölge** (`--shadow-card`). Gölge ayrımı yapan şey değil, bloğu zeminden bir
   tık ayıran şeydir; ikinci kademe YOK. Kart içinde kart olmaz — iç blok
   `variant="flat"` (gölgesiz) ya da çizgi listesi olur. Bir bölüm ya çizgi
   listesidir ya kart ızgarası; ikisi aynı bölümde karışmaz.

   (2026-08-20 revizyonu. Öncesinde kural mutlak "kart yok, gölge yok" idi;
   kaynağı `design_handoff_denge_redesign/CLAUDE_CODE_KOMUTU.md` 3. aşama
   komutuydu. Sonuç: dönüştürülmeyen 59 dosya eski shadcn dilinde kaldı ve
   uygulamada üç lehçe bir arada yaşadı. Kart bileşeni tek yerde —
   `components/ui/card.tsx` — `serit/` ailesinde kart YOKTUR.)

2. **Renk yalnız sinyal.** Nötr satırlar `ink` rengindedir; bir satır
   kırmızıysa gerçekten acildir. İzin verilen sinyal kümesi
   `src/components/serit/tone.ts`'te kapalıdır (`SERIT_FILL`/`SERIT_TEXT`,
   `SeritTone`); ekranlar kendi kırmızısını icat etmez. Tek istisna kimlik
   rengi: kompozisyon dilimleri (kategori, varlık sınıfı) sinyal değil kimliktir
   ve `--viz-*` paletini kullanır (bkz. Grafik Rengi).
3. **Her ekran tek soruyu cevaplar.** Cevap, ekranın en üstündeki tek
   `HeroNumber` (dev mono rakam). Hub sekmeleri (`HubNav`) kahraman rakamın
   üstünde durur.
4. **Liste = çizgi, kart değil.** Satırlar `LineGroup` içinde 1px ayıraçla
   gruplanır; baskın biçim zeminsiz `plain`. Grup dışındaki tekil ayrım
   (bölüm sonu, form grubu, modal altlığı) `serit/Divider` ile çizilir —
   elle `border-t border-line` yazılmaz.
5. Finansal rakamlar `.serit-num` ile mono + tabular görünür; başlıklar display
   ailede kalır.
6. Hover dekorasyonu işlevin önüne geçmez; klavye odağı ve azaltılmış hareket
   tercihleri korunur.

## Kabuk (Layout)

Kaynak: `src/components/Layout.tsx`. Sayfa başlığı/alt başlığı **kabuktadır**
(`routeTitle`/`routeSubtitle`, `src/components/navigation.ts` routeMeta) —
sayfalar kendi başlığını çizmez (CrudPage'in kendi başlığı Ş4'te kaldırıldı;
`pageTitle` yalnız erişilebilirlik/arama etiketi olarak taşınır).

Kırılımlar:

- **< 768px:** mobil alt bar (`BottomNav`) + tek kolon. Alt bar yüzen hap
  değil, sayfanın dibine oturan düz banttır: ayrım 1px `line-strong` çizgisi,
  gölge yok, 5 slot.
- **768–1024px:** etiketli kompakt sol rail (144px). Orta genişlikte kullanıcı
  ikonları ezberlemek zorunda bırakılmaz.
- **≥ 1024px:** tam sol rail (216px), marka + etiketli navigasyon + kullanıcı/
  çıkış bloğu. Rail sayfadan 1px `line-strong` ile ayrılır.

Header sticky'dir ve `--page` zemininde 1px çizgiyle biter; tutar gizleme,
tema anahtarı, masaüstünde `QuickActionsButton`, mobilde taşma menüsü
(Analiz + Kontrol) burada yaşar.

### Mobil işlem alanı

Mobilde işlem eylemi alt barın kendi opak yüzeyine bağlıdır. `QuickActionsFab`
adı geriye dönük korunur ancak artık yalnız diğer işlemler düğmesidir; ayrı
şeffaf 76px FAB bandı yoktur. `main` alt padding'i (152px + safe-area) son
kaydın gezinmenin altında kalmasını önler. Form alanına odaklanınca mobil alt
bar geri çekilir; harcama görev ekranında ekle satırı tekrarlanmaz.

### HubNav

`src/components/HubNav.tsx`: hap değil, alttan çizgili sekme — aktif sekme
**2px safir** (`--primary`) alt çizgi alır, şerit 1px `line-strong` ile
içerikten ayrılır. İkon çizilmez (bu ölçekte gürültü; `HubTab.icon` tipte
kalır çünkü alt bar/rail kullanır). Dar ekranda yatay kayar; aktif sekme rota
değişince görüşe kaydırılır.

## `serit/` bileşen ailesi

Kaynak: `src/components/serit/index.ts`. Roller:

| Bileşen | Rol |
| --- | --- |
| `ScreenHeader` / `SectionEyebrow` | Ekranın ilk satırı: cümle düzeninde etiket + sağda bağlam ("4 hesap · 3 kart"). Bölüm başlıkları `SectionEyebrow`. |
| `HeroNumber` | Ekranın tek sorusunun cevabı; dev mono rakam (36px mobil → 56px masaüstü). Rakam `ink`; `tone` yalnız gerçekten kritikse. Opsiyonel progress çubuğu. |
| `LineGroup` / `LineRow` / `DayBadge` | Çizgi listesi. `plain` (zeminsiz, baskın) ve `raised` (14px yarıçap, ekran başına 1-2) kapları. |
| `BreakdownBar` | Parça-bütün: pasta değil **yatay kırılım çubuğu** + etiket/değer satırları. Segment rengi sinyal (`tone`) ya da kimlik (`color` → viz paleti). Sıfır toplamda boş track kalır. |
| `TrendBars` | Yön okutan kısa trend: geçmiş çubuklar `--chart-idle`, sonuncusu safir. Eksen/tooltip yok; kesin değer yandaki cümlede. |
| `Delta` | Kahraman rakamın altındaki değişim satırı ("▲ 18.900 ₺ bu ay (+%3,3)"). Artı yeşil, eksi `danger`. |
| `tone.ts` | `SeritTone` sinyal kümesi + `SERIT_FILL`/`SERIT_TEXT` haritaları (uyarı sarısının metin karşılığı ayrı — AA). |
| `useSeritAmount` | Rakamları "tutarları gizle" moduna bağlar; maske aynı genişlikte `••••` (tabular sayesinde satır kaymaz). |

Dashboard'un Şerit gövdesi `src/components/dashboard/Serit*.tsx`
(`SeritOverview`, `SeritMonthStrip`, `SeritBufferRow`) bu parçalardan kurulur.

## Tipografi

- `.serit-num` (index.css): mono aile + `tabular-nums` + `-0.02em`. Pazarlık
  konusu değil — hizalı rakamlar bu dilin belkemiği; gizleme maskesi de aynı
  genişlikte kalır.
- `.serit-eyebrow`: 13px/600, `0.01em` tracking, 20px line-height
  (Ş/Ç/Ğ alt çıkıntıları satır yüksekliğini oynatmasın diye). Ekran eyebrow'u
  `0.14em` ile bölüm eyebrow'undan ayrılır.

## Token temelleri (`src/index.css`)

İki tema birinci sınıftır (Mürekkep ve Safir: açık serin zemin + koyu lacivert; safir vurgu).
Şerit token'ları mevcut semantiklerin *yanında* yaşar; dönüştürülmüş ekranlar
bunları kullanır:

- `--background` ailesi: açık tema `#f5f7fb`, koyu tema mürekkep
  `#101623`; `--page` = `var(--background)`, `--raised` = `var(--card)`.
- `--primary` safir: `#2458d3` (açık) / `#8cb1ff` (koyu). Aktif nav, HubNav alt
  çizgisi, trend vurgusu. Pozitif finans hareketi `--success` ile yeşildir.
- Mürekkep skalası: `--ink` / `--ink-muted` / `--ink-faint` / `--ink-ghost`
  (kontrast değerleri AA için handoff'tan bilinçli koyulaştırıldı — yorumlar
  index.css'te).
- Çizgiler/zeminler: `--line`, `--line-strong`, `--track`, `--chart-idle`,
  `--accent-soft`, `--neutral-bar`.
- Sinyaller: `--destructive`, `--warning` (+ `--warning-fill`: çubuk/rozet
  zemini için daha parlak dolgu), `--info`, `--success`. Faz 8'de
  `--signal-danger/-info/-warning-ink` takma adları kaldırıldı; üçü zaten
  semantiklerin aynısıydı, gerçek fark tek değerdi (uyarı dolgusu ≠ uyarı metni).

Yeni renk/radius'u component içinde çoğaltma; gerekiyorsa index.css token veya
semantik sınıf ekle.

### Şerit'e taşınmamış yüzeyler

Kredi kartı ayrıntısı (`src/pages/CardsPage.list.tsx`) 16 Ekim 2026
itibarıyla nötr safir yüzeye ve küçük banka logosuna taşındı. Altın işlem geçmişi (`src/pages/GoldPage.tsx`)
13 Ekim 2026'da tür bazında tek sütunlu, çizgiyle ayrılan kompakt satırlara taşındı;
miktar, alım/satım, tarih, toplam, birim maliyet ve not satır içinde okunur.
Kimlik başlığı, tek ana değer kuyusu, kısa metrikler, ana aksiyon sırası
korunur. Bu yüzeylere dokunurken Şerit'e zorla çevirme; nesne kimliği kart biçimiyle korunur. Banka/nakit ayrıntısı 12 Ekim 2026'da sade Şerit zeminine taşındı;
liste ve hesap ayrıntısında gradyan, dekoratif üst çizgi ve renkli çerçeve yoktur.

## Grafik Rengi

Grafik rengi dosya başına zevk meselesi değil, doğrulama kapısı olan bir token
setidir. Kurallar (ihlal edilirse grafik yanlış bilgi verir):

1. **Durum rengi kimlik taşımaz.** `--destructive`/`--warning`/`--info` yalnız
   başarı/uyarı/risk demektir. Kategori grafiğinde kırmızı bir dilim "kötü" diye
   okunur. Kimlik için `--viz-1..13` kullan (9..13, 13 kategorili taksonomi
   genişletmesidir; riskli komşu çiftler için index.css'teki nota bak).
2. **Renk varlığa bağlanır, sıralamaya değil.** `dizi[i]` ile veri sırasından renk
   verme; kategori sıralaması değişince renkler yer değiştirir. `buildVizColorMap`
   (`src/components/charts/vizPalette.ts`) kanonik anahtar listesinden sabit
   harita üretir.
3. **Slot döngüye girmez.** `i % n` fazla kategoriyi ilkiyle aynı renge boyar.
   Fazlası `--viz-other` (nötr) veya "Diğer" kovasına katlanır.
4. **Komşuluk garantisi doğrusal dizide geçerlidir.** Segment sırası slot
   sırasıyla aynı olmalı (`orderSlicesCanonically`). Halka (donut) ek komşuluk
   yaratır — bu yüzden parça-bütün için **halka değil yatay yığın** kullanılır
   (`src/components/charts/CompositionBar.tsx`, Şerit ekranlarında
   `BreakdownBar`).
5. **Açık temada viz-3/4/5 kontrastı 3:1 altında.** Her segmentin görünür
   etiketi olmalı (relief kuralı) — `CompositionBar`/`BreakdownBar` satır
   listeleri bunu sağlar.

Paleti değiştirirsen doğrula; gözle karar verme. Palet ve doğrulayıcı `dataviz`
skill'inde (`validate_palette.js`), zemin olarak `--card` değerlerini ver.

## Responsive ve Erişilebilirlik

- Ana dokunma hedefi en az 44px olmalıdır. İkon-only butonlarda görsel boyutu
  büyütmek yerine `.tap-target` kullan: `::after` ile hit alanını 44px'e çıkarır,
  düzeni bozmaz. `Button`'ın `icon`, `icon-sm`, `icon-xs` boyutlarında hazır
  gelir; ham `<button>` yazıyorsan sınıfı elle ekle.
- **Bitişik ikon çiftlerinde `.tap-target` tek başına yetmez.** Genişletilmiş
  alan komşunun görünür kutusunu örtüp yanlış aksiyonu tetikleyebilir (sil vs
  düzenle). Çift kullanıyorsan butona gerçek boyut (`size-9`) ve en az `gap-1.5`
  ver. Şüpheliysen `document.elementFromPoint` ile butonun kendi kutusunun
  kendine düştüğünü doğrula.
- Hover ile beliren satır aksiyonları dokunmatikte erişilemez. `opacity-0 +
  group-hover` kullanıyorsan `hover-actions` sınıfını da ekle; `@media
  (hover: none)` altında kalıcı görünür olur.
- Hub navigation dar ekranda kırılmak yerine yatay taşar.
- Mobil alt bar safe-area boşluğu kullanır; etiketli işlem alanının üstünde
  son içerik için yeterli padding bırakılır. Form odağında bar geri çekilir.
- İkon-only aksiyonların erişilebilir adı olmalıdır. `TrendBars` gibi salt
  görsel grafikler ekran okuyucuya tek cümlelik `label` verir; `Delta`'nın ok
  karakteri `aria-hidden` değildir, yön kelimeyle desteklenir.
- Renk tek başına durum anlatmaz; metin veya ikonla desteklenir.
- `prefers-reduced-motion` altında dekoratif hareketler kapanır.

## Yeni UI Eklerken

1. Önce `serit/` ailesi veya mevcut ortak primitive'in ihtiyacı karşılayıp
   karşılamadığına bak.
2. Domain hesabını component'e taşımadan yalnız sunum katmanını değiştir
   (Şerit bileşenleri hesap yapmaz; sayı hazır gelir).
3. Yeni renk/radius'u component içinde çoğaltma; gerekiyorsa `index.css` token
   veya semantik sınıf ekle. Gölge ekleme — ayrım çizgiyle yapılır.
4. Masaüstü ve 390px mobilde taşma, odak, loading, empty ve hata durumunu kontrol
   et.
5. `npm run verify` kalite kapısını çalıştır; kullanıcı akışı değiştiyse
   Playwright smoke'u ayrıca doğrula.

## 2026-09-06 takip paketi
Özet odak önerileri ayrıntılar kapalıyken görünür. Masaüstü vade listesi altı grupla başlar, kullanıcı genişletir. Mobil takvimde b=bin, m=milyon açıklaması görünür; tam tutar seçilen gün detayındadır, kompakt tutarlar gizlilik moduna uyar. Kart döngüsü varsayımları aynı panelde, harcama senaryosu isteğe bağlı details içinde kalır.

## 2026-09-07 — Günlük kullanım sadeleştirmesi
Hesap/kart sayfasında iki açıklamalı büyük seçim alanı kullanılır: Kredi kartları (borç, ekstre ve limit) ve Banka hesapları (bakiye ve hareketler). Alt şerit Özet/İşlemler/Ekstreler araçlarını taşır. Kalan kart limiti nakit bakiye gibi adlandırılmaz. Plan ana sekmeleri Ödemeler/Bütçe ve hedefler; diğer araçlar native details ile açılır, aktif araç üst sekmede görünür. Hızlı işlem seçenekleri tüm rotalarda sabittir.

2026-09-07 üretim öncesi takip: Hızlı menü Harcama ekle ile başlar; form kaynağı Hesap / kredi kartı olarak adlandırılır. Banka hesabı menüsü taşmaya açıktır; dekoratif üst çizgi köşelerin içine alınır.

## 2026-09-15 — Kullanıcı denetimi sözleşmesi

Kişisel miktar/alış fiyatı/komisyon ve metne gömülü TL tutarları gizlilik modunda maskelenir; halka açık piyasa fiyatı ayrı kalır. Başarısız sorgu temiz/boş sonuç gibi sunulmaz; tekrar deneme görünür. Rota değişince belge başlığı güncellenir. Düzenlenen formdan geri/kapat/Escape ile ayrılmak kullanıcı onayı ister; SW güncellemesi kirli formu otomatik yenilemez. CSV “Kontrol verisi CSV” olarak kısmi kapsamını açıklar; tam yedek JSON'dur. Paylaşım PNG'si ilk beş kategoriyi adlandırır ve iki ondalık kullanır.

## 2026-09-18 — Ödeme kartı başlık ve aksiyon düzeni

Ödeme kartlarında kimlik satırı başlık, kategori/takvim özeti ve taşma menüsüne
ayrılır. Tekrar/tahmin durumları ile birincil “Öde” eylemi ayrı satırda durur;
aksiyonlar uzun ödeme adlarını tek harflik kolonlara sıkıştıramaz.

## 2026-10-04 — Hesap/kart hızlı erişimi

Hesap ve kredi kartı kartlarında dolu/boş kalp kalıcı favoriyi gösterir; renk
tek başına kullanılmaz (`aria-pressed` ve açık erişilebilir ad zorunlu).
Favoriler seçim listelerinin başına alınır. Uzun hesap kimliği/hareket ve kart
dönem-limit-taksit içerikleri varsayılan kapalı `details` bölümlerindedir;
bakiye/borç ile ana eylemler katlanmaz.

## 2026-10-12 — Sistem teması ve mobil hesap tutarlılığı

Tema `hooks/useTheme.ts` tarafından yönetilir. Varsayılan Sistem telefonun
`prefers-color-scheme` değişimini dinler; uygulamaya dönüşte yeniden okunur.
Elle Açık/Koyu seçimi `denge:theme-preference` anahtarındadır; eski `theme`
otomatik yazıldığı için açık kullanıcı tercihi olarak taşınmaz. HTML renk
şeması ve tarayıcı/PWA üst bandı aynı seçime uyar. Üst başlık dar ekranda
kesilmek yerine satıra yayılır; üst kontrollerin gerçek hedefi en az 44px'tir.

Hesap/kart seçimi mobilde kompakt iki açıklamalı alandır. Hesap listesinde
uzun isim ve tutar ayrı satırlardadır (≥460px'te yan yana). Hesap ayrıntısında
IBAN ve not kesilmez; hareketin tutarı, tarih ve işlem sonrası bakiye okunur.
Uzun kahraman tutarları (>10 karakter) mobilde küçülerek iki ondalığı korur.
Arama boş sonucunda ilk kayıt önerisi yerine aramayı temizleme eylemi vardır.

AI özetinde kopyala/PDF mobilde tam genişlikte alt alta, masaüstünde yan yana
durur. Panoya gerçekten kopyalanan içerik önizlemeyle aynıdır; hata/başarı
ayrı durum metniyle bildirilir. Görsel denetim: `docs/MOBILE_UI_REVIEW_2026-10-12.md`.

## 2026-10-13 — Alınacaklar, tema ikonu ve altın geçmişi

Görsel tarama: `docs/VISUAL_REVIEW_2026-10-13.md`. Taksit ve analiz tutarları
üç noktayla kesilmez; dar ekranda metin/sütunlar sarılır. Kur bandının ek
açıklaması tam satırı kullanır. `LineRow` alt metni sarılır. Gider grubunda
uzun ad eylemleri dışarı itemez; harcama etiket seçicisi dar ekranda metnin
altına geçer. Finansal hesap ve yazma davranışları bu düzenle değişmez.

Kredi kartı ayrıntısında marka başlığının dekorasyon katmanı köşe yarıçapını
başlıktan miras alarak kırpılır. Başlık/kart taşmaya açık kalır; böylece
dekoratif çizgi ve ışık köşelerden taşmaz, işlem menüsü kesilmez.

Altın işlemlerinin adı tutarlı olarak **Alım / Satım** çiftidir: form,
ekleme düğmesi, liste satırı, kayıt menüsü ve boş durum aynı dili kullanır.
Piyasa kurunun tarafını anlatan “alış kuru” ayrı bir kavram olarak korunur.

Altın ekranında üst özet toplam miktarı/ederi ve gram/çeyrek bazında eldeki
miktar, kayıtlı ayarlar, ortalama birim maliyet ve güncel ederi gösterir.
İşlem defteri boşsa bağımsız altın varlıkları özetlenir; iki kaynak toplanmaz.
Maliyet veya ayar bilinmiyorsa açıkça belirtilir. Ayar meta bilgidir;
mevcut gram/çeyrek kurundan değerlemeyi değiştirmez. Alım/satım satırlarında
ayar görünür ve aranabilir. Birikim grafiği varsayılan kapalıdır; boş işlem
defterinde çizilmez. Böylece özet ve listeye erişim grafik tarafından itilmez.
Gizlilik modu özet ve işlem satırlarının kişisel miktarlarını da maskeler;
notlara gömülü TL tutarları ortak `maskText` yolu üzerinden gizlenir.

Tema kontrolü yalnız ikondur; menü ve görünür metin içermez. Tıklama sırası
Sistem → Açık → Koyu → Sistem'dir. Varsayılan Sistem ve manuel seçimin cihazda
kalıcılığı korunur. Erişilebilir ad ve tooltip mevcut modu ve sonraki eylemi söyler.

Alınacaklara eklerken üç soruluk istek/ihtiyaç testi görünür. Üç cevap
tamamlandığında sonucu gösterir; sonuç eklemeyi engellemez ve kaydedilmez.
Fiyat girilirken ve fiyatlı bekleyen satırlarda peşin alımın finansal yorumu
görünür. Renk yanında açık durum metni, gerekçe ve alım sonrası harcanabilir tutar
vardır. Eksik finans/kasa verisinde olumlu değerlendirme gösterilmez; yeniden
yükleme sunulur. Değerlendirme her ürünü ayrı ele alır; tüm listeyi aynı anda
almayı varsaymaz. Tutarlar gizlilik tercihini izler. Hesap sözleşmesi:
`docs/FINANCE_RULES.md`.
