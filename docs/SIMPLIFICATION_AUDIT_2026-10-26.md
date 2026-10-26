# Uygulamayı sadeleştirme incelemesi — 26 Ekim 2026

Durum: **Canlı taramadaki 24 bulgunun sunum düzenlemeleri kullanıcı onayıyla
uygulandı.** Aşağıdaki bulgular uygulama öncesi inceleme kanıtıdır; son durum ve
üretimden bağımsız doğrulama kapsamı plan dosyasının uygulama kaydındadır. Uygulama planı:
`docs/SIMPLIFICATION_PLAN_2026-10-26.md`.
İstek: canlı veriyi değiştirmeden uygulamanın karmaşıklığını, tekrarlarını ve
sayfalar arası görev dağılımını incelemek; uygulama öncesi planı birlikte belirlemek.

## Sonuç

Temel sorun özellik sayısından çok, aynı bilginin farklı ayrıntı düzeylerinde
tekrar sunulması ve sayfaların birden fazla iş üstlenmesi. İlk adım ana menüyü
yeniden kurmak yerine **her işin ayrıntılı yönetimini bir yerde toplamak** olmalı.
Diğer ekranlarda kısa özet ve ilgili yere giden bağlantı yeterli.

Mevcut Mürekkep ve Safir dili, Türkçe adlar, kuruş hassasiyeti, tahmin/kesinlik
açıklamaları ve hızlı ödeme erişimi korunmalı. Tekrar eden her rakam hata değildir.

## Kanıt ve kapsam sınırı

- İlk turda yalnız açık Özet ve hızlı işlem menüsü canlıda incelendi. İkinci
  turda kullanıcı açıkça “Canlı ekranları gez; mevcut otomasyonlar çalışabilir,
  elle kayıt/değişiklik yapma” dedi. Bu izin sonrası diğer ekranlar ziyaret edildi.
- **19 içerik rotasının tamamı Chrome'da masaüstünde açıldı; mevcut görünümü ve
  sayfa içeriği incelendi.** Hesap/kart ayrıntısı, kart borç kırılımı ve dönem
  dökümü, Kişiler'in Sadece takip bölümü ve Harcama ekle görev ekranı da açıldı.
  Ayrıntılar ve Asistan dahil görünen içerik okundu; Asistan'a mesaj gönderilmedi.
- Transfer kısayolunun canlı hedefi denendi: form açılmadan hesap listesine gitti.
  Alsam mı?'da uydurma bir örnek tutarla yalnız kaydedilmeyen hesap önizlemesi
  incelendi ve alan temizlendi. Form gönderilmedi, listeye eklenmedi.
- Kaydetme, silme, düzeltme, aktarım, ödeme, tahsilat, bildirim tercihi/testi veya
  manuel veri yenileme işlemi yapılmadı. Üretim DB'sine doğrudan erişilmedi;
  kişisel tutar/ad/ekran görüntüsü bu rapora kopyalanmadı. İzin verilen mevcut
  otomasyonların çalışmış olması mümkündür; sıfır DB yazması iddia edilmez.
- **Mobil görünüm, tüm açılır ayrıntılar, aktif kredi ve bekleyen alışveriş
  gibi mevcut veride bulunmayan durumlar ve kayıt akışları uçtan uca denenmedi.**
  Bu rapor görsel/erişilebilirlik sertifikası veya finans hesabı doğrulaması değildir.
  Yerel kodla üretim sürümünün commit düzeyinde eşitliği ayrıca doğrulanmadı.

İlk turda canlı gezinmenin sınırlandırılmasının, ikinci turda ise otomasyon
izninin ayrıca netleştirilmesinin somut nedeni:

| Açılışta çalışabilen iş | Kaynak | İncelemeye etkisi |
| --- | --- | --- |
| Finans bakımı | `src/app/useFinanceSnapshot.ts`, `src/data/repositories/financeSnapshotRepo.ts` | Snapshot sorgusu arka planda bakım başlatabiliyor; okuma amaçlı rota ziyareti bütünüyle salt okunur sayılamaz. |
| Günlük net değer/hedef fotoğrafı | `src/components/Layout.tsx`, `src/app/useDailyNetWorthSnapshot.ts` | Gün damgası eksikse gezinme kayıt koşusunu başlatabiliyor. |
| Zamanı gelen ekstre kesimi | `src/pages/CardsPage.sections.tsx`, `src/pages/CardsPage.tsx` | Hesaplar/kartlar sayfası otomatik kesim çalıştırabiliyor. |
| Kurla değer eşitleme | `src/components/finance/RatesBanner.tsx` | Yalnız bilgi bandı gibi görünen bileşen senkron yazması yapabiliyor. |
| Altın defteri → varlık eşitleme | `src/pages/GoldPage.tsx` | Altın sayfasının açılışı varlık kayıtlarını eşitleyebiliyor. |

Bu otomasyonları kaldırmak bu incelemenin önerisi değildir. Sonraki uygulama
prototipi ve finansal kayıt testleri üretimden bağımsız temsili verilerle yapılmalı.

## Sayfa envanteri ve önerilen görev

| Mevcut bölüm / rota | Ekranın cevaplaması gereken soru | İlk düzenleme yönü |
| --- | --- | --- |
| Özet `/` | Bugün durumum ne, sıradaki işim ne? | Ana tutar + en çok üç öncelik/vade; kalan bilgi kısa bağlantılara iner. |
| Hesaplar `/kartlar` | Param nerede, kartta ne ödeyeceğim? | Hesap/kart ayrımı korunur; ayrıntı ve işlemler seçilen nesnede toplanır. |
| Varlıklar `/varliklar` | Portföyümün dağılımı ne? | Toplam ve sınıf özeti; altın/hisse ayrıntısına bağlantı. |
| Maaş `/varliklar/maas` | Gelir kaydım ve değişimi ne? | Yerini ilk pakette değiştirme; Plan'dan bağlamsal erişim değerlendir. |
| Altın `/varliklar/altin` | Ne kadar altınım var, maliyeti ne? | Özet + defter düzenini koru; grafiğin kapalı başlangıcı iyi örnek. |
| Hisseler `/varliklar/borsa` | Pozisyonum ve getirisi ne? | Portföy özeti + defter; gerçek al/sat ile geçmiş kayıt ayrımı açık kalsın. |
| Araçlar `/varliklar/araclar` | Aracın gideri ve yaklaşan işi ne? | Özet/hatırlatıcı önce; yönetim, gider formu ve atama sonra. |
| Krediler `/borclar/krediler` | Sıradaki kredi ödemem ne? | Özet ve sıradaki taksit önce; eski/kapalı planlar ayrıntıda. |
| Kişiler `/borclar/kisiler` | Kimden alacağım, kime borcum var? | Kişi ayrıntısının ana yönetim yeri; sadece takip ayrımı korunur. |
| Ödemeler `/odemeler` | Hangi vadede ne çıkacak/girecek? | Yaklaşanlar/takvim korunur; kayıtlı plan yönetimi ayrı görünüm olur. |
| Bütçe ve hedefler `/odemeler/hedefler` | Harcama sınırım ve birikim planım ne? | Bütçe önce; hedef/rezerv ilişkisi tek görsel akışta açıklanır. |
| Alsam mı? `/odemeler/alsam-mi` | Bu alım önümüzdeki ayları nasıl etkiler? | Ayrıntılı senaryonun tek adresi; ödeme şekli taksitten önce sorulur. |
| Alınacaklar `/odemeler/liste` | Almayı düşündüklerim ne? | Kısa liste + kısa durum; ayrıntılı karar Alsam mı?'da. |
| Gider grupları `/odemeler/baglamlar` | Bu amaç için ne harcadım? | Grup özeti önce; gider ekleme/etiketleme isteğe bağlı açılır. |
| Analiz `/analiz` | Bu ay ne değişti, nereye harcadım? | Aylık rapor ve karşılaştırma önce; kontrol ve yönetim yükünü azalt. |
| Ayrıntılar `/analiz/detay` | Geçmiş kaydım ve özel araçlar nerede? | Geçmiş/arama ile dönemsel araçları adlandırılmış gruplara ayır. |
| Asistan `/analiz/asistan` | Verilerim hakkında ne sormak istiyorum? | Sohbet olarak koru; rapor ve kontrol ekranlarının yerine geçmesin. |
| Bulgular `/veri-sagligi` | Hangi tutarsızlığı incelemeliyim? | Kontrol merkezi; normal durumda kısa sonuç, teknik ayrıntı isteğe bağlı. |
| Bakım `/veri-sagligi/islemler` | Yedek, bildirim ve teşhis nerede? | Bu işleri ayrı görsel gruplara ayır; silme işlemini ayrı alt bölüme al. |

## Bulgular

Öncelikler uygulama önerisidir; üretim arızası şiddet sınıflandırması değildir.
**A:** ilk paket, **B:** ikinci paket, **C:** kullanıcı kararı/yerel prototip sonrası.
“Kaynak” bulguları canlı etkileşimle doğrulanmış sayılmaz.

### S01 — Özet, ayrıntılı hesap ve kart ekranına dönüşüyor — A

**Kanıt: canlı + kaynak.** `src/components/dashboard/SeritOverview.tsx`,
`src/pages/DashboardPage.tsx`: ana tutarın yanında net değer, kart borç kovaları,
limit kullanımı, bütün likit hesaplar, kontrol durumu, kredi notu ve ayrıntı katmanı var.
Canlı masaüstünde hesap listesi belirgin bir alan kaplıyor; vadeler aşağı uzuyor.

**Öneri:** ana tutar/açıklama, öncelikler ve ilk üç yaklaşan vade açık kalsın.
Nakit, ödenecek ekstre ve net değer üç kısa özet bağlantısı olsun. Tam hesap
listesi Hesaplar'da; kart kırılımı kredi kartlarında. Tampon düzenleme ve tutarın
beklenen alacağı içerdiği açıklama erişilebilir kalmalı. Üç vade sınırı ürüne ait
bir öneridir; kullanıcı isterse listeyi aynı ekranda genişletebilmeli.

### S02 — Vadeler ve taksitler birden çok yerde ayrıntılı anlatılıyor — A

**Kanıt: kaynak.** Dashboard vadeleri ve `CardPaymentCyclePanel`; Ödemeler'de
`ObligationsCalendar`; Analiz'de `UpcomingInstallments`; kartlarda taksit takvimi,
üç aylık tahmin ve alışveriş dökümü bulunuyor.

**Öneri:** tüm vadelerin ana adresi Ödemeler; kart alışverişi/taksit ayrıntısı
kartta kalsın. Özet üç önceliği, Analiz aylık toplamı/değişimi göstersin.
Kesim ayı, nakit çıkış ayı ve karta yazılan taksit farklı kavramlar; bunları
tek rakama veya tek tabloya birleştirmek doğru olmaz. Ortak ödeme kaydı kısayolu korunmalı.

### S03 — Hızlı “Transfer kaydet” bağlantısının hedefi etkin ekranda yok — A

**Kanıt: kaynak + canlı kısayol denemesi.** `src/components/QuickActions.tsx`
`/kartlar#hesap-merkezi` adresini kullanıyor. Bu id yalnız
`src/pages/CardsPage.overview.tsx` içindeki `AccountHubPanel`'de bulunuyor;
`src`/`tests` referans taramasında bu bileşenin etkin çağrısı yok.
`CardsPage.tsx` bu paneli kullanmıyor. Mevcut para hareketi girişi hesap satırından
`renderCardRowActions` → `openTransaction` ile açılıyor. Canlıda İşlem → Transfer
kaydet seçimi `/kartlar#hesap-merkezi` adresindeki hesap listesini gösterdi;
transfer formu veya kaynak hesap seçimi açılmadı. Hiçbir transfer kaydı yapılmadı.

**Öneri:** kısayol kaynak hesap seçimini ve ardından mevcut transfer formunu
açsın. Yeni finans yazma yolu eklenmesin. Bu, genel görsel düzenlemeden önce
yerel temsili veride doğrulanacak somut akış düzeltmesidir. Eski panelin sırf
anchor için geri getirilmesi yeniden büyük bir tekrar oluşturur.

### S04 — Ödemeler hem vade görünümü hem plan kayıt listesi — A

**Kanıt: kaynak.** `src/pages/PaymentsPage.tsx` aynı `CrudPage` içinde önce takvim,
ardından `PaymentsOverview` ve plan listesini sunuyor. Takvim bütün yükümlülükleri
gösterirken alt liste yalnız planlı ödeme kayıtlarını yönetiyor.

**Öneri:** sayfada “Yaklaşanlar / Takvim” ile “Kayıtlı planlar” ayrımı açık olsun.
Plan ekle mevcut forma gider; takvimde görülen kredi/tahsilatın ayrıca buraya
eklenmesi gerektiği izlenimi doğmasın. Yeni tablo veya ödeme modeli gerekmez.

### S05 — Abonelik yönetimi, Analiz içinde ikinci bir listeye dönüşüyor — B

**Kanıt: kaynak.** `src/pages/AnalysisPage.panels.tsx` / `SubscriptionsPanel`,
Ödemeler'deki aylık planların tamamını ve aylık eşleşme durumunu yeniden çiziyor;
aynı blokta abonelik keşfi var. Keşif ekstre aktarımı sonunda da sunuluyor.

**Öneri:** kayıt yönetimi Ödemeler'de; Analiz'de aylık toplam, değişim ve yeni
aday sayısı yeterli. Aday inceleme bileşeni ortak kalabilir; aktarım sonundaki
bağlamsal öneri yararlı. Aday onaylanmadan plan hesabına dahil edilmemeli.

### S06 — Analiz'de net değer iki ayrı trend yüzeyiyle sunuluyor — B

**Kanıt: kaynak.** `AnalysisPage.hero.tsx` 12 aylık mini trend çiziyor;
`AnalysisPage.trends.tsx` / `NetWorthTrend` aynı sayfada aralık/birim seçilebilen
ayrı grafik sunuyor. Özet'te de net değer var.

**Öneri:** Analiz üstünde tek net değer ve aylık değişim; altında tek ayrıntılı
trend. Üst mini grafik kaldırılabilir. Güncel türetilmiş değer ile tarihsel
fotoğrafın kapsam/tazelik farkı korunmalı; iki seriyi körlemesine birleştirme.

### S07 — Ay kapanış kontrolü, analiz raporunun önüne geçiyor — B

**Kanıt: kaynak.** `AnalysisPage.tsx`, `MonthCloseAssistant`'ı aylık rapordan önce
kuruyor. Ekstre, taksit ve veri erişimi kontrollerinin ilgili yönetim ekranları da var.

**Öneri:** aylık rapor önce gelsin. Ay kapanışı adlandırılmış, başlangıçta kapalı
bölüm olabilir; yapılacak iş varsa kısa uyarı ve ilgili ekrana bağlantı gösterilsin.
İş kontrolünü tamamen silmek veya bütün kontrolleri veri hatası saymak doğru değil.

### S08 — “Ayrıntılar” sekmesinin kapsamı belirsiz ve karışık — B

**Kanıt: kaynak.** `AnalysisDetailPage.tsx` kredi notu, enflasyon, kişi defteri,
aktivite, genel arama, yıl sonu özeti ve zekâtı aynı sayfaya topluyor.

**Öneri:** aynı rota içinde “İşlem geçmişi”, “Dönem raporları” ve “Diğer araçlar”
gibi görünür gruplar. Kişi yönetimi Kişiler'de, burada kısa rapor bağlantısı.
Sekme adını değiştirmek ayrıca kararlaştırılmalı; 18 Ekim'deki onaylı adlar
kaynak kabul edilmeli. Her araç için yeni ana menü açılmamalı.

### S09 — Hedef ve kasa, tek planın iki ayrı yönetimi gibi görünüyor — B

**Kanıt: kaynak.** `PlanningPage.tsx` hedefler, `KasaModuPanel`, ardından bütçeleri
çiziyor. Hedef panelinde “Ayır”, “Kasada ayrılan”, “Bu kovayı kaynak yap” var;
kasa panelinde aynı bağlı rezervin tutarı düzenlenebiliyor.

**Öneri:** bütçe ilerlemesini başlıktan hemen sonra konumlandır; hedefe bağlı
rezervi hedefin altında tek görsel bütünlükte göster. Bağımsız rezervler ayrı
kompakt bölüm olabilir. “Ayır”ın harcanabiliri azalttığı, hedef ilerlemesinin ise
takip kaynağına bağlı olduğu açıklanmalı. Hedef tutarı ve rezerv aynı finansal
nesne değildir; tabloları veya hesapları bu amaçla birleştirme.

### S10 — Alınacaklar ve Alsam mı? arasında karar yükü tekrarlanıyor — B

**Kanıt: kaynak.** `WishlistPage.tsx` ürün girişinde üç soruluk test, taslak
değerlendirmesi ve her bekleyen satırda finansal değerlendirme sunuyor;
fiyatı ayrıca Alsam mı?'ya taşıyan bağlantı var.

**Öneri:** listede ürün/fiyat/bekleme süresi ve tek kısa durum; ayrıntılı
ay/ödeme şekli karşılaştırması Alsam mı?'da. Girişteki üç soru otomatik
kaldırılmamalı: istek/ihtiyaç davranışı kullanıcıyla ayrıca konuşulmalı.
Liste değerlendirmesinin peşin, senaryo ekranının kart/taksit destekli olduğu
açık kalmalı. Bunlar birebir aynı hesapmış gibi ele alınmamalı.

### S11 — Alsam mı? formunda bağımlı seçim sırası ters — B

**Kanıt: kaynak.** `PurchaseDecisionPage.tsx` taksit seçimini ödeme şeklinden
önce sunuyor; nakit seçilince diğer taksitler pasifleşiyor.

**Öneri:** tutar → ödeme şekli → yalnız kart için taksit → sonuç. Kart vade
kıyasları ikincil ayrıntı olabilir. Bu kıyasın ana hesaplamayı değiştirmediğini
söyleyen mevcut açıklama korunmalı.

### S12 — Portföy ve hisse defteri arasındaki görev farkı zor anlaşılabilir — B

**Kanıt: kaynak.** `AssetsPage.tsx` hisse varlığının gerçek Al/Sat girişini sunuyor;
`BorsaPage.tsx` ise “Geçmiş işlem ekle” ile yalnız tarihçeye kayıt ekliyor.
Altın varlıkları da genel portföyde görünür, yönetimi Altın'dadır.

**Öneri:** Varlıklar genel portföy; altın/hisse satırı ilgili ayrıntıya açık
bağlantı taşısın. Hisseler'de gerçek Al/Sat için mevcut varlık işlemine bağlantı,
geçmiş kayıt için ikincil eylem. Gerçek işlem ile geçmiş defteri tek Kaydet
eyleminde birleştirme; nakit ve pozisyon etkileri farklıdır.

### S13 — Araçlar ve Gider gruplarında formlar, özetlerden önce — A

**Kanıt: kaynak.** `CarsPage.tsx`: yönetim → manuel gider → hatırlatıcı → kart
atama → araç özetleri. `ExpenseContextsPage.tsx`: yönetim → manuel gider → kart
etiketleme → grup özetleri.

**Öneri:** özet/sıradaki hatırlatıcı önce; “Gider ekle”, “Kart hareketi ilişkilendir”,
“Yönet” açık düğmelerle form açsın. Mevcut form bileşenlerini yeniden kullan;
gereksiz modal/sekme katmanı üretme. Kart harcaması ilişkilendirme ile bağımsız
manuel gider farklı kayıtlar; sadeleştirme yeni finans hareketi oluşturmamalı.

### S14 — Bakım, ayarlar ve teknik teşhis aynı uzun sayfada — B

**Kanıt: kaynak.** `DataHealthOperationsPage.tsx`: yedek/geri yükleme/kısmi CSV/silme,
ardından bildirim, otomasyon kapsamı, SMS ve istemci hata panelleri.

**Öneri:** “Yedek ve geri yükleme”, “Bildirimler”, “Otomasyon ve teşhis” grupları.
Son grup isteğe bağlı açılabilir. Tüm veriyi sil, normal yedek düğmelerinden
ayrı alt bölümde kalsın; mevcut doğrulama/yedek kuralları korunmalı. Yeni bir
ayar ana menüsü ilk aşamada gerekli değil.

### S15 — Menüde konunun nerede aranacağı bazı alanlarda belirsiz — C

**Kanıt: kaynak.** `navigation.ts`: kart borcu Hesaplar'da; Borçlar'da krediler ve
kişiler var. Maaş Varlıklar altında; Plan'ın üç aracı kapalı “Diğer planlama
araçları” bölümünde. Mobilde Analiz ve Kontrol üst menü taşmasında.

**Öneri:** önce kısa bağlamsal bağlantılar: Borçlar'dan “Kredi kartı borçları”na,
Plan'dan maaş kaydına. Ana menü adlarını ve maaşın yerini hemen değiştirme.
İkincil araçlarda kapalı menü üzerine tekrar aynı aktif aracı gösterme ihtiyacı
yerel prototipte değerlendirilmeli. Mobil kullanım sıklığı ölçülmedi; bu nedenle
Analiz'i otomatik olarak alt bara taşımaya yetecek kanıt yok.

### S16 — Kullanıcı dili ile “kasa/kova” dili çelişiyor — B

**Kanıt: kaynak.** `KasaModuPanel.tsx` “Kasa modu”, “Kova ekle”, “Rezerve tutar”
gibi ifadeler kullanıyor; hedef ekranında da kova kaynak seçimi var.
`docs/UI_GLOSSARY.md` ise kısa ve günlük Türkçe dilini esas alıyor.

**Öneri:** bağımsız planlama rezervi için “Ayrılan para / Para ayır” gibi aday
metinler değerlendirilsin. Kart borcu bölümlerini anlatan sözlük karşılığıyla
karıştırılmasın; “kova” burada başka bir domain nesnesi. DB adı, rezerv hesabı
ve kaynak bağı bu dil düzenlemesinde değişmemeli.

## İkinci tur: canlı ekranlardan eklenen bulgular

### S17 — Dönem hareketleri başlığı, son hareket listesinin kapsamını tam söylemiyor — A

**Kanıt: canlı + kaynak.** Kart ayrıntısındaki Dönem hareketleri açıldığında
üstte dönem içi borç kırılımı, altta “Son kart hareketleri” listesi var.
Ekran, bu son listenin geçmiş ekstre alışverişlerini de içerebileceğini ayrıca
açıklıyor. `CardsPage.tsx`, `RecentCardExpensesPanel.tsx` bu iki kapsamı birlikte kuruyor.

**Öneri:** seçili kart için tek satırlık dönem özeti ve açıkça adlandırılmış
“Son hareketler” bölümü; gerçekten dönem filtresi isteniyorsa ayrı görünür
seçim. Geçmiş kayıtların bugünkü dönem toplamını verdiği izlenimi oluşmamalı.
Listeyi toplayıp borç hesaplamak veya eski harcamaları değiştirmek kapsam dışı.

### S18 — Tek altın türünde özet aynı miktarı ve değeri tekrar ediyor — B

**Kanıt: canlı + kaynak.** Mevcut Altın görünümünde üstte toplam miktar/eder,
ardından Gram altın bölümünde aynı miktar ve eder yeniden gösteriliyor.
`GoldPage.tsx` / `GoldOverview` toplam ve tür kırılımını ayrı ayrı çiziyor.

**Öneri:** tek tür varsa miktar, tahmini değer, bilinen maliyet ve ayar aynı
kompakt özette sunulsun. Birden fazla türde tür kırılımı gerekli; korunmalı.
İşlem defteri ve birikim grafiğinin kapalı başlangıcı iyi çalışıyor.

### S19 — Teknik kaynak notları günlük okumayı ağırlaştırıyor — B

**Kanıt: canlı + kaynak.** Bazı altın işlem notlarında teknik aktarım etiketleri
normal not gibi görünüyor (`GoldPage.tsx` ham `lot.note` gösterimi). Ayrıntılı
analiz aktivitesinde de tutar değiştirmeyen borç kırılımı olayları, parasal
hareketlerle aynı listede sıfır tutarla sıralanıyor (`AnalysisPage.activity.tsx`).

**Öneri:** teknik kaynak bilgisi ve tutar değiştirmeyen sistem olayları açıkça
adlandırılmış ayrıntı/filtre üzerinden görülsün; günlük varsayılan listede
kullanıcı işlemleri daha kolay ayırt edilsin. Ham notları veya ledger olaylarını
silme, yeniden yazma ya da aynı tutarlı gerçek işlemleri birleştirme. Bilinmeyen
notu otomatik teknik kabul etme; ayrım yalnız kanıtlı kaynak desenine dayanmalı.

### S20 — Hisseler'de aynı pozisyon hem özet satırı hem büyük defter kartı — B

**Kanıt: canlı + kaynak.** Üstte maliyet/gerçekleşmiş/gerçekleşmemiş bilgilerinin
ardından Baştan beri döneminde benzer rakamlar tekrar geliyor. Sembol bazlı
pozisyon satırlarının altında aynı semboller açılış işlem kartlarıyla yeniden
listeleniyor. Ayrıca ekranın üst bilgi bandı “Canlı altın & döviz kuru” diyor;
BIST verisinin kaynağını doğrudan anlatmıyor. Kaynak: `BorsaPage.tsx`, `RatesBanner.tsx`.

**Öneri:** “Pozisyonlar / İşlem geçmişi” ayrımıyla portföyü önce göster;
geçmiş işlemler ayrı görünüm olsun. Seçilen dönem gerçekten farklıysa dönem
karşılaştırması gösterilsin; varsayılan Baştan beri görünümünde aynı özeti
tekrarlama. Fiyat bandı ekrana uygun BIST kaynak/zaman bilgisini anlatsın.
İşlem defteri ile kanonik varlık pozisyonunu birleştirme; geçmiş kayıt ve
gerçek Al/Sat etkileri S12'deki gibi ayrı kalmalı.

### S21 — Kişi özeti Analiz'de, aynı kişinin parçalı kartları Kişiler'de — B

**Kanıt: canlı + kaynak.** Kişiler'in borç/alacak bölümünde aynı görünen ada ait
ayrı kayıtlar ayrı büyük kartlar olarak duruyor. Analiz → Ayrıntılar'daki
`PeopleLedger` ise kişi adına göre açık kayıtları özetliyor. Sadece takip
bölümünde de kişi toplamı ve ayrı kayıt listesi birlikte sunuluyor.

**Öneri:** kişi bazında görsel özet ve açılınca ayrı borç/alacak kayıtları
Kişiler'de toplansın; Analiz kısa bağlantı verebilir. Aynı görünen ad aynı
kişinin kesin kimliği değildir; DB kayıtlarını otomatik birleştirmek veya
kişiler arası netleştirme yapmak yok. Kayıt bazlı tarih, açıklama ve tahsilat
eylemleri korunmalı; Sadece takip finans hesabından ayrı kalmalı.

### S22 — Bulgular ekranında bütün karşılaştırma formları açık geliyor — A

**Kanıt: canlı + kaynak.** Üstte görünür veri hatası sayısı yokken rutin banka
doğrulamasında hesap/kart başına giriş alanı ve kaydet düğmesi açık. Özet
tutarlılık alanları ve aktif bulgu sonucu uzun form dizisinin altında kalıyor.
Kaynak: `DataHealthPage.tsx`, `LiveReconciliationPanel.tsx`.

**Öneri:** önce görünür bulgular/kapalı uyarı sayısı ve kontrol özeti. Rutin
karşılaştırmada hesap adı, durum ve son kontrol tarihi kısa satır olsun;
seçilen satırın formu açılsın. Fark bulunan satırlar öncelikli kalsın; görünür
form sayısını azaltmak gerçek farkı veya kapatılmış uyarıyı gizlememeli.
“İç veri tutarlı” ile “bankadaki tutarla uyumlu” ayrı sonuçlar olarak korunmalı.

### S23 — Analiz'de uzun sağ sütun solda büyük boş yüzey bırakıyor — A

**Kanıt: canlı ekran görüntüsü + kaynak.** Kategori harcaması ve abonelikler
yan yana. Abonelik listesinin altında zaten kayıtlı adaylar da uzadığı için,
kategori panelinin içeriği bittikten sonra solda geniş boş alan kalıyor.
Kaynak: `AnalysisPage.tsx` 7/5 kolon düzeni ve `SubscriptionsPanel`.

**Öneri:** S05'teki kısa abonelik özetiyle birlikte panel boylarını içerik kadar
tut; aday incelemesini ayrı tam genişlikli/isteğe bağlı bölüm yap. Önce yeni
ve belirsiz adaylar, zaten kayıtlı olanlar kapalı ayrıntıda olabilir. Hesap,
eşleşme kanıtı ve aday üretim algoritması değişmeden yerleşim düzenlenebilir.

### S24 — Basit tarihçeler için büyük kart ve arama düzeni fazla alan kaplıyor — B

**Kanıt: canlı + kaynak.** Maaş ve kredi notunda az sayıda kayıt için üst
kahraman rakam, geniş trend çubukları, arama/ekle satırı ve ayrı büyük kayıt
kartları birlikte var. Kredi notu paneli Ayrıntılı analiz'in ilk ekranını
neredeyse tamamen dolduruyor. Ödemeler'de de kart başlığı ve rozet “Aylık”
bilgisini; “Tahmini” ve “Yaklaşık” aynı kesinlik bilgisini tekrar ediyor.
Kaynak: `SalaryPage.tsx`, `CreditScorePanel.tsx`, `PaymentsPage.tsx`.

**Öneri:** tarih + değer + değişim içeren kompakt çizgi listesi; trend gerektiğinde
açılır. Plan listesi de ad, sıradaki vade, tutar, otomatik/elle durumuyla kısa
satıra dönüşebilir. Ay/gerçek eşleşme tutarı ve tahmini/gerçek ayrımı korunmalı;
sadeleştirme bunları tek rakam altında kaybettirmemeli. Tüm `CrudPage` tüketicilerine
zorunlu yeni şablon dayatmadan mevcut satır render desenleri kullanılmalı.

## Canlı kapsama kaydı ve ilk önerilerin düzeltmeleri

| Canlı açılan ekran | Görülen durum / kapsam | Plana etkisi |
| --- | --- | --- |
| Özet | Mevcut günlük ekran; tam hesap listesi ve kart kırılımı | S01/S02 korunur. |
| Hesaplar | Hesap/nakit ve kredi kartı listeleri; bir hesap ve bir kart ayrıntısı; borç kırılımı/dönem dökümü | Liste zaten derli toplu; tüm sayfa yeniden tasarlanmaz. S03 canlı doğrulandı, S17 eklendi. |
| Varlıklar | Sınıf özeti, altın/hisse/BES/araç kayıtları | S12 güçlendi; ayrıntı sayfalarına açık bağlantı gerekli. |
| Maaş | Mevcut az kayıtlı tarihçe | S24; yerini değiştirmek ilk paket için zorunlu değil. |
| Altın | Tek tür; miktar/değer tekrarı ve defter notları | S18/S19; defterin çizgi listesi iyi örnek. |
| Hisseler | Baştan beri performans, pozisyonlar ve açılış kayıtları | S12/S20; diğer dönemlerin sonuçları tek tek test edilmedi. |
| Araçlar | Yönetim/form/hatırlatıcı ve 40 satırlık kart atama alanı; özet altta | S13 ilk paket içinde daha yüksek önem aldı; ilişkilendirme arama/filtre ile isteğe bağlı olmalı. |
| Krediler | Aktif kredi yok, tamamlananlar kapalı | Mevcut temiz başlangıç korunur; aktif plan senaryosu canlıda denenmedi. |
| Kişiler | Borç/alacak ve Sadece takip ayrı açıldı | S21; finansal ve bilgi amaçlı kayıt ayrımı korunur. |
| Ödemeler | Kayıtlı tercihle Takvim; altında plan kartları | S04/S24; Takvim tercihi değiştirilmedi. |
| Bütçe ve hedefler | Hedefler var; mevcut ay bütçesi ve kasa kovası yok | S09/S16 kaynak önerisi sürer; dolu kasa/hedefte çift yönetim canlıda doğrulanmış sayılmaz. |
| Alsam mı? | Boş başlangıç ve kaydedilmeyen örnek senaryo | S11; masaüstünde sonuçtan önce form/kart kıyasları fazla alan kaplıyor. Örnek temizlendi. |
| Alınacaklar | Bekleyen ürün yok, tamamlananlar görünür | S10 kaynak bulgusu sürer; dolu bekleyen liste ve üç soruluk giriş canlıda denenmedi. |
| Gider grupları | Aktif ve tamamlanan sayıları; aktif özetin önünde uzun etiketleme listesi | S13 doğrulandı; tamamla/sil/atama yapılmadı. |
| Analiz | Aylık rapor, çift trend, plan/aday listeleri ve tahmin | S05–S07 canlıda görüldü; S23 eklendi. |
| Ayrıntılar | Kredi notu, dağılım, kişi özeti, aktivite ve genel arama; dönemsel araç düğmeleri | S08/S19/S21/S24; yıl sonu/zekât araçları çalıştırılmadı. |
| Asistan | Mevcut sohbet ve giriş; son mesaja otomatik konumlanma | Akışın ana yapısını koru; mesaj gönderme/temizleme denenmedi. |
| Bulgular | Görünür veri hatası yok; kapatılmış uyarı bilgisi ve rutin doğrulama açık | S22; hata yok sonucu kapatılmış uyarı yok anlamına çevrilmez. |
| Bakım | Yedek/silme, bildirim anahtarları, otomasyon, SMS ve hata alanları | S14 doğrulandı; ayar/test/yedek/silme işlemi yapılmadı. |

Plan araçlarında S15 ayrıca canlı doğrulandı: bir araca gidildiğinde kapalı
“Diğer planlama araçları” yeniden kuruluyor; kardeş araca geçmek için tekrar
açmak gerekiyor (`PlanningHub.tsx` içindeki pathname anahtarı). Masaüstünde
kısa kalıcı araç satırı, mobilde erişilebilir bir araç seçicisi prototipte
karşılaştırılmalı. İki farklı yerde aynı aktif araç bağlantısı üretmek gerekmez.

## Tekrar haritası: ne nerede kalmalı?

| İş / bilgi | Ayrıntılı yönetim | Diğer yerlerde kalacak şey |
| --- | --- | --- |
| Hesap bakiyesi ve hareket | Hesaplar → seçilen hesap | Özet'te toplam ve bağlantı; Varlıklar'da portföy bileşeni |
| Kart borcu/ekstre/provizyon | Hesaplar → Kredi kartları | Özet'te öncelik; Ödemeler'de gerçek vade; Analiz'de dönem toplamı |
| Bütün vadeler | Ödemeler | Özet'te ilk üç; kaynak nesnede ilgili ödeme kısayolu |
| Abonelik planı | Ödemeler → kayıtlı planlar | Analiz'de toplam/değişim/keşif; aktarım sonunda bağlamsal aday |
| Net değer trendi | Analiz'de tek ayrıntılı grafik | Özet'te güncel toplam ve bağlantı |
| Kişi borç/alacak kaydı | Kişiler | Ödemeler'de vade; Özet'te yaklaşan tahsilat; Analiz'de rapor bağlantısı |
| Finansal senaryo | Alsam mı? | Alınacaklar'da kısa durum ve tutarı taşıyan bağlantı |
| İşlem geçmişi ve arama | Analiz → Ayrıntılar içindeki geçmiş grubu | Hesap/kartta yalnız ilgili hareketler; Özet'te kısa son hareket veya bağlantı |
| Tutarsızlık inceleme | Kontrol → Bulgular | Özet'te kısa durum; kartta kartın ilgili kanıtı/bağlantısı |
| Yedek ve teşhis | Kontrol → Bakım | Diğer sayfalarda ilgili hata/ayar bağlantısı |

Korunacak yararlı tekrarlar: Özet'teki ödeme/tahsilat kısayolu, nesneye özgü
hareket geçmişi, ortak toplamın bağlama uygun gösterimi, aktarımdan sonra abonelik
adayı. İç tutarlılık, banka karşılaştırması ve ekstre karşılaştırması da aynı
denetim değildir; tek “temiz” rozeti altında birleştirilmemeli.

## Uygulama sırası

Güncel iş listesi ve kabul ölçütlerinin tek adresi
`docs/SIMPLIFICATION_PLAN_2026-10-26.md`'dir. Canlı tarama sonrasında dört paket:

1. Günlük kullanım ve girişlerin bulunması.
2. Analiz ve kişi bilgisini toplama.
3. Portföy ve basit tarihçeler.
4. Planlama dili, hedefler ve bakım.

Paketler küçük adımlara bölünür; yeni ana menü/rota taşıması, finans modelini
birleştirme veya özellik kaldırma peşinen kararlaştırılmış sayılmaz. Mevcut
finans yardımcıları, kayıt geçmişi ve kritik kapsam açıklamaları korunur.

## Bu incelemede yapılan değişiklik

Bu rapor, uygulama planı ve keşif/backlog bağlantıları güncellendi. Uygulama kodu,
finans kuralları, veri modeli ve deploy ayarları değiştirilmedi; elle finans
kaydı/ayar yazması yapılmadı. Mevcut otomasyonlara kullanıcı izin verdi.
Commit/push yapılmadı. Plan kapsamı kabulü, ürün davranışının uygulanmış olduğu
anlamına gelmez; kaynak sözleşmeler henüz değiştirilmedi.

Doğrulama: `git diff --check` ve `npm run test:guards` (7 kontrol) başarılı.
`npm run verify` denendi; bu çalışma kopyasında kurulu bağımlılıklar olmadığı
için ilk lint adımında `eslint` bulunamadı. Dolayısıyla tam kalite kapısı
geçildiği iddia edilmez. Bu doküman incelemesi için bağımlılık kurulmadı veya
uygulama/DB başlatılmadı.
