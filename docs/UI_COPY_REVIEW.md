# Denge — arayüz dili araştırması ve düzenleme planı

Tarih: 2026-09-05. Durum: ilk düzenleme paketi ve aşağıdaki adlandırmalar uygulandı.
Kullanıcı kısa/doğal dil planını uygulamak üzere onayladı. Finans hesapları ve
veri yazma davranışı korunuyor. Sonraki geniş kapsamlı mesaj taraması açık iştir.

Uygulama notları:
- “Kişiler” dar sekmede korundu; sayfa başlığı “Borç ve alacaklar”.
- Takvimde önerilen “Ödenebilir kayıt”, kaynak incelemesinde tahsilatları da
  saydığı görüldüğünden “Ödeme / tahsilat” olarak uygulandı; oran açıklandı.
- Hızlı işlemlerde transfer de “Transfer kaydet” oldu; uygulama banka transferi başlatmaz.
- Bütçe limiti olmayan ay ayrı metinle gösterilir; mevcut kontrol hesabı değişmez.
- Karar açıklaması ödeme şekline göre sonuç kutusunun yanındadır; modelin gelecekteki
  yeni kart harcamalarını içermediği ve kart borcunun alımla arttığı açıklanır.
- Uzun rapor/kontrol etiketleri ve açıklamalar kesilmek yerine satıra yayılır.

Doğrulama: `npm run verify` geçti (128 dosya, 1.414 test); mevcut E2E
paketinde 10 geçti, canlı backend gerektiren 3 test atlandı. Hesap özeti,
ay kapanışı ve aylık raporun gerçek React bileşenleri örnek verilerle statik
olarak render edilip 390×844 ve 1320×900 boyutlarında görsel olarak incelendi;
390 px görünümde yatay taşma yok. Bu kontrol oturum açılmış uçtan uca
yazma testi değildir. React incelemesinde yeni veri sorgusu, import katmanı
ihlali veya finansal hesap değişikliği yok; bütçe varlığı yalnız metin seçer.

## İnceleme kapsamı

Canlı arayüzde Özet, Hesaplar, Ödeme Takvimi, Alsam mı?, Alışveriş Listesi
ve Analiz incelendi; mobil kontrol 390×844 görünümünde yapıldı. Bu oturumda
ortak navigasyon, hızlı işlemler, hesap özeti, analiz raporu/ay kapanışı,
alışveriş kararı ve gider bağlamı metinleri kaynak koddan karşılaştırıldı.
Bu çalışma kullanıcı testi değildir; kaynak incelemesi ve uzman değerlendirmesidir.
Tüm formlar, bildirimler ve hata durumlarının tamamı henüz taranmadı.

## Araştırma dayanağı

- [GOV.UK — Headings](https://design-system.service.gov.uk/styles/headings/):
  tutarlı başlık hiyerarşisi ve cümle düzeninde büyük harf kullanımı.
- [GOV.UK — Button](https://design-system.service.gov.uk/components/button/):
  düğme metni yaptığı eylemi anlatmalı.
- [Nielsen Norman Group — 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/):
  sistem kullanıcı dilini konuşmalı; durum anlaşılmalı; hatalar sorunu ve
  çözüm yolunu sade biçimde açıklamalı.

Bu kaynaklar Türkçe finans terimlerinin doğruluğunu belirlemez. Aşağıdaki
Türkçe öneriler Denge'nin hesap kaynakları ve FINANCE_RULES.md ile eşleştirilen
editoryal kararlardır; İngilizce rehberlerin doğrudan çevirisi değildir.

## Uygulanan dil sözleşmesi

1. Kısa ve doğal Türkçe; yönlendirmelerde mevcut “sen” dili korunur.
2. Sayfa başlığı konuyu, alt başlık kullanıcının orada yapabileceği işi söyler.
3. Cümle düzeni: “Ödeme takvimi”, “Hesaplar ve kartlar”; özel adlar korunur.
   CSS ile büyük harf gösterilen bölüm etiketleri ayrıca değiştirilmez.
4. Bir kavramın adı ekranlar arasında değişmez. Hesap bakiyesi, kart borcu
   sonrası bakiye, net değer ve bu ay harcanabilir tutar birbirinin yerine geçmez.
5. “Tahmini”, “beklenen”, “gerçekleşen” ayrımı ilgili rakamın yanında yapılır.
6. Durum başlığı kontrolün sonucunu peşinen ilan etmez. “Ödemeler” başlığı
   altında “10 açık ödeme” veya “Açık ödeme yok” gösterilebilir.
7. Düğme bir fiil taşır: “Görsel indir”, “Ödeme planla”, “Gider ekle”.
8. Hata: hangi işlem olmadı + biliniyorsa nasıl toparlanır. “Olmadı” tek başına yetmez.
9. Simülasyon sonuçları koşulludur. “Rahatlıkla alabilirsin” yerine modelin
   gerçekten ölçtüğü durum anlatılır; gelecek ayları kapsayan sorun “bu ay” diye sunulmaz.
10. Metin değişikliği finans hesabını değiştirmez. RPC adları, DB enum'ları,
    kategori anahtarları ve geçmiş kayıtlar toplu metin değişimine dahil edilmez.

## İlk düzenleme paketi — anlamı netleştiren metinler

| Ekran / kaynak | Mevcut | Öneri | Gerekçe |
| --- | --- | --- | --- |
| Hesaplar, CardsPage.overview.tsx | Likit toplam | Kart borcu sonrası bakiye | Hesaplanan değer banka bakiyesi eksi ödenebilir kart borcu; likit toplam değil. |
| Aynı panel | Kart borcu düşülmüş net | Hesap bakiyesinden ekstre ve dönem içi borç düşüldü | Gelecek taksit ve provizyonun bu düşüme dahil olmadığını açıklığa kavuşturur. |
| Analiz, AnalysisPage.panels.tsx | Ekstreler kontrol edildi | Ekstre kesimi | Kullanıcının kontrol yaptığı izlenimi yerine kontrolün konusunu söyler. |
| Aynı panel | Taksitler işlendi | Taksit kayıtları | Bekleyen durumdayken başarı ilan etmez. |
| Aynı panel | Maaş kaydı güncel | Maaş kaydı | Kod kaydın varlığını kontrol ediyor; güncelliğini kanıtlamıyor. |
| Aynı panel | Faturalar kapandı | Planlı ödemeler | Açık ödemeler varken başlık çelişmez; kapsam yalnız fatura değil. |
| Aynı panel | Bütçe aşımı yok | Bütçe kontrolü | Limit aşımı bulunduğunda da doğru başlık. |
| Aynı panel | Limitler sakin | Tanımlı bütçelerde aşım yok | Mecaz yerine kontrolün kapsamını anlatır. Bütçe yok durumuna ayrıca metin gerekir. |
| Aynı panel | Veri altyapısı hazır | Veri erişimi | Kullanıcının önemseyeceği sonucu adlandırır. |
| Aynı panel | N migration bekliyor | N veri tablosuna erişilemiyor | Kod yalnız eksik/erişilemeyen tabloyu biliyorsa nedeni migration diye kesinleştirmez. |
| Analiz, AnalysisPage.reports.tsx | Kart | Görsel indir | Kredi kartı ile karışan düğmenin eylemini açıklar. |
| Aynı rapor | Gelir | Beklenen gelir | Bu rakam salt gerçekleşen tahsilat değil. |
| Aynı rapor | Nakit çıkışı | Ödenen tutar | Gerçekleşen ödeme kaynağını vurgular. |
| Aynı rapor | Net nakit | Gelirden kalan* | Tek başına kullanılmaz; aşağıdaki açıklama rakamın yanında yer alır. |
| Alsam mı?, PurchaseDecisionPage.tsx | Nasıl | Ödeme şekli | Alanın amacı açık. |
| Aynı ekran | Alım sonrası kalan | Bu ay harcanabilir | Gösterilen hesap yalnız bu ayı ifade eder. |
| Aynı ekran | Aylık taksit | Tek çekimde “Ödeme tutarı”, diğer durumda “Aylık taksit” | Peşin alışverişi taksit diye adlandırmaz. |
| Aynı ekran | Rahatlıkla alabilirsin | Plana göre uygun | Kesin satın alma tavsiyesi yerine model sonucu. |
| Aynı ekran | Alabilirsin ama dikkat | Planını zorlayabilir | Temkinli sonucu sadeleştirir. |
| Aynı ekran | Bu ay zorlar | Bakiye açığı oluşuyor | Açık sonraki aylarda da oluşabilir; dönem ayrıntısı gerekçe satırındadır. |
| Aynı ekran | Kartla alımda ilk taksit… (her ödeme şeklinde görünüyor) | Kart ve nakit için ayrı açıklama; sonuç kutusunun yanında | Nakit seçiliyken kart açıklaması gösterilmez. Kart açıklaması model varsayımı olduğunu söyler. |
| Takvim, ObligationsCalendar.tsx | Aksiyon | Ödenebilir kayıt | Payable/item oranının neyi saydığını söyler; ödeme sayısı ile tamamlanma oranı karışmaz. |
| Gider bağlamları, ExpenseContextsPage.tsx | Olmadı | Kayıt değiştirilemedi | İşlemi tarif eder; alttaki hata ayrıntısı korunur. |
| Aynı ekran | Atanamadı | Harcama ilişkilendirilemedi | Neyin başarısız olduğunu söyler. |

*“Gelirden kalan” için zorunlu yakın açıklama: “Beklenen aylık gelirden bugüne
kadar kaydedilen ödemeler çıkarıldı. Hesap bakiyesi veya ay sonu tahmini değildir.”
Bu karma hesap uzun açıklama gerektiriyorsa metriğin kendisi sonraki ürün
kararında ele alınmalı; yalnız “Tahmini net nakit” diye yeniden adlandırmak yetmez.

## Uygulanan adlandırmalar

| Mevcut | Öneri | Değerlendirme |
| --- | --- | --- |
| Kişiler | Borç ve alacaklar | Sayfa başlığında açıklayıcı; dar sekmede “Kişiler” kalabilir. |
| Bağlamlar / Gider bağlamları | Gider grupları | Günlük dilde daha anlaşılır; kategori ve ortak limit gruplarından ayrımı alt metinle kurulmalı. |
| Detay | Ayrıntılı analiz | Sayfa başlığı açıklayıcı; mobil sekmede “Ayrıntılar” düşünülebilir. |
| Bütçe & Hedefler | Bütçe ve hedefler | Türkçe bağlaç ve cümle düzeni. |
| Yedek & Ayarlar | Yedek ve ayarlar | Aynı kural. |
| Hızlı işlem: Planlı | Ödeme planla | Eylem açık. |
| Hızlı işlem: Kişi | Borç / alacak ekle | Kişi rehberi ekleme izlenimini kaldırır. |
| Hızlı işlem: Harcama | Harcama ekle | Uygulamanın banka harcaması gerçekleştirdiği izlenimini azaltır. |

## Uygulama sırası ve kabul ölçütleri

1. Ton ve yukarıdaki adlandırma kararları kullanıcı tarafından onaylandı.
2. İlk paket: hesap/rapor etiketleri, durum başlıkları, karar ekranı açıklamaları,
   belirgin hata ve eylem metinleri. Mevcut hesaplar ve veri yazma davranışı korunur.
3. İkinci paket: seçilen terimler navigasyon, form, boş durum, yardım metni ve
   erişilebilir adlarda birlikte uygulanır. Sadece menüyü yeniden adlandırmak yetmez.
4. Sonraki tarama: içe aktarma, silme/geri alma, ödeme kaydı, bildirim ve AI
   hata yüzeyleri. Her mesaj işlemin gerçek sonucuyla eşleştirilir.
5. Mobil 390 px ve masaüstünde uzun Türkçe etiketler kontrol edilir; kritik
   açıklamalar yalnız hover/title içine saklanmaz. Yeni etiket uğruna tutar kesilmez.
6. Boş, başarılı, bekleyen, hata ve tahmin durumları ayrı değerlendirilir.
7. `npm run verify`; değişen erişilebilir adlara bağlı mevcut testler güncellenir.
   Yalnız sabit metni tekrar eden yeni testler yazılmaz.
8. UI_ARCHITECTURE, AI_CONTEXT_INDEX ve BACKLOG uygulanan kararlarla aynı değişiklikte güncellenir.

## Metin değişikliğinden ayrı tutulan önceki bulgular

- Ana sayfa kart borcu kırılımına gelecek taksitleri dahil etme: veri sunumu işi.
- Masaüstü vade listesini gruplama ve odağı yukarı taşıma: hiyerarşi işi.
- Mobil takvim tutarlarının kesilmesi: yerleşim işi.

Bu üç madde metin araştırmasıyla çözülmüş sayılmaz.

## İkinci tarama — 2026-09-06
İçe aktarma (ekstre/fiş), ödeme modalı, genel onay/silme diyaloğu, bildirim ayarları ve AI istemci hata yüzeyleri incelendi. Fişte okunamayan toplam için elle giriş/net fotoğraf, çözümlenemeyen ekstre için metin içeren PDF önerisi eklendi. Bildirim genel hatası hangi ayarın değiştirilemediğini söyler. AI yeniden deneme ve ödeme/onay diyaloglarının mevcut eylem sözleşmesi korundu. Dashboard İngilizce hata başlığı Türkçeleştirildi; odak durumunun temiz iddiası kaldırıldı. Önceki üç yerleşim bulgusu takip paketinde uygulandı. Bu tarama tüm backend hata metinlerinin yeniden yazılması değildir.
