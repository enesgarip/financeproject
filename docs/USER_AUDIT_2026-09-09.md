# Uygulama kullanıcı denetimi — 2026-09-09

Durum: yerel denetimdeki 29 bulgu için düzeltmeler 15.09.2026 tarihinde uygulandı. Son npm run verify geçti: 135 dosya / 1476 test, sıfır prod bağımlılık açığı, build, bundle ve altı Edge tip kontrolü. Aşağıdaki bulgu açıklamaları düzeltme öncesi tarihsel kayıttır. Bu kapanış her cihazda/her olası veri kombinasyonunda hatasızlık iddiası değildir. Gerçek banka dosyaları, fiziksel cihaz/ekran okuyucu ve dış sağlayıcı doğrulamaları aşağıda ayrı kapsam sınırıdır.

## 15 Eylül düzeltme ve doğrulama tablosu

Reset öncesi yerel DB yedeği: audit-20260909.local/before-fixes-0915.dump (1.073.040 bayt). Yeni migration temiz seed üzerinde uygulandı. Üretime gönderilmedi.

| Bulgu | Uygulanan düzeltme | Doğrulama |
|---|---|---|
| AUD-001 | Gezinme/SW kurulumu ayrı dinamik modüller; eşik artırılmadı | Bundle bütçesi geçti (ilk düzeltme: toplam 969,8 kB) |
| AUD-002 | Hedef fotoğrafı ve hisse SQL testleri kendi satırlarını sayar | Temiz seed 45/45; UI hedefleri eklenmiş DB 45/45 (fix-db-final.log) |
| AUD-003 | ≤50.000 TL %20, üstü %40 | 49.999,99 / 50.000 / 50.000,01 sınır testleri |
| AUD-004 | Gelecek işlem UI/DB reddi; bugünkü pozisyondan dışlama | Gerçek PostgreSQL trigger testi |
| AUD-005 | Eksik dönem fiyatı/kazancı hesaplanamıyor gösterimi | Kaynak/build kontrolü |
| AUD-006 | Araç, grup, liste, hedef, hisse ve gömülü tutar maskeleri; Veri Kontrolü detayları | Maskeleme birim testi ve bileşen doğrulaması; tüm özel veri varyantlarının görsel garantisi yok |
| AUD-007–009 | Veri Kontrolü, wishlist ve ortak CRUD sorgu hatası tekrar deneme sunar | Wishlist gerçek tarayıcı 500 enjeksiyonu; diğerleri kaynak/birim/build |
| AUD-010 | Sıradaki olmayan kredi taksidinin ödeme düğmesi devre dışı | Kaynak/build ve mevcut kredi SQL regresyonları |
| AUD-011 | Negatif yakıt/km doğrulama, Türkçe PDF/SQL/ağ hataları, restore mesaj çelişkisi kaldırma | Kullanıcı hata dönüşümü testleri + bileşen testleri |
| AUD-012 | Negatif istek tutarı kaydetmeden reddedilir | Kaynak/build |
| AUD-013 | Mobil Kasa özetinde tek sütun | 375 px rota taşma kontrolü; kaynak/build |
| AUD-014 | Canlı testler yeni kart/hedef oluşturur; ayırma onayını tamamlar | Gerçek yerel backend: 2 hedef + 1 kart harcaması testi geçti |
| AUD-015 | Araç hatırlatıcı ve taksit toplamına erişilebilir ad/label bağlantısı | Kaynak/build |
| AUD-016 | Kart alias çözümleme yalnız servis rolüne açık, sahibi filtreleyen RPC | SQL izin/sahiplik testi + gerçek kart SMS ilk/tekrar HTTP ve borç tek etki |
| AUD-017 | İki parser saniyesiz hesap SMS tanır | FAST/HAVALE/EFT gelen/giden 6 birim testi; saniyesiz HAVALE HTTP ilk/tekrar; bakiye tek etki |
| AUD-018 | CSV kısmi kontrol verisi olarak adlandırılır, tam JSON yedeği açıklanır | Kaynak/build |
| AUD-019/020 | Borsa/analiz/karar/hedef yardımcı sorgularında hata uyarısı ve yanıltıcı hesapları durdurma | Kaynak/build; mevcut sorgu/regresyon testleri |
| AUD-021 | Gün damgasına bağlı hesap, dakika/focus/visibility güncellemesi, ortak maaş günü, son gün en az 1 | Saat 00/12/23 maaş günü regresyonu + kaynak/build |
| AUD-022 | Negatif likit harcanabilir hesabında korunur | Negatif bakiye saf hesap testi |
| AUD-023 | Acil vade yalnız ödenebilir nakit çıkışı | Kaynak/birim/build |
| AUD-024 | Artık borç “Taksit / sınıflanmamış borç” etiketi | Kaynak/build; ledger modeli değişmedi |
| AUD-025 | Kirli form kapat/Escape/geri ve SW koruması | Gerçek tarayıcıda üç iptal + onaylı kapatma; gerçek SW update düğme odağında 0 reload |
| AUD-026 | Rota belge başlığı | 5 rota birbirinden farklı başlık testi |
| AUD-027 | Mutabakat kuruş düzeyinde karşılaştırılır | equalsTL kullanımı ve para yardımcı testleri |
| AUD-028 | Gizli alanda Türkçe sayı parseNumber ile çözülür | Kaynak/build ve sayı parser testleri |
| AUD-029 | PNG “En büyük 5 kategori”, iki ondalık | Kaynak/build; gerçek banka raporu/cihaz kapsam sınırı korunur |

Kanıt logları audit-20260909.local altında: fix-verify-complete.log, fix-db-tests2.log, fix-db-final.log (45/45), fix-db-dirty.log (önceki başarısız cascade kontrolü), fix-e2e2.log (2 hedef geçti; eski kart seçicisi hatası sonraki koşuda giderildi), fix-money4.log, fix-browser-results.json, fix-sms-results.json, fix-pwa-results.json. Saniyesiz mesajda eventId yoksa mevcut güvenli 409 sözleşmesi korunur; gerçek kullanıcının özgün SMS metni görülmedi.

Yerel imaj notu: authenticated rolüne geçtikten sonra izinsiz RPC'yi PL/pgSQL EXCEPTION içinde yakalama denemesi Postgres SIGSEGV üretti. Yetki ACL üzerinden, servis çağrısı ve sahiplik filtresi gerçek SQL/HTTP ile doğrulandı. Bu ortam çökmesi nedeniyle etkilenen ardışık testler tekrar çalıştırıldı; hata sessizce atlanmadı.

## Ortam ve kanıt

- Başlangıç HEAD: `f6a90b5d0aba7b6b58471a689f828428435fa528`; çalışma ağacında önceden değişiklikler mevcut.
- Güncel kanıt kökü: `audit-20260909.local/` (git dışı); 10 Eylül turu `resume-0910/` altında.
- **Kanıt kaybı:** ilk turdaki `test-results/audit-2026-09-09/` klasörü Playwright çıktısı temizlenirken silindi. Başlangıç DB yedeği de buradaydı; Docker kopyası reset sonrasında bulunamadı. Kullanıcıya bildirildi. İlk tur sonuçlarının aşağıdaki tarihsel kaydı korunuyor fakat silinen dosyalar bağımsız tekrar inceleme kanıtı sayılmıyor. Üretim verisine dokunulmadı.
- 10 Eylül devam HEAD: `89b2ce0`; Claude'un limitte kesilen oturumundaki iki kaynak incelemesi `claude-completed-audits.txt` içine alındı. Bunlar doğrulanmış ürün bulgusu değil, aday listesidir.
- Devam öncesi mevcut DB yedeği: `resume-0910/before.dump` (1.045.726 bayt). Bu, kaybolan ilk yedeğin yerine geçmez. Devam turunda DB reset yapılmadı.
- 11 Eylül başlangıç yedeği: `resume-0911/before.dump`. Silme/restore için yalnız denetimde oluşturulan `audit-restore@local.test` hesabı kullanıldı; ana seed hesabı sıfırlanmadı.
- Uygulama: `http://localhost:5173`; API: `http://127.0.0.1:55321`.
- Hesap: yerel seed kullanıcısı. Üretim verisi denetim kapsamında değil.
- Kanıt türleri ayrı tutulur: kaynak incelemesi, mevcut otomatik test, gerçek DB senaryosu, arayüz işlemi, görsel inceleme.
- Durumlar: bekliyor / geçti / hata / engelli. Bir sayfanın açılması bütün işlemlerinin geçtiği anlamına gelmez.

## Başlangıç ölçümü

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Lint, birim test, bağımlılık audit, build | Geçti; 134 dosya / 1463 test; 0 prod bağımlılık açığı | `verify.log` |
| Bundle bütçesi | Hata: index.js 20.1 kB > 20 kB | `verify.log`; edge kontrolüne ulaşılmadı |
| Mevcut SQL testleri | Bir hata: savings_goal_snapshots.sql | `db-tests.log`; sınıflandırma sürüyor |
| Yerel tarayıcı giriş | Geçti; gerçek formdan seed hesabıyla giriş ve Özet açılışı | İlk PNG kayıp; 10 Eylül gerçek giriş tekrarlandı |
| 10 Eylül kalite kapısı | Lint, 1463 test, audit ve build geçti; bundle yine 20.1/20 kB | `resume-0910/verify.log` |

## Bulgular

### AUD-001 — Başlangıç sürümü paket boyutu kapısından geçmiyor

- Tür: teslimat/performans kapısı; öncelik P2.
- Tekrar: `npm run verify`.
- Beklenen: giriş paketi gzip ≤20 kB; gerçek: 20.1 kB.
- Etki: doğrulama komutu başarısız; bu sonuç tek başına kullanıcıya hissedilir yavaşlık kanıtı değildir.
- Öneri: değişikliklerin giriş paketine etkisini incele; bütçeyi gerekçesiz yükseltme.

### AUD-002 — Hedef fotoğrafı SQL testi mevcut kullanıcı verisinden etkileniyor

- Tür: test izolasyonu; öncelik P2; doğrulandı.
- Tekrar: mevcut demo kullanıcısının fotoğrafı varken `npm run db:test:all`.
- Gerçek: `cascade fotoğrafları silmedi (1 satır)`.
- Kaynak: test yalnız kendi hedefini silip kullanıcının bütün fotoğraflarını sayıyor.
- Öneri: cascade ve RLS doğrulamasını testin oluşturduğu hedef kimliğine daralt; temiz seed üzerinde karşılaştır.
- Karşılaştırma: 9 Eylül temiz reset/seed sonrası **44/44 SQL testi geçti** (ilk `db-tests-clean.log` kayıp; oturum çıktısında gözlendi). Bu bulgu bir cascade ürün hatası değildir. Sonraki kirli fixture turunda `stock_trades.sql` da seed'in sabit THYAO adetlerine bağımlı olduğundan etkilenmiştir; ürün regresyonu diye sayılmamalı.

### AUD-003 — Asgari ödeme limiti eski mevzuata göre hesaplanıyor

- Tür: finansal yönlendirme; öncelik P1; kaynak + resmi karar + 9 Eylül UI senaryosuyla doğrulandı.
- Kaynak: `src/utils/financeObligationRules.ts`, `MINIMUM_PAYMENT_TIER_LIMIT = 25000`, karşılaştırma `>=`.
- Uygulama: 25.000–50.000 TL dahil limitlerde %40 gösterir.
- Beklenen: BDDK 26.09.2024/10970 kararı, 50.000 TL ve altı %20; üstü %40.
- Örnek: 40.000 TL limit / 10.000 TL ekstre için 4.000 yerine 2.000 TL.
- Resmi kaynak: https://www.bddk.gov.tr/Mevzuat/DokumanGetir/1255 (denetimde erişildi).
- Etki: ödeme çekmecesindeki asgari tutar ve bu oranı kullanan yönlendirmeler yanlış; ledger tutarının kendiliğinden bozulduğu iddia edilmiyor.
- Öneri: eşik ve eşitlik sınırını birlikte değiştir; 24.999,99 / 25.000 / 49.999,99 / 50.000 / 50.000,01 sınırlarını test et; domain belgesini güncelle.
- UI doğrulaması: 40.000 limitli kart / 10.000 ekstre → düğme `Asgari tahmini (4.000,00 ₺)`. Tekrar kanıtı korundu: `resume-0910/minimum-drawer.txt/png`.

### AUD-004 — Gelecek tarihli hisse işlemi bugünkü pozisyona katılıyor

- Tür: finansal gösterim; P1; UI kaydı + DB + kaynak ile doğrulandı.
- Adımlar: Borsa → Geçmiş işlem ekle/düzenle → THYAO alış, 10 adet, 300 TL, 09.10.2026; denetim günü 09.09.2026.
- Beklenen: gelecek tarih reddedilmeli veya bugünkü pozisyondan çıkarılmalı.
- Gerçek: DB tarihi 2026-10-09 olarak kabul ediyor. Defter adedi 100→110, kalan maliyet 29.355,83→32.355,83; varlıkta 100 adet olduğu için yanıltıcı uyumsuzluk oluşuyor.
- Kaynak: `BorsaOverview` pozisyonu `projectStockPositions(trades)` ile tarihsiz kuruyor; dönem hesabı ise `end=today` ile filtreliyor. Aynı ekrandaki ölçümler farklı tarih kapsamı kullanıyor.
- Kanıt durumu: ilk `borsa-future-confirmed.txt/png` kayıp; sonraki `mobile-light-varliklar-borsa.txt/png` turunda 110 adet görünür. İlk tarih doldurma denemesi boş kaldığından bugüne düşmüştür; o deneme gelecek-tarih kanıtı değildir. Sonraki denemede DOM ve DB tarihi ayrıca doğrulanmıştır. Claude seed'i sonrasında bu işlem mevcut DB'de yoktur.
- Öneri: form ve veri yazma sınırında tarih doğrulaması; tüm bugünkü pozisyon hesaplarında aynı tarih kesiti.
- 11 Eylül tekrar kanıtı: `resume-0911/borsa-future.txt/png` ve `borsa-future-db.txt`. 11.10.2026 tarihli 10×300 alış; bugünkü defter 110 adet, varlık 100; DOM tarih değeri ve DB kaydı ayrıca doğrulandı.

### AUD-005 — Hisse fiyatı eksikken sıfır değer ve kesin zarar gösteriliyor

- Tür: finansal gösterim / hata UX; P1; gerçek yerel fiyat eksikliğiyle doğrulandı.
- Adımlar: Borsa, THYAO fiyatı alınamıyor.
- Gerçek: üstte `Fiyat bekleniyor`; dönem bölümünde `Bugünkü değer 0,00 ₺`, `Kazanç −28.435,00 ₺ (-%80,7)`; altta sonuç eksik uyarısı.
- Beklenen: fiyatı eksik portföyün toplam değeri/kazancı bilinmiyor olmalı, sıfır veya gerçekleşmiş zarar gibi sunulmamalı.
- Kaynak: `stockPeriodPerformance` eksik sembolü toplamdan atıp kısmi rakam döndürüyor; `BorsaPage` bu rakamları kesin değer görünümünde basıyor.
- Kanıt: sonraki `mobile-light-varliklar-borsa.txt/png` ve `desktop-dark-varliklar-borsa.txt/png`; ilk `borsa-future-confirmed` dosyaları kayıp. Fiyat sağlayıcı erişilememesi ortam kısıtı; bu durumu yanlış rakamla sunmak ürün bulgusudur.
- Öneri: eksik fiyat varsa toplam kazanç ve oranı gizle; varsa hesaplanabilen kapsamı ayrı ve açıkça belirt.

### AUD-006 — Gizlilik modu alt bölümlerde kişisel tutarları açık bırakıyor

- Tür: gizlilik / UX; P2; UI doğrulandı.
- Adımlar: Borsa → Tutarları gizle.
- Gerçek: toplamlar maskeli; işlem satırında `70 × ₺285,00 · komisyon ₺15,00`, pozisyonda `110 adet · ort. ₺294,14` görünür.
- Etki: saklanan alış tutarı çarpma/toplamayla aynen çıkarılabilir. Bunlar kamuya açık fiyat değil, kullanıcının adet/maliyet bilgileridir.
- Kanıt: `mobile-private-varliklar-borsa.txt/png`; ilk `borsa-privacy` dosyaları kayıp.
- Genişletilmiş UI kanıtı: `mobile-private-odemeler-hedefler.txt` hedef 145.000/300.000 ve aylık 15.500; `mobile-private-odemeler-liste.txt` 28.000/18.000; `mobile-private-odemeler.txt` 4.800/22.000/700/230; `mobile-private-kartlar-islemler.txt` cümle içi 1.500 TL provizyon. Ortak düğme gizlemeyi açmışken bu alanlar görünür.
- 10 Eylül dolu veriyle Araçlar ve Gider grupları da doğrulandı: `resume-0910/car-private-settled.txt` 2.000,01 TL yakıt; `resume-0910/context-private.txt` 850,01 TL toplam, 11.650 TL kalan bütçe, 250,01/600 TL satırlar. Her ikisinde düğme `Tutarları göster`, yani gizleme açık. `context-private-controls.txt` ve PNG de kaydedildi.
- Veri Kontrolü detayları kaynak adayı olarak kalıyor. Eski `car-privacy` dosyasında tıklamayı toast engellediği için o dosya gizlilik kanıtı sayılmaz; 10 Eylül dosyaları bu boşluğu kapatır.
- Öneri: kişisel adet, alış maliyeti ve komisyon gösterimlerini gizlilik sözleşmesine bağla.

### AUD-007 — Veri Kontrolü sorgu hatasında temiz raporu veriyor

- Tür: yanlış güvence / hata UX; P1; 10 Eylül gerçek tarayıcıda doğrulandı.
- Tekrar: oturum açıkken REST isteklerine 500 döndür; `/veri-sagligi` aç; yeniden denemelerin bitmesini bekle.
- Gerçek: `0 bulgu`, `8 alanın hepsi temiz`, `Tutarlı`, `Kayıtlar temiz görünüyor` ifadeleri; aynı ekranda art arda ham hata metinleri.
- Beklenen: veri alınamadığı için denetim sonucu belirsiz gösterilmeli; temiz ve tutarlı rozetleri çizilmemeli. Tek bir anlaşılır hata ve yeniden deneme yolu yeterli.
- Kanıt: `api-error-veri-sagligi.txt/png`; PNG görsel olarak incelendi. `settled-errors-results.json`: 19 rota, yakalanmamış JS istisnası yok.
- Kaynak: `src/pages/DataHealthPage.tsx`, yükleme hatasından sonra boş veri üzerinden başarılı durum sunumu.

### AUD-008 — Alışveriş listesi sunucu hatasını boş liste olarak sunuyor

- Tür: veri görünürlüğü / hata UX; P2; 10 Eylül UI doğrulandı.
- Tekrar: iki kayıt içeren seed hesabında REST 500 → `/odemeler/liste`.
- Gerçek: `0,00 ₺`, `0 bekleyen · 0 tamamlanan`, `Henüz bir madde eklenmedi`; hata ve tekrar dene yok.
- Beklenen: kayıtların bilinmediği açıkça söylenmeli; sıfır toplam ve boş liste mesajı bastırılmalı.
- Kanıt: `api-error-odemeler-liste.txt/png`; aynı hesabın JSON yedeğinde iki wishlist kaydı mevcut.
- Kaynak: `src/pages/WishlistPage.tsx`, sorgunun hata durumu tüketilmiyor.

### AUD-009 — Ortak liste ekranları hata ile gerçek boş durumu birlikte gösteriyor

- Tür: hata UX; P2; UI + kaynak doğrulandı.
- Varlıklar/Altın gibi ekranlarda 500 sonrasında ham hata metni yanında `0 KAYIT` ve `Henüz ... yok` çıkıyor; Kartlar sekme sayaçları 0'a düşüyor.
- Beklenen: başarısız sorgu için ayrı durum; başarılı boş sorgu için boş liste. Varlıklardaki banka sorgusuna ait `Tekrar dene`, ana varlık sorgusunun tekrar denemesiyle karıştırılmamalı.
- Kanıt: `api-error-varliklar.txt`, `api-error-varliklar-altin.txt`, `api-error-kartlar.txt`; `src/components/CrudPage.tsx` veri yoksa boş diziye düşürüyor.
- Kapsam sınırı: bütün REST çağrılarının 500 olduğu tur bunu doğrular; yalnız ikincil sorgunun bozulduğu Claude adayları ayrıca denenmeli. İlk 503 turu kütüphane yeniden denemeleri sürerken görüntülendiğinden nihai hata kanıtı değildir.

### AUD-010 — Sırası gelmeyen kredi taksitinin ödeme akışı başlatılabiliyor

- Tür: işlem UX; P2; 9 Eylül UI doğrulandı.
- 14. taksit beklerken 15. taksitin `Öde` düğmesi aktif; çekmece doldurulup gönderilince `Once siradaki taksit odenmeli...` hatası geliyor.
- Sunucu sıralamayı koruyor; yanlış ödeme kaydı oluştuğu iddia edilmiyor. Kullanıcı gereksiz form dolduruyor.
- Öneri: ödeme yalnız sıradaki taksitte aktif olsun veya tıklamada neden açıkça bildirilsin; hata Türkçe karakterlerle sunulsun.
- Kanıt: `loan-out-of-order.txt/png`; sıradaki ödeme sonrasında `loan-paid.txt`.

### AUD-011 — Araç yakıt miktarı hatası ham SQL kısıtıyla gösteriliyor

- Tür: form doğrulama / dil; P2; 9 Eylül UI doğrulandı.
- Yakıt kaydı 2.000,01 TL, -40 litre, 50.000 km gönderildiğinde DB reddediyor; `car_expenses_fuel_liters_check` kısıt adı kullanıcıya gösteriliyor.
- Beklenen: kaydetmeden litre alanında pozitif değer açıklaması; API hatası için anlaşılır yedek mesaj.
- 10 Eylül tekrar kanıtı: `resume-0910/car-negative.txt` ham hata metnini içeriyor; 40 litreye düzeltilince kayıt geçti. İlk turdaki toast yakalama belirsizliği giderildi.
- Aynı hata sunumu sorunu PDF importunda da doğrulandı: bozuk PDF için `Invalid PDF structure.` doğrudan gösteriliyor. `resume-0911/import-broken-confirmed.txt`; dosya Playwright buffer ile yüklendi. İlk CLI dosya okuma hatası araç kaynaklı olabileceğinden kanıt sayılmadı. Öneri: PDF çözümleme hatasını Türkçe, dosyayı yeniden seçme yönlendirmesiyle göster.

### AUD-012 — Negatif alışveriş fiyatı sessizce bilinmeyen fiyata dönüşüyor

- Tür: form doğrulama; P2; 9 Eylül UI + DB doğrulandı.
- Listeye -500 fiyat girip kaydet → kayıt oluşuyor, fiyat NULL. Kullanıcıya neden belirtilmiyor.
- Beklenen: negatif değer reddedilsin; fiyatı bilinmeyen kayıt için alanı boş bırakma davranışı ayrı kalsın.
- Kanıt: `wishlist-negative.txt`, `wishlist-db.txt`.

### AUD-013 — Mobil Kasa modu özetinde para tutarları kesiliyor

- Tür: görsel / okunabilirlik; P2; 390 px ekran görüntüsü + kaynak doğrulandı.
- Likit, Rezerve, Rezerv sonrası aynı satırda üç dar sütun: `213.153...`, `60.000,...`, `153.153...`; son başlık da kesiliyor.
- Beklenen: finansal tutarların tamamı okunabilmeli; mobilde sütunları azaltma veya satır kırma.
- Kanıt: `mobile-light-odemeler-hedefler.png`, görsel olarak incelendi. `KasaModuPanel.tsx` üçlü özet; `FinanceUI.tsx` MiniStat değerinde `truncate`, tam değeri açan bir kontrol yok.

### AUD-014 — Canlı işlem testleri güncel arayüz adımlarından kopmuş

- Tür: otomatik test bakımı; P2; 10 Eylül yerel Playwright ile doğrulandı.
- `goal-sources.spec.ts` hedefe `Ayır` tıklayıp hemen `bu ay ayrıldı` bekliyor. O sırada `Kovaya ayır?` onay diyaloğu açık ve gerçek işlem henüz yapılmamış.
- Kanıt: `resume-0910/e2e-live.log` ve `playwright-live/goal-sources-.../error-context.md`.
- Ürün ödeme/rezerv hatası değildir. Test gerçek onay adımını tamamlayıp kayıt ve yenileme sonrası durumu kontrol etmeli.
- Ayrı ortam eksikliği: `money-mutation.spec.ts` sabit `Akbank · Axess E2E` fixture'ı bekliyor; mevcut seed'de olmadığı için henüz işlem adımına ulaşamadı. Bu sonuç ürün hatası olarak sayılmadı.
- Fixture eklendikten sonra tekrarlandı: harcama ekleme geçti, test artık bulunmayan `/Kartlar/` düğmesini bekleyerek 55. satırda durdu. Güncel düğme `Kredi kartları ...`; `resume-0910/e2e-money-seeded.log`. Bu ikinci durum test bakım bulgusudur, eksik fixture değildir.

### AUD-015 — Araç hatırlatıcı türü ve manuel taksit alanlarının etiket bağlantısı yok

- Tür: erişilebilirlik; P2; DOM/erişilebilirlik ağacı + kaynak doğrulandı.
- Araçlar'daki hatırlatıcı türü `combobox` adı olmadan geliyor. 320/375 px taramasında tek etiketsiz select: `/varliklar/araclar`; `resume-0911/mobile-widths.json`.
- Ekstre importunda beş `Toplam taksit` metni input'a bağlı değil: `labels=0`, `aria-label` ve `aria-labelledby` yok. Placeholder yalnız `≥3`; hangi harcamanın toplam taksiti olduğu kontrolün adından anlaşılmıyor.
- Kanıt: `resume-0911/import-field-labels.json`; `StatementImportModal.tsx` satır başına görsel label kardeş input'a `htmlFor/id` ile bağlanmamış.
- Öneri: araç hatırlatıcı türüne anlamlı etiket; her manuel taksit alanına satır açıklamasını içeren benzersiz ad ve gerçek label bağlantısı.

### AUD-016 — Geçerli kart SMS'i yerel şemada yetki hatası yüzünden işlenmiyor

- Tür: uçtan uca otomasyon / yetki sözleşmesi; P1; gerçek Edge HTTP + DB ile doğrulandı.
- Ortam: yerel Edge Runtime, mevcut migration şeması, yalnız `audit-restore` sahibine sınırlandırılmış webhook. Takma ad `7733` mevcut, geçerli DenizBank kart SMS'i 123,45 TL.
- Gerçek: `/functions/v1/parse-sms` HTTP 502, `Kart sorgusu başarısız.`; harcama/provizyon yazılmıyor, sahipli sms_log hata satırı oluşuyor.
- Kök neden: `supabase/functions/parse-sms/index.ts` kart yolunda `card_aliases?...select=...,cards(...)` REST sorgusunu service_role ile yapıyor. Yerel DB'de `has_table_privilege(...,'SELECT')` hem `card_aliases` hem `cards` için false; sms_log INSERT true. Bu yol, alt RPC'ye gelmeden kesiliyor.
- Kanıt: `resume-0911/sms-http.json`, `sms-permissions-db.txt`, `sms-before.txt`, `sms-edge.log`. Üretim yetkileri kontrol edilmedi; üretimde de kesin bozuk iddiası yok.
- Karşılaştırma: aynı çalışan Edge ortamında hesap SMS'i iki kez HTTP 200; hesap 1.000→1.123,45, tek 12.345 kuruş deposit. Böylece bütün Edge bağlantısının bozuk olması elendi: `sms-account-http.json`, `sms-account-db.txt`.
- Test boşluğu: üç SQL SMS regresyonu geçti; bunlar kart çözümleme REST yolunu atlayıp RPC'leri doğrudan çağırıyor.
- Öneri: kart çözümlemesini sahiplik ve tekil eşleşme kontrolleri olan dar bir RPC'ye taşı veya gereken en dar okuma yetkisini bilinçli tanımla; service_role'a bütün tabloları açma. Gerçek HTTP→çözümleme→RPC→ledger regresyonu eklenmeli.

## Gerçek arayüz işlem günlüğü

### AUD-017 — Saniyesiz hesap transfer SMS'i reddediliyor

- P1; kullanıcı bildirimi ve yerel Edge üzerinde sentetik tekrar. `11.09.2026 12:10'da ... gondericisinden ... numarali hesabiniza 123,45 TL tutarinda HAVALE islemi gerceklesmistir.` mesajı `SMS formatı tanınamadı` yanıtı verdi. Kullanıcının özgün SMS metni görülmedi.
- `src/utils/smsParser.ts:63` ve `supabase/functions/parse-sms/index.ts:150` eski hesap transfer deseninde saniyeyi zorunlu tutuyor. Alternatif `HAVALE ile ... para girisi` deseni saniyeyi zaten opsiyonel kabul ediyor; destek formatlar arasında tutarsız.
- Yapılacak: iki parser'da saniye hassasiyetini tutarlı destekle; mevcut dakika hassasiyeti/tekrar önleme sözleşmesini koru. Saniyeli/saniyesiz, FAST/HAVALE/EFT, gelen/giden ve tekrar SMS testleri ekle. Henüz düzeltilmedi.

### AUD-018 — CSV yedek etiketi eksik kapsamı açıklamıyor

- P2; aynı akışta indirilen JSON/CSV karşılaştırıldı: CSV 74 satır, gömülü JSON/id eşleşmelerinde 0 hata; JSON'da bulunan 12 dolu tablo CSV'de yok.
- Eksikler arasında `gold_lots`, `stock_trades`, `card_ledger`, `account_ledger`, `kasa_buckets`, `wishlist_items` var. Kanıt: `resume-0911/csv-comparison.json`.
- `DataHealthOperationsPage.tsx` düğme/başarı metni `CSV yedek`; `DataHealth.actions.ts` sınırlı `exportTables` listesi kullanıyor. Tam JSON geri yükleme ayrı çalışıyor; DB'de veri kaybı gözlenmedi.
- Yapılacak: CSV kapsamını tamamla veya kısmi dışa aktarım adı ve kapsam açıklaması kullan.

### AUD-019 — Borsa varlık sorgusu hatasında yanlış düzeltme öneriyor

- P2; ayrı audit kullanıcısında gerçek tarayıcı ve yalnız assets GET isteğine 500 enjeksiyonu ile doğrulandı. Normal yüklemede uyuşmazlık yok; aynı kayıtlarla assets sorgusu üç kez başarısız olduğunda `THYAO defterde 100, varlıkta 0 adet` uyarısı çıkıyor.
- Ekran, yükleme hatasını açıklamak yerine `açılış satırını sil` ve elle düzeltme öneriyor. Sağlıklı veriye gereksiz müdahale riski var; testte hiçbir kayıt değiştirilmedi.
- Kök neden: `BorsaPage.tsx:343` başarısız assets sorgusunu boş diziye dönüştürüyor; durum kontrol edilmeden `stockLedgerDrift` hesaplanıyor.
- Kanıt: `resume-0911/borsa-secondary-error.json`, `borsa-baseline.txt`, `borsa-assets-error.txt`; tekrar script'i `scripts/audit-borsa-error-20260911.mjs`.
- Yapılacak: varlık sorgusu başarıyla tamamlanmadan tutarlılık sonucu/düzeltme önerisi gösterme; hata ve yeniden deneme durumu sun.

### AUD-020 — Analiz yardımcı sorgu hatasını geçmiş yokmuş gibi sunuyor

- P2; yalnız `net_worth_snapshots` GET 500 olduğunda Ana Analiz açılıyor fakat geçmiş grafiği, veri birikmesi gerektiğini söylüyor; sorgu hatası görünmüyor. `analysis-snapshots.txt`, `remaining.json`.
- Kaynak: `AnalysisPage.data.ts:92–141` net değer ve fiyat radarı hatalarını boş diziye çeviriyor. Son turda yalnız radarın `transaction_history?type=eq.payment` sorgusu da 500 ile kesildi; hata görünmedi (`last-cases.json`, `price-radar-error.txt`).
- Karar ekranında `savings_goal_snapshots` hatası da gizleniyor (`decision-snapshots.txt`); mevcut fixture tarihli hedef önerisini üretmediğinden yanlış tarih gösterildiği iddia edilmiyor.
- Yapılacak: yardımcı verinin boş/hatalı durumlarını ayır; ana raporu açık tutarken ilgili bölüme hata ve yeniden deneme ekle.

### AUD-021 — Özetin tarih hesapları tek gün/ay durumunu paylaşmıyor

- P1 ay değişimi, P2 son gün metni; gerçek tarayıcı saatiyle doğrulandı. 30 Eylül'de `0 gün kaldı · günde 49.974,06 ₺` yazıyor: metin 0 gün, bölme işlemi 1 gün kabul ediyor.
- Aynı açık sekmede 1 Ekim'e geçip odak olayı gönderilince gün sayacı 30 oluyor; ana tutar 49.974,06 ve Eylül alacağı kalıyor. Yeniden yüklemede ana tutar 122.477,57 oluyor, eski alacak açıklaması kalkıyor. Canlı değerleme küçük kuruş değişimleri üretebilir; ay ve alacak farkı bu değişimle açıklanamaz. Kanıt: `rollover.json`, `rollover-before/focus-after/reload-after.txt`.
- Kaynak: `DashboardPage.tsx` günlük damgayı yalnız `monthMeta` için kullanıyor; aylık özet/veri memoları aynı gün anahtarına bağlı değil. `SeritOverview.tsx:141` ile günlük bölen farklı.
- Ek saf hesap tekrarı: ilk iş günü 1 Ekim 12:00'de 10.000 TL maaş için aylık özet beklenen geliri 0; kart döngüsüne verilen aynı gün gece yarısı ile ileri projeksiyon maaşı 10.000 sayıyor. `domain-checks.json`. Kaydedilen maaşın nakit hareketi olmadığı sözleşmesi korunarak tüm hesaplara ortak kesme zamanı gerekli.

### AUD-022 — Negatif banka bakiyesi harcanabilir hesapta eksik sayılıyor

- P1; saf gerçek fonksiyonlarla sınır verisi doğrulandı. Likit −2.000, gelir 0, çıkış 10.000, tampon 5.000 → `buildSafeToSpend` −15.000; cebirsel kalan −17.000.
- `buildFinancialPosition` negatif bakiyeyi koruyor, `safeToSpend.ts:51` sıfıra kırpıyor. Banka bakiye alanında negatif değeri engelleyen `min` yok. Gerçek hesaba negatif bakiye yazılmadı.
- Kanıt `domain-checks.json`; öneri: negatif bakiyeyi koru veya KMH borcunu başka yerde sayan açık bir sözleşme kur; aynı borcu iki kez sayma.

### AUD-023 — Bilgi amaçlı taksit ödenecek yakın vade gibi öneriliyor

- P2; `buildFocusActions` gerçek fonksiyonu, `action:null`, nakit etkisi 0 olan bugünkü kart taksitinden `1 vade 3 gün içinde` ve vadeleri kaçırmama önerisi üretiyor.
- Kaynak `dashboardInsights.ts:63`; yalnız tarih filtresi var. Kanıt `domain-checks.json`. Öneri: ödeme gerektiren kalemleri ayır; bilgi amaçlı taksitleri acil nakit vadesine sayma.

### AUD-024 — Sınıflanmamış kart borcu gelecek taksit diye etiketleniyor

- P2; gerçek `buildFinancialPosition` fonksiyonuna taksit satırı olmayan, borcu 2.000 ve üç kovası 0 olan kart verildiğinde `totalCardFutureInstallmentDebt=2000` dönüyor.
- Kanıt `domain-checks.json`; `financeSummary.ts:369` borç eksi kovaları doğrudan gelecek taksit sayıyor. Toplam borç yanlış değil, açıklama yanlış. Planlı taksit ve sınıflanmamış fark ayrı gösterilmeli.

### AUD-025 — Tarayıcı geri hareketi kaydedilmemiş formu sessizce terk ediyor

- P2 UX; Kişiler → Varlıklar bağlantısı → Varlık ekle → metin yaz → tarayıcı geri: Kişiler'e dönüyor, modal ve girdi kayboluyor; uyarı yok. `rollover.json`. Bu test Chromium geri gezinmesidir; Android fiziksel geri tuşu ayrıca denenmedi.
- Öneri: mobil/PWA modal geri sözleşmesini belirle; kirli formu terk etmeden onay veya geri kazanılabilir taslak sun. PWA güncellemesinde odak input'tayken koruma ayrıca geçti; her kayıp güncelleme kaynaklı değil.
- Son ek tekrar: yerel üretim önizlemesinde e-posta yaz → Giriş yap düğmesine odaklan (gönderme yok) → SW güncelle. Bir yenileme oldu, yazılan e-posta boşaldı (`pwa-dirty.json`). Koruma yalnız aktif input'a bakıyor; kirli formu izlemiyor. Derleme klasöründeki geçici SW yorumu finally ile geri alındı, uygulama kaynağı değiştirilmedi.

### AUD-026 — Rota değişiminde tarayıcı başlığı sabit kalıyor

- P3; Kişiler/Varlıklar ve genel rota turunda `document.title` hep `Denge`. Geçmiş/sekme/ekran okuyucu başlığından bölüm ayırt edilemiyor. `rollover.json`, `sweep.json`.
- Öneri: mevcut rota başlığını `Denge` ile birlikte document title'a taşı.

### AUD-027 — Ekstre farkı paneli 1 TL ve altındaki farkları gizliyor

- P2; kaynak doğrulaması: `ReconciliationPanel.tsx:24–46`, `DELTA_THRESHOLD=1`, yalnız mutlak fark >1 ise satır oluşuyor; diğerleri `mutabık` kabul edilip gösterilmiyor. 0,50 veya 1,00 TL farkı görünmez, 1,01 görünür.
- Yardım metni banka ile uygulama tutarını karşılaştırdığını söylüyor; bu eşik açıklanmıyor. Kuruş sözleşmesiyle tutarsız. Bu turda gerçek ekstre tutarı değiştirilmedi; kaynak kanıtı UI yazma testi olarak sunulmuyor.
- Öneri: kuruş hassasiyeti veya açıkça belgelenmiş ürün eşiği; eşik için sınır testi.

### AUD-028 — Gizlilik açıkken Türkçe tutar kart senaryosunu kaybettiriyor

- P2; Özet → tutarları gizle → Kart harcamam devam ederse. `1250.50` girilince senaryo tablosu var; `1.250,50` girilince tablo kayboluyor, doğrulama açıklaması yok. `last-cases.json`.
- Gizlilik modunda alan password olduğu için Türkçe yazım kabul ediliyor; `CardPaymentCyclePanel.tsx` ham `Number(extra)` kullanıyor. Ortak `parseNumber` ve açık geçersiz girdi durumu gerekli. Gizlilik kapalı number input için aynı metnin tarayıcı tarafından kabul edildiği iddia edilmiyor.

### AUD-029 — İndirilen finansal görselin kapsamı ve tutar hassasiyeti belirsiz

- P3; PNG başarıyla indirildi ve görsel incelendi. Ekranda kuruşlu toplamlar varken görsel tam TL'ye yuvarlıyor; `Kategori dağılımı` yalnız ilk beş kategoriyi gösteriyor, kalan kategorilerin dışarıda kaldığını belirtmiyor.
- Kaynak `shareableCard.ts`: `maximumFractionDigits:0`, `categories.slice(0,5)`. Kanıt `analysis-report-finansal-ozet-eylül-2026.png`; örnekte beş yüzde toplamı %81, kalan dağılım açıklanmıyor. Bu, DB veya toplam hesap bozulması değildir.
- Öneri: `En büyük 5 kategori` ve yuvarlama açıklaması ya da kalan kategorileri `Diğer` altında topla; paylaşım görselinin para hassasiyetini UI sözleşmesiyle netleştir.

İlk sekiz satır 9 Eylül oturumunda UI + DB ile gözlendi; bu satırlarda adı geçen
ilk kanıt dosyaları yukarıda açıklanan klasör kaybından etkilendi. Bunlar yeniden
indirilebilir dosya bağlantıları değil, tarihsel sonuç kaydıdır.

| Senaryo | Beklenen / doğrulanan | Sonuç / kanıt |
|---|---|---|
| 40 bin limit / 10 bin ekstre asgarisi | %20 = 2.000; uygulama 4.000 | Hata AUD-003 |
| Sıfır hesapla 2.500,01 ödeme | Yetersiz bakiye reddi; bakiye 0 kalır | Geçti |
| 2.500,01 kısmi ekstre ödeme | Hesap 43.990→41.489,99; borç 10.000→7.499,99 | Geçti; `partial-payment-db.txt`, `partial-payment-reloaded.txt` |
| Kalan ekstreyi kapatma | Ödeme kayıtları 2.500,01 + 7.499,99; borç 0; hesap 33.990 | Geçti; `full-payment-db.txt` (7.500 girişi kalan 7.499,99'a sınırlandı; kuruş tolerans sözleşmesi ayrıca incelenecek) |
| 1.200,01 / 3 provizyon kesinleştirme | Borç aynı; provizyon 0; 400 + 400 + 400,01 | Geçti; `card-final-db.txt` |
| 100,01 / 3 taksit | 33,34 + 33,34 + 33,33; ilk taksit dönem içinde | Geçti; `card-final-db.txt` |
| Türkçe tutar 1.234,56 ile harcama | DB 1234.56; form temizlenir | Geçti; `card-expense-db.txt` |
| Eklenen harcamayı iptal | cancelled; borç 2.534,58→1.300,02; yenilemede korunur | Geçti; `card-final-db.txt`, `cancel-reloaded.txt` |

Sonraki kanıtlar `audit-20260909.local/` altında korunuyor:

| Senaryo | Beklenen / doğrulanan | Sonuç / kanıt |
|---|---|---|
| Hesaplar arası 321,09 transfer | Kaynak -321,09; hedef +321,09; toplam aynı | Geçti; `transfer-db.txt` |
| Ali'den 1.000,01 tahsilat | Alacak 5.000→3.999,99; hedef hesap +1.000,01 | Geçti; `debt-collection-db.txt` |
| Sırası gelmeyen kredi taksiti | Sunucu reddeder; UI gereksiz doldurtur | AUD-010; `loan-out-of-order.txt/png` |
| Sıradaki kredi taksiti | 9.250 düşer; kalan 11→10 | Geçti; `loan-paid.txt` |
| Alışveriş fiyatı 12.345,67 | Türkçe tutar kaydı; alındı ve geri al, yenileme | Geçti; `wishlist-db.txt`, `wishlist-undo.txt` |
| Negatif alışveriş fiyatı | -500 sessiz NULL olur | AUD-012 |
| Hedef kasasına 15.500 ayırma | 45.000→60.500; rezerv 75.500; banka hareketi yok | Geçti; `goal-contribute.txt` |
| Altın 2 gr ×5.000,01 alış | Birikim 2 gr; maliyet 10.000,02 | Geçti; 10 Eylül `resume-0910/ui-backup.json` gold_lots |
| Altın 3 gr satış (elde 2) | Alan hatasıyla engellenir | Geçti; `resume-0910/gold-oversell.txt/png` |
| Altın 1 gr ×6.000 satış | Kalan 1 gr, maliyet 5.000,01 | Geçti; `resume-0910/gold-sale.txt` |
| Tarihsiz altın | Kayıt kabul, “Tarih bilinmiyor”, grafikten hariç açıklaması | Gözlendi; bilinçli desteklenen durum, hata sayılmadı |
| Maaş 0 | Kaydedilir; güncel maaş 0; azalış %100 | Gözlendi; sıfır gelir mümkün olduğundan hata sayılmadı. `salary-zero.txt`; ardından negatif denemede eski ref kullanıldığı için negatif sınır kontrol edilmiş sayılmaz |
| Hisse alışında yetersiz hesap | 300,01 işlem reddi | Geçti; `resume-0910/asset-insufficient.txt` |
| Hisse 1 adet alış | Hesap 43.990→43.689,99; miktar 100→101; trade_rpc 300,01 | Geçti; `resume-0910/asset-buy-db.txt` |
| Hisse mevcut miktarı aşan satış | 101 adet eldeyken 102 reddi | Geçti; `resume-0910/asset-oversell.txt` |
| Hisse 1 adet ×400,01 satış | Hedef hesap +400,01; miktar 100; değer 32.475,26 (oransal azalma); trade_rpc kaydı | Geçti; `resume-0910/asset-sale-db.txt`, `asset-sale-reload.txt` |
| Asistan hata yanıtı | Kullanıcı mesajı kalır, tekrar dene sunulur | Hata UX geçti; başarılı model yanıtı ortamda alınamadı. `resume-0910/assistant-submit.txt` |
| JSON / CSV indirme | Dosyalar iner; JSON parse edilir, tablolar ve sayılar mevcut | Geçti; `resume-0910/ui-backup.json/csv`, `backup-shape.json` |
| Bozuk JSON yükleme | “Dosya okunamadı: geçerli bir JSON değil”; restore başlamaz | Geçti; `resume-0910/backup-malformed.txt/png` |
| Geçerli JSON önizleme / Escape | 100 kayıt ve kapsam; onay alanı; Escape ile kapanır | Geçti; `resume-0910/backup-preview.txt/png`. Gerçek silme/restore çalıştırılmadı |
| Gider grubu oluşturma | Sağlık grubu, bütçe 12.500,01 | Geçti; `resume-0910/context-private.txt` |
| Gruba nakit gider ve kart etiketi | 250,01 nakit +600 kart =850,01; kalan 11.650 | UI geçti; `resume-0910/context-private.txt`; etiketleme sırasında ledger değişmediği ayrıca DB ile karşılaştırılmadı |
| Araç ekleme / negatif litre / düzeltme | Araç oluşur; -40 DB reddi ham metin; +40 kayıt başarılı | AUD-011; `resume-0910/car-negative.txt`, `car-private-settled.txt` |
| Gizlilik: araç ve gider grubu | Gizleme açıkken tutarlar görünür | AUD-006; `resume-0910/*private*.txt/png` |
| Yerel hedef kaynağı | Tüm varlıklar kaynağı seçilince birikim türetilir | Geçti; `resume-0910/e2e-live.log` birinci test |
| 11 Eylül ayrı kullanıcı restore döngüsü | 1.234,56 TL tek varlık → JSON → UI sil → boş ekran → UI restore → aynı satır | Geçti; `resume-0911/restore.log`, `isolated-original.json`, `isolated-restored.json`, `isolated-reset.txt`, `isolated-restored.txt/png`. Otomatik silme/restore öncesi yedekler de indirildi; varlık satırı tüm alanlarıyla eşit. İlişkili tüm tablolar bu senaryoda test edilmedi |
| Maaş negatif tutar | -1 yerel form doğrulamasıyla reddedildi | Geçti; `resume-0911/salary-negative.txt`. Tarayıcı validationMessage İngilizce ortam metnidir, uygulamanın Türkçe hata metni değildir |
| Maaş gelecek zam | Bugün 1.000,01; 11 Ekim için 2.000,01; güncel başlık hâlâ 1.000,01 | Geçti; `resume-0911/salary-future.txt`. Gelecek kayıt listede ve trendde görünür, bugünkü maaşa katılmaz |
| İlişkili toplu restore | 100 kayıtlık yedeğin UUID/FK ilişkileri korunarak ayrı kullanıcıya kopyası; 11 tablonun PK kümeleri aynı | Geçti; `resume-0911/relational-checks.json`. 9 kart/hesap, 1 kredi, 24 kredi taksiti, 4 ekstre, 3 kart taksiti, 16 harcama, 3 hisse işlemi, 3 değer olayı, 2 kasa, 1 hedef, 2 liste kaydı. Bu 11 tablonun 216 `_id` ilişki/sahiplik alanı aynı: `relational-fk-checks.json`; tüm kart/banka özetleri eşit. Ledger geçmişi sözleşme gereği export-only, birebir restore iddiası yok |
| Restore sonrası Veri Kontrolü | Türetilmiş alanlar tutarlı; 0 hata, 3 uyarı | `resume-0911/relational-health.txt/png`; uyarılar arasında fixture'ın 0 maaşı ve manuel kart kırılımı var. Uyarı sayısı tek başına restore hatası sayılmadı |
| Bozuk PDF | Dosya reddedilir; İngilizce ham hata | Finans yazımı yok; hata dili AUD-011. `resume-0911/import-broken-confirmed.txt` |
| Sentetik DenizBank PDF önizlemesi | 16 satır +5 manuel doğrulama; belirsiz taksitler aktarımı engeller | Geçti; `resume-0911/import-preview.txt/png`. Kaynak repo parser fixture'ı; gerçek banka PDF düzeninin birebir testi değildir. Özet/satır tutar farkı bilinen kısmi fixture uyarısıdır |
| Toplam taksit sınırı | 3. taksit satırında toplam 2 reddi, toplam 9 kabulü | Geçti; `resume-0911/import-installment-boundary-1.txt`. 9 toplamı sentetik senaryo varsayımıdır |
| Yanlış dönemli ekstre | Haziran kesimi ile mevcut kart takvimi >7 gün fark; aktarım reddi | Geçti; `resume-0911/import-stale-cutoff.txt`; bu bir parser hatası değildir |
| Aynı ekstreyi tekrar aktar | Eylül'e kaydırılmış sentetik tarihler; aynı dosya iki kez UI'dan aktarıldı | Geçti; `resume-0911/import-success-1.txt`, `import-success-2.txt`, `import-repeat-checks.json`. Her tur 24 harcama /45 kart taksiti /1 ekstre; kart borç/kırılımı aynı. Append-only ledger satırlarının sayısının aynı kalması beklenmez; kart borcu/ledger tutarı ayrıca kontrol edildi |
| 320/375 px rota taraması | 22 rota ×2 genişlik; belge genişliği viewport'a eşit | 44/44 ölçüm geçti; `resume-0911/mobile-widths.json`. İçerideki `truncate` tutar kesmeleri geçti sayılmaz; Altın/Borsa/Plan/Analiz adayları listede. İlk ekran PNG'leri `mobile-320-0..21`, `mobile-375-0..21`; tamamı görsel olarak incelenmedi |
| Üç modal klavye kontrolü | Maaş, Altın, Varlık: 11 Tab +11 Shift+Tab; odak içeride; kapatma sonrası açan düğmeye döner | Geçti; `resume-0911/keyboard.json`. Tarih input'u odaktayken ilk Escape Maaş/Altın'da kapanmadı; Kapat düğmesi odaklı Escape geçti. Native tarih alanı davranışı ayrı kaydedildi; evrensel tek Escape başarısı iddia edilmiyor |
| Yerel API'li üretim derlemesi / SW | Service worker kontrolü aktif; statik cache var; API/auth URL'leri cache'de yok | `resume-0911/pwa-results.json`, `pwa-build.log`; önizleme `127.0.0.1:4175`, build ortamı yalnız yerel Supabase |
| Çevrimdışı / tekrar bağlanma | Sıcak Özet hata+tekrar dene, sıcak Liste kabuk; ilk açılan Araçlar genel hata; online dönüşte Özet yüklenir | `offline-warm-home.txt`, `offline-warm-list.txt`, `offline-cold-cars.txt`; `reconnected=true`. Offline veri desteği geçti iddiası yok. `Unexpected token '<'` gürültüsü yerel preview'nin Vercel Analytics script isteğine HTML vermesinden kaynaklanabilecek ortam etkisi; ürün bulgusu sayılmadı |
| BES katkı ile değer düşüşü | 150.000→145.000,01; katkı 10.000,01; bu olay getirisi -15.000; birikimli +5.000→-10.000 | Geçti; ayrı kullanıcı UI + DB: `resume-0911/bes-db.txt`, `bes-reload.txt`. Yeni event kuruş alanları 15.000.000→14.500.001, katkı 1.000.001; geçmiş 3 olay korunur, toplam 4 |
| Bozuk yedek yapıları | Bilinmeyen schema, liste olmayan tablo, yinelenen id → önizleme açılmadan ret | Geçti; `resume-0911/backup-unknown-schema.txt`, `backup-not-array.txt`, `backup-duplicate-id.txt` |
| Geçersiz sayısal alanla restore | Önizleme açılır; RPC reddeder; mevcut kart/kredi/harcama/kart taksiti/kredi taksiti satırları birebir kalır | Geçti; `invalid-backup.log`, `invalid-backup-before.json`, `invalid-backup-after.json`. `backup-semantic-error.txt` mesajı hem “hiçbir veri değişmedi” hem “işlem yarıda kaldıysa” içeriyor; açıklama çelişkisi ve ham SQL dili AUD-011 ailesinin ek örneği |
| Araç hatırlatıcı sınırı | Başlık var ama tarih/km yoksa Hatırlat pasif | Geçti; `resume-0911/reminders.log` |
| Aylık + kilometre tekrarı | 10 Eylül /10.000 km; tamamla →10 Ekim /15.000 km; reload kalıcı | Geçti; `reminder-recurring.txt` |
| Tek seferlik hatırlatıcı | Tamamla → aktif listeden çıkar; reload sonrası yok; tekrarlı kayıt korunur | Geçti; `reminder-completed.txt/png`; silinme davranışı domain sözleşmesiyle uyumlu |
| SMS SQL regresyonları | Hesap idempotency, kart/planlı ödeme ve kişisel borç eşlemesi | Üçü geçti; `sms_account_idempotency.log`, `sms_card_payment_reconciliation.log`, `sms_personal_debt_match.log`; her test rollback ile bitti |
| SMS HTTP hata sınırları | Gizli başlık yok→401; bozuk JSON→400; boş SMS→400; bilinmeyen biçim→422 | Geçti; `sms-http.json`; yalnız yerel test webhook'u |
| SMS HTTP kart harcaması | Geçerli takma ad +123,45 TL →502, finans yazımı yok | Hata AUD-016; tekrar senaryosuna ulaşılamadı |
| SMS HTTP hesap hareketi / tekrar | İki aynı eventId → hesap yalnız +123,45; tek deposit olayı | Geçti; `sms-account-http.json`, `sms-account-db.txt` |

## İlk açılış ve yerleşim taraması

- Korunan `capture-results.json`: 22 rota/alt bölüm × masaüstü koyu 1440×1000, mobil açık 390×844 ve mobil gizlilik = 66 yakalama. `desktop-dark-*`, `mobile-light-*`, `mobile-private-*` metin ve PNG dosyaları.
- Bu turda belge genişlikleri 1440/390 sınırında; yakalanmamış sayfa istisnası yok. İçeride kesilen metin ve sabit öğelerin örtmesi ayrı değerlendirilir; belge taşması olmaması bütün görsel kontrollerin geçtiği anlamına gelmez.
- 19 rota boş kullanıcı + ilk hata turu kaydedildi. 10 Eylül sonlanmış REST 500 turu ayrıca 19/19 tamamlandı: `settled-errors-results.json`. 18 rotada hata metni var; alışveriş listesinde yok. Bu regex sonucu hata UX'inin kaliteli olduğunu göstermez (AUD-007..009).
- 10 Eylül görsel incelenen korunan PNG'ler: mobil Varlıklar, Krediler, Takvim, Analiz, Hedefler; sunucu hatalı Veri Kontrolü; masaüstü yedek önizleme. Uzun tam sayfa görüntüler araçta küçültüldüğünde küçük metinlerin okunabilirliği hakkında kesin hüküm verilmedi.
- Bu ölçüm yatay taşmayı kontrol eder; tüm ekran görüntülerinin görsel incelemesi ve tüm kapalı bölümlerin testi henüz tamamlanmadı.
- Genişletilmiş test verisi `scripts/audit-seed-20260909.sql`; yalnız yerel DB için. İlk mobil turun son kısmında genişletilmiş veri mevcuttu.

## Kapsam matrisi

Her alan için:
normal, boş, geçersiz giriş, sınır tutar/tarih, iptal/geri alma, yenileme sonrası
kalıcılık, hata/yeniden deneme, mobil/masaüstü, açık/koyu tema, gizlilik ve klavye
kontrolleri ayrı değerlendirilir. Uygulanmayan kombinasyon gerekçesiyle belirtilir.

| Alan | İlk açılış | İşlemler | Sınırlar/hatalar | Görsel/erişilebilirlik |
|---|---|---|---|---|
| Giriş/oturum | Geçti; gerçek seed girişi | Giriş, çıkış ve korumalı rotaya tekrar erişim geçti | Eksik oturumda yenileme girişe yönlendi; gerçek refresh-token süresi dolumu ayrıca uygulanmadı | Alan etiketleri ve klavye erişimi gözlendi |
| Özet | Geçti | Bölüm/panel açılışları ve kart senaryosu denendi | AUD-021/022/023/024/027/028; boş/500 ve çevrimdışı hata gözlendi | Masaüstü/mobil/açık/koyu örnekler; tarih saatiyle tekrar |
| Kartlar/hesaplar/işlemler/ekstreler | Geçti | Kısmi/tam ödeme, transfer, provizyon, iptal geçti | AUD-003; sentetik PDF tekrar/taksit/kesim; SMS AUD-016/017 | 3 mod yakalandı; gizlilik AUD-006; açılabilir paneller tarandı |
| Varlıklar/maaş/altın/borsa/araçlar | Geçti | Al/sat, BES, maaş sınırları, araç gideri/hatırlatıcı tekrar ve tamamlama | AUD-004/005/011/019; negatif/gelecek maaş kontrol edildi | Üç modal klavye döngüsü; araç raporu indirildi ve incelendi |
| Krediler/kişiler | Geçti | Sıradaki taksit, tahsilat, silmeden vazgeçme geçti | Sırasız taksit AUD-010; boş/500 | Ekle modalları odak döngüsü, Escape, odağın geri dönüşü geçti |
| Takvim/hedefler/karar/liste/gider grupları | Geçti | Hedef ayır, liste alındı/geri al, grup/gider ekle | AUD-008/012; karar boş/negatif/0/0,01/1.000/çok büyük tutar bozuk sayı üretmedi | Planlı ödeme/hedef modal klavyesi geçti; liste/grup inline form; AUD-006/013 |
| Analiz/ayrıntılar/asistan | Geçti | Asistan gönder/hata, grafik/panel açılışları, PNG indirme | AUD-020; başarılı gerçek AI yanıtı dış sağlayıcı kapsamında | Analiz koyu ekranı ve indirilen görsel incelendi; AUD-029 |
| Veri sağlığı/yedek/ayarlar | Geçti | JSON/CSV, tam reset/restore, ilişkili restore, atomik ret geçti | AUD-007/018; bildirim izni reddi anlaşılır mesaj verdi | Restore modal ve ayarlar mobil örneği incelendi; gerçek push teslimi kapsam dışında |
| Ortak kabuk/PWA/redirect/import | 22 rota açıldı | 10 kapalı panel genişletildi; 22 rotanın erişilebilirlik ağacı kaydedildi | Bilinmeyen rota Özet'e döner; SW/çevrimdışı/yeniden bağlantı/update denendi | 320/375/390 ve son 768 px turu; fiziksel cihaz/ekran okuyucu kapsam dışında; AUD-025/026 |

## Kapanış kanıtları ve kapsam sınırı

- `remaining.json`: yardımcı sorgu enjeksiyonları, altı karar tutarı, bilinmeyen rota ve çıkış. Son login'in `/kartlar` dönüşünü `/` sanan harness beklentisi ilk koşuyu durdurdu; bu bir ürün hatası değil. Eksik oturum adımı `forms.json` ile ayrıca tamamlandı.
- `forms.json` + önceki `keyboard.json`: toplam yedi modalda odak döngüsü/kapatma/geri dönüş. Yerel tarih seçici ilk Escape'i tüketiyor; takvim kapatıldıktan sonraki Escape modalı kapatıyor. İlk script'in anlık `closed:false` sonuçları bu sebeple ürün hatası olarak kaydedilmedi.
- `final-flows.json`: silme iptali → 0 DELETE/PATCH ve yenilemede aynı metin. SW güncellemesi boşta bir kez yeniliyor; input odağında yenilemiyor ve girdi korunuyor. Chromium installability hata listesi boş; gerçek işletim sistemi kurulumunu doğrulamaz. Eski `zeroDaysDaily` regex'i `30 gün` içinde de eşleşiyordu; 1 Ekim bayrağı kanıt değildir, tam metin ve `rollover.json` esas alındı.
- `sweep.json`: 22 rotada 10 kapalı panel açıldı; 768 px'te sayfa taşması veya erişilebilirlik ağacında adsız button bulunmadı. Bu kontrol renk kontrastı veya ekran okuyucu uygunluk sertifikası değildir. Analiz/araç PNG indirmeleri geçti, iki görsel açılıp incelendi.
- `last-cases.json`: engellenmiş bildirim izni anlaşılır Türkçe mesaj verdi. Veri kontrolünün mevcut uyarı örneğinde maskesiz tutar bulunmadı; bütün bulgu varyantlarının gizliliği geçmiş kaynak adayından hareketle geçmiş sayılmadı.

**Dış veri/cihaz gerektiren doğrulamalar:** gerçek YapıKredi ve diğer bankaların PDF düzenleri, kullanıcının özgün saniyesiz SMS metni, Android/iOS kurulum/geri tuşu/push teslimi, NVDA/VoiceOver ile tam gezinme, gerçek AI sağlayıcısından başarılı yanıt. Bunlar yerelde sentetik veriyle geçti sayılmadı. Kart SMS HTTP tekrar senaryosu AUD-016'nın düzeltilmesine bağlı.

**Kapsamın matematiksel sınırı:** sayfa ve temel işlem aileleri tarandı; her alanın tüm değerleri, her ekran boyutu, her kombinasyon ve tüm banka sürümleri tüketilemez. 66 ilk görüntünün tamamı piksel piksel incelenmedi; seçilmiş görsellerin incelemesi ve ayrı genişlik ölçümleri yapıldı. Her CRUD alanının bütün düzenleme kombinasyonları veya gerçek token yenileme süresinin dolması için başarı iddiası yok. Bu belgeyi "hiçbir olası case kalmadı" şeklinde sunma.

## Claude adaylarının değerlendirilmesi

- Tekrarlanan boş/hata, gizlilik ve ham hata metni adayları AUD-006/007/008/009/011/015/019/020 altında birleştirildi. Altın'daki assets sorgusu yalnız boş-durum köprü metnini etkiliyor; kaynak adayındaki "hero sıfırlanır" iddiası kodla uyuşmadığı için yeni bulgu yapılmadı.
- Tarih, maaş kesimi, negatif likit, bilgi taksiti ve borç sınıflandırması AUD-021–024; mutabakat eşiği AUD-027; özel mod Türkçe tutar AUD-028 olarak ayrıştırıldı.
- "Bugünkü nakit" ile gelecekteki gelir, tampon/rezerv düşülmüş harcanabilir ile brüt projeksiyon aynı ölçü değildir. Sırf farklı oldukları için hesap hatası sayılmadı. Karşılaştırma etiketlerini ve iki farklı veri kontrolü sayacının kapsamını açıklamak düşük öncelikli UX iyileştirmesidir.
- Tarih alanında max olmaması tek başına hata değil: maaş/plan geleceğe kayıt destekler; `type=number` alanına `12x` yazılıp 0 kaydolduğu iddiası normal UI'da doğrulanmadı. Eksik min yerine uygulama doğrulaması olan PDF taksit sınırı geçti.
- Varsayılan format prop'ları, import yükleme fallback odağı, manifest yön/renk tercihi, jargon (TCO/burn-down) ve adsız hedef bileşeni etiketi kaynak incelemesi notlarıdır; tüm varyantlar için runtime hatası iddiası yok. Hedef bileşeni etiketini AUD-015 düzeltmesinde birlikte gözden geçir.
- Route başlığı AUD-026; bilinmeyen adresin Özet'e dönmesi mevcut açık route sözleşmesi olarak kaydedildi. Çevrimdışı API verisi tutulmaması tek başına veri kaybı değildir; yanıltıcı boş/hata metinleri ayrı bulgulardır.
- Formun input yerine düğmesine odaklanıldığı anda SW güncellemesi varyantı son ek turda tekrarlandı: girdi kaybı AUD-025'e dahil edildi. Fiziksel cihaz davranışı ayrıca doğrulanmalıdır.

Denetim sırasında uygulama davranışı değiştirilmedi, migration veya deploy yapılmadı.
Yerel UI senaryoları seed verisini değiştirdi; geri alma için 10 Eylül öncesi
yerel snapshot korunuyor. Testlerin geçtiği alanlar, yalnızca yukarıda açıkça
belirtilen senaryo ve veri kapsamı için geçerlidir.

11 Eylül son kalite kapısı: `resume-0911/verify-closure.log`; lint, 1463 test, prod audit
ve build geçti. `index.js` 20,1/20 kB olduğundan verify yine başarısız; bu turda
uygulama kaynak koduna düzeltme yapılmadı.
