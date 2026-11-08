# Son görsel taramanın kanıtları

Rapor: `docs/VISUAL_UI_AUDIT_2026-11-08.md`.
Revizyon: `a96910f`; görüntüler düzeltmeden önceki davranışa aittir.

- `contact-light.jpg`, `contact-dark.jpg`: 19 ana mobil ekranın temas sayfası.
  Bunlar küçültülmüş özetlerdir; ayrıntıda tam görüntüler kullanıldı.
  `inventory.json`: 24 rotanın 72 görünümü için metin, taşma, kesilme ve
  kontrol boyutları; engellenen finans yazması sayıları.
- Üç `*-1280-light.png`: Özet, Varlıklar, Analiz ayrıntılarının geniş ekran
  örnekleri. Tam 72 görüntü + giriş ekranı repo dışındaki yerel görsel
  arşivinin `demo-captures` dizininde saklandı; hepsi Git'e eklenmedi.
- `demo-capture.mjs.txt`: geçici repo kökü Node script'i olarak çalıştırılır.
  Playwright Chromium, Vite ve yerel Supabase gerekir. CLI'dan yalnız
  loopback yapılandırmasını bellekte okur; anahtarları yazdırmaz. Demo
  oturumu açar; finans bakım/senkron mutasyonlarını engeller, dış fiyat ve
  analitik isteklerine çıkmaz. `demo-capture-results.txt` yakalama çıktısıdır.
- `contact-sheet.py.txt`: Pillow ile mobil temas sayfası üretir. Başlangıç
  matrisinin geçici çıktı klasörünü kullanır.
- `browser-observations.spec.txt`: geçici Playwright testinin kopyası.
  E2E test dizinine geçici `.spec.ts` dosyası olarak kopyalandığında çıktı
  dizinini kendi repo dışı yoluna ayarla. Ortam Supabase URL'si
  `https://example.supabase.co`, anahtar test değeri olmalıdır. Tüm Supabase
  istekleri sentetik yanıtlanır ve diğer dış adresler engellenir.
- Son komut: `PLAYWRIGHT_PORT=4188` ortamıyla
  `npx playwright test tests/e2e/audit-visual-temporary.spec.ts --workers=1`.
  **15/15 geçti**; `browser-results.txt`. Tarih 26 Ekim 2026'ya sabit;
  denetim tarihi 8 Kasım'dır. İlk denemelerin seçici/çekim hazırlık sorunları
  ürün bulgusu değildir. Kanıt yazımının dev yenilenmesini etkilememesi için
  son koşu repo dışına yazdı; burada yalnız son başarılı çıktılar var.
- `probe-budget-*`: 320/390px büyük bütçe metni ve geometrisi.
- `probe-trend-*`: iki temada GRA/USD; panel/tam sayfa resimleri ve gerçek
  görünen/erişilebilir metin JSON'ları. V02/V03 farklı kök nedenlerdir.
- `probe-car-*`: uzun isimler, kart dışına çıkan eylemler ve koordinatları.
- `probe-contrast-*`: iki temada alfa birleşimli metin kontrastı ve hedef
  boyutları. Otomatik filtre kaynak/görüntüyle kontrol edildi; her küçük
  inline bağlantı ürün hatası sayılmadı.
- `probe-hit-overlap.*`: kısa bakım satırında eylem kutuları, görünmez hedef
  boyutu ve `elementFromPoint` sonuçları. Silme işlemi çalıştırılmadı.
- `probe-state-*`: 320px yüklenme/hata/boş durum/hesap modalı, yatay belge
  genişliği. Tam sayfa çekimde sabit alt barın ortada görünmesi screenshot
  tekniğinden kaynaklanır; tek başına örtüşme bulgusu değildir.

Geçici test/script'ler normal test ve lint kapsamından kaldırıldı. Gözlem
paketi düzeltme kabul paketi değildir; düzeltirken doğru davranışı bekleyen
regresyonlar yazılmalıdır. Finans verisi/migration değişmedi.

Son kalite kapısı: **`npm run verify` geçti**. Lint, kaynak/encoding guard'ları,
189 dosyada 1930 test ve coverage, production dependency audit (0 açık), build,
1038,7/1060 kB JS gzip bütçesi ve 6 edge tip kontrolü başarılı.
Coverage: statement %93,35; branch %86,16; function %94,77; line %95,33.
Tam çıktı: `verify-results.txt`. Uygulama kodu değişmediği için SQL paketi bu
görsel turda tekrar çalıştırılmadı; önceki iki audit'in SQL sonuçları korunur.
