# Form / iptal / mobil gezinme kanıtları

Rapor: `docs/FORM_NAV_AUDIT_2026-11-08.md`. Revizyon `a96910f`.
F01–F05 doğrulanmış bulgular; U01 kullanıcının tam navbar belirtisi için açık
tanı kaydıdır. Bu dizin düzeltilmiş davranışı göstermez.

- `browser-observations.spec.txt`: geçici e2e dosyasının tam kopyası.
- `playwright.config.txt`: geçici repo kökü yapılandırması; projenin mevcut
  Playwright ayarını genişletir. Chromium/Pixel 7 ve WebKit/iPhone 13 bağlamı.
  Çıktı yolu repo dışındadır; yeniden çalıştırırken kendi çıktı yolunu ayarla.
- Son komut: `PLAYWRIGHT_PORT=4191` ortam değişkeniyle
  `npx playwright test tests/e2e/audit-form-temporary.spec.ts --config=.audit-form-playwright.config.ts`.
  Ortamda Supabase URL'si örnek/test URL'si olmalı; gerçek Supabase'e çıkış
  engellenir. Playwright Chromium ve WebKit kurulmuş olmalıdır.
- `browser-results.txt`: **46/46 geçti**, her motorda 23 gözlem. Hazırlıktaki
  yanlış menü/rota seçicileri düzeltildi. Refetch gözlemi aktif maaş GET'i
  üzerinden ve ilk yükleme tamamlandıktan sonra sayıldı. Önceki hazırlık
  hataları ürün bulgusuna dönüştürülmedi; burada son başarılı koşu var.
- `*-escape-*.json`: 9 CRUD ailesinin açılma/yazma/Escape/onay kapanışları.
- `*-cancel-x.json`, `*-back-cancel.json`: reddet/kabul, yeniden açma ve geri.
- `*-resize-cancel.json`, `*-animated-resize.json`: viewport daralma/genişleme
  aşamaları, body/visualViewport/nav geometrisi. Gerçek soft keyboard testi değildir.
- `*-row-menu-cancel.json`, `*-scrolled-row-cancel.json`: ölü menü tetikleyicisi
  sonrası BODY odağı; uzun listede scroll restore ölçümü.
- `*-quick-actions.json`, `*-header-menu.json`: normal menü döngüleri.
- `*-pending-save-cancel.json`: mock POST beklerken kapat/ikinci taslak aç;
  ilk yanıt ikinci formu kapatır. Gerçek DB yazması yoktur.
- `*-unrelated-close-dirty.json`: başka pencere kapandıktan sonra altta duran
  taslağın korumasının temizlenmesi; onay sayısı ve korunan alan değeri.
- `*-explicit-cancel.json`: aynı formda X=1 uyarı, Vazgeç=0 uyarı. Yeni ürün
  maddesi sayılmadı; ürünün iptal sözleşmesi kararı olarak raporda açıklandı.
- `*-modal-background-refresh.json`: modal hedefli DOM touch dizisinde aktif
  maaş listesi GET'i 1→2. Finans mutasyonu değildir.
- `*-touchcancel-spacer.json`: aynı gerçek hook'ta iptal temizliği eksik;
  kapanıştan sonra gösterge 80px kalır. DOM olay probu, fiziksel OS jestinin
  hangi anda iptal edildiğini veya U01'in nedenini kanıtlamaz.
- `*-pdf-busy-close.json`: PDF çıkarımı bekleyen Promise ile mock'landı;
  Escape açık tutar, X/onay kapatır. Gerçek PDF import/apply yazması yapılmadı.
- Seçilmiş viewport PNG'leri buradadır. Tam 46 PNG, repo dışındaki aynı
  oturumun `form-probes` görsel arşivinde kaldı. Tam sayfa çekim kullanılmadı;
  görüntü DPR'ı cihaz bağlamına, koordinatlar CSS pikseline aittir.

Tarih fixture'da 26 Ekim 2026; araştırma tarihi 8 Kasım 2026'dır.
Windows WebKit gerçek iPhone Safari/PWA ve işletim sistemi klavyesi değildir.
U01 yeniden üretilmiş/çözülmüş sayılmamalı. Geçici test ve yapılandırma normal
lint/test kapsamından kaldırıldı; düzeltmede doğru kabul beklentileri eklenir.

Kapanış notu — 9 Kasım 2026: **`npm run verify` geçti**. Lint, kaynak/encoding
guard'ları, 189 dosyada 1930 test ve coverage, production dependency audit
(0 açık), production build, 1038,7/1060 kB JS gzip bütçesi ve 6 edge tip
kontrolü başarılı. Tam çıktı: `verify-results.txt`.
Uygulama/SQL değişmediği için gerçek DB paketi bu tur yeniden çalıştırılmadı.
