# UI Architecture

Last reviewed: 2026-08-12

Bu belge uygulamanın görsel kaynak gerçeğidir. Finans kurallarını veya veri
erişimini tanımlamaz; route ve component'lerin aynı **Şerit** görsel dilinde
kalmasını sağlar. Şerit 2026-08-10/11'de tüm uygulamaya uygulandı (PR #108,
#112; tarihçe için `docs/BACKLOG.md` Ş0–Ş15 günlüğü). Kaynak gerçeği kod:
`src/index.css` (token'lar), `src/components/Layout.tsx`, `BottomNav.tsx`,
`HubNav.tsx`, `QuickActions.tsx`, `src/components/serit/*`.

## Şerit İlkeleri

1. **Kart yok, gölge yok.** Ayrım gölgeyle değil 1px çizgi (`--line`,
   `--line-strong`) ve zemin tonuyla (`--page` / `--raised`) yapılır.
   Yükseltilmiş blok (`bg-raised`, `LineGroup variant="raised"`) ekran başına
   en fazla 1-2 tane ve yalnız aksiyon/grafik için. `serit/` ailesine Card
   bileşeni **eklenmez** — bu dilin ana fikri kartları bırakmaktır.
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
   gruplanır; baskın biçim zeminsiz `plain`.
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
- **768–1024px:** ikon-only sol rail (56px).
- **≥ 1024px:** tam sol rail (216px), marka + etiketli navigasyon + kullanıcı/
  çıkış bloğu. Rail sayfadan 1px `line-strong` ile ayrılır.

Header sticky'dir ve `--page` zemininde 1px çizgiyle biter; tutar gizleme,
tema anahtarı, masaüstünde `QuickActionsButton`, mobilde taşma menüsü
(Analiz + Kontrol) burada yaşar.

### FAB bandı — ŞEFFAF (bilinen kural)

Mobil FAB (`QuickActionsFab`, 52×52) alt barın kendisine ayrılmış **76px'lik
bandına** yerleşir; bu bandın zemini **şeffaftır ve opak yapılmamalıdır**.
Opak yapıldığında içerik görünmez bir çizgide düz kesiliyordu. İçeriğin sayfa
sonunda FAB altında kalmamasını bandın opaklığı değil, `main`'in banda eşlenen
alt padding'i (152px, Layout'ta) sağlar. Yalnız nav satırı opaktır; şeffaf
bandın altındaki içerik tıklanabilir kalır (`pointer-events` ayrımı
`BottomNav`'da). Form alanına odaklanınca FAB geri çekilir.

### HubNav

`src/components/HubNav.tsx`: hap değil, alttan çizgili sekme — aktif sekme
**2px jade** (`--primary`) alt çizgi alır, şerit 1px `line-strong` ile
içerikten ayrılır. İkon çizilmez (bu ölçekte gürültü; `HubTab.icon` tipte
kalır çünkü alt bar/rail kullanır). Dar ekranda yatay kayar; aktif sekme rota
değişince görüşe kaydırılır.

## `serit/` bileşen ailesi

Kaynak: `src/components/serit/index.ts`. Roller:

| Bileşen | Rol |
| --- | --- |
| `ScreenHeader` / `SectionEyebrow` | Ekranın ilk satırı: uppercase eyebrow + sağda bağlam ("4 hesap · 3 kart"). Bölüm başlıkları `SectionEyebrow`. |
| `HeroNumber` | Ekranın tek sorusunun cevabı; dev mono rakam (46px mobil → 62px masaüstü). Rakam `ink`; `tone` yalnız gerçekten kritikse. Opsiyonel progress çubuğu. |
| `LineGroup` / `LineRow` / `DayBadge` | Çizgi listesi. `plain` (zeminsiz, baskın) ve `raised` (14px yarıçap, ekran başına 1-2) kapları. |
| `BreakdownBar` | Parça-bütün: pasta değil **yatay kırılım çubuğu** + etiket/değer satırları. Segment rengi sinyal (`tone`) ya da kimlik (`color` → viz paleti). Sıfır toplamda boş track kalır. |
| `TrendBars` | Yön okutan kısa trend: geçmiş çubuklar `--chart-idle`, sonuncusu jade. Eksen/tooltip yok; kesin değer yandaki cümlede. |
| `Delta` | Kahraman rakamın altındaki değişim satırı ("▲ 18.900 ₺ bu ay (+%3,3)"). Artı jade, eksi `danger`. |
| `tone.ts` | `SeritTone` sinyal kümesi + `SERIT_FILL`/`SERIT_TEXT` haritaları (uyarı sarısının metin karşılığı ayrı — AA). |
| `useSeritAmount` | Rakamları "tutarları gizle" moduna bağlar; maske aynı genişlikte `••••` (tabular sayesinde satır kaymaz). |

Dashboard'un Şerit gövdesi `src/components/dashboard/Serit*.tsx`
(`SeritOverview`, `SeritMonthStrip`, `SeritBufferRow`) bu parçalardan kurulur.

## Tipografi

- `.serit-num` (index.css): mono aile + `tabular-nums` + `-0.02em`. Pazarlık
  konusu değil — hizalı rakamlar bu dilin belkemiği; gizleme maskesi de aynı
  genişlikte kalır.
- `.serit-eyebrow`: 11px/600, `0.12em` tracking, sabit 16px line-height
  (Ş/Ç/Ğ alt çıkıntıları satır yüksekliğini oynatmasın diye). Ekran eyebrow'u
  `0.14em` ile bölüm eyebrow'undan ayrılır.

## Token temelleri (`src/index.css`)

İki tema birinci sınıftır (Nocturne: açık porselen + koyu obsidyen; jade vurgu).
Şerit token'ları mevcut semantiklerin *yanında* yaşar; dönüştürülmüş ekranlar
bunları kullanır:

- `--background` ailesi: açık tema sıcak porselen `#f6f7f3`, koyu tema obsidyen
  `#0d120f`; `--page` = `var(--background)`, `--raised` = `var(--card)`.
- `--primary` jade: `#0a6b4f` (açık) / `#3ddca0` (koyu). Aktif nav, HubNav alt
  çizgisi, trend vurgusu.
- Mürekkep skalası: `--ink` / `--ink-muted` / `--ink-faint` / `--ink-ghost`
  (kontrast değerleri AA için handoff'tan bilinçli koyulaştırıldı — yorumlar
  index.css'te).
- Çizgiler/zeminler: `--line`, `--line-strong`, `--track`, `--chart-idle`,
  `--accent-soft`, `--neutral-bar`.
- Sinyaller: `--signal-danger`, `--signal-warning` (+ `--signal-warning-ink`
  metin karşılığı), `--signal-info`.

Yeni renk/radius'u component içinde çoğaltma; gerekiyorsa index.css token veya
semantik sınıf ekle.

### Şerit'e taşınmamış yüzeyler

`premium-entity-card` anatomisi hâlâ kullanılır: hesap/kart liste kartları
(`src/pages/CardsPage.list.tsx`) ve altın lotları (`src/pages/GoldPage.tsx`).
Kimlik başlığı, tek ana değer kuyusu, kısa metrikler, ana aksiyon sırası
korunur. Bu yüzeylere dokunurken Şerit'e zorla çevirme; kart listesi bilinçli
istisnadır.

## Grafik Rengi

Grafik rengi dosya başına zevk meselesi değil, doğrulama kapısı olan bir token
setidir. Kurallar (ihlal edilirse grafik yanlış bilgi verir):

1. **Durum rengi kimlik taşımaz.** `--signal-*`/`--destructive` yalnız
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
- Mobil alt bar safe-area boşluğu kullanır; şeffaf FAB bandının altındaki
  içerik tıklanabilir kalmalıdır (pointer-events ayrımını bozma).
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
5. `npm run lint && npm run test:unit && npm run build` kapılarını çalıştır.
