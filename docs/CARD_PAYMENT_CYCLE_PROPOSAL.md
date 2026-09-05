# Ekstreyi tam ödeme döngüsü — ürün önerisi

2026-09-05. Kullanıcı senaryosu doğrulandı: her ay kesilen ekstrenin TAMAMI
ödeniyor; dönem içi ve gelecek taksitler topluca erken kapatılmıyor. Günlük
alışverişlerin çoğu kartla yapılıyor; nakit ekstre için tutuluyor.
Durum: 2026-09-06 uygulandı; aşağıdaki uygulama sözleşmesi geçerlidir.

## Mevcut davranış neden yetersiz hissediliyor?

`utils/cashFlowForecast.ts` yalnız kayıtlı yükümlülükleri taşır. Yeni ve henüz
girilmeyen kart alışverişleri geleceğe eklenmez. Bu bilinçli model, kart
harcamalarının aynı tempoda devam ettiği kişisel senaryo ile aynı şey değildir.
`utils/statementProjection.ts` gelecek kesim dönemlerinin bilinen yüklerini
hesaplar; serbest harcama tabanı ayrı bilgidir, toplama katılmaz.
`pages/CardsPage.overview.tsx` ise banka bakiyesinden ekstre VE dönem içi
borcu düşer. Bu rakam “bu ay ödeyeceğim ekstre için para hazır mı?” cevabı değildir.

## Önerilen ilk ekran: Kart döngüsü

Ana sayfada nakit akışının yanında, aynı kaynaklardan türeyen üç bilgi:

1. **Ekstre için hazır mı?** Açık ekstrelerin kalan tutarı, ödeme vadeleri ve
   bu vadelerden önce kullanılabilecek para. Bugün eldeki nakit ile henüz
   yatmamış maaş/tahsilat ayrı gösterilir. Tampon, kasa rezervi ve aynı tarihe
   kadar kart dışı zorunlu çıkışlar ayrılır. Birden çok kart aynı parayı
   bağımsız biçimde “hazır” sayamaz; tek tarih sıralı kaynak havuzu gerekir.
2. **Sonraki ekstreye biriken** Kart bazında kesinleşmiş dönem içi tutar ve
   ilgili döneme düşecek planlı taksitler; provizyon ayrı “bekleyen” kalemi.
   Gelecek tüm taksitler tek ekstreye yığılmaz. Açık eski ekstre buraya eklenmez.
   Kayıtlı abonelik ile gerçekleşmiş işlem iki kez sayılmaz.
3. **Kart borcu sonrası durum** Elde bulunan nakit ile tüm kart borcunun
   karşılaştırması; gelecek taksitler ve provizyon kapsamı açıkça yazılır.
   Ayrılmış hedef/tampon ve diğer borçlar ayrıca görünür. Bu sayı yeni harcama
   izni veya bugün ödenecek ekstre tutarı olarak etiketlenmez.

Basit örnek (başka yükümlülük, rezerv, faiz yok): 100.000 TL nakit ve
70.000 TL toplam kart borcu → fark 30.000 TL. Bunun 40.000 TL'si ekstre ise
ödemeden sonra nakit 60.000, borç 30.000, fark yine 30.000 TL'dir. Yeni
5.000 TL kart harcamasında nakit değişmez, borç 35.000 olur, fark 25.000'e
iner. Böylece ödeme ile açılan limit yeni gelir gibi görünmez.

## İkinci adım: alışkanlık devam ederse

Mevcut “bilinen yükler” tahmini korunur. İsteğe bağlı ikinci senaryo:
“Kart harcamam bu tempoda sürerse”. Son birkaç TAM dönemin uygun harcama
tabanı veya kullanıcının girdiği aylık bütçe kullanılır; kısa/eksik import
geçmişinde güvenilir ortalama varmış gibi davranılmaz. Tek seferlik alımlar,
taksit anaparası, abonelikler ve kart talimatları ayrı ayrıştırılır; mevcut
yükümlülüklerle tekrar eklenmez. Kullanıcı tahmin varsayımını görebilir/değiştirebilir.

## Kaynaklar ve uygulama sınırları

- Ekstre kalanı: `utils/cardStatementPayments.ts`, mevcut açık ekstre kontratı.
- Kart kovaları / toplam: `utils/financeSummary.ts`, `docs/CARD_DEBT_TRANSITIONS.md`.
- Tarihler / bilinen yükler: `utils/cardStatement.ts`, `utils/statementProjection.ts`.
- Kart temposu: `utils/statementPace.ts`; yalnız karşılaştırılabilir dönemler.
- Nakit: mevcut snapshot, banka bakiyeleri ve nakit varlıkları; limit nakit sayılmaz.
- Kasa: mevcut rezerv kaynağı; kart borcunu ayrıca kasa kovasına koyup aynı
  tutarı hem yükümlülük hem rezerv olarak iki kez düşürme.
- Örnek ürün yaklaşımı: [YNAB kredi kartı yönetimi](https://support.ynab.com/en_us/handling-credit-cards-overview-ry7cNub1s)
  bütçelenmiş kart harcamasının nakit karşılığını ödeme kategorisine taşır.
  Denge için doğrudan muhasebe kopyası önerilmiyor; borca karşı nakit ayırma
  fikri, mevcut yükümlülük/rezerv modeline uyarlanmalı.

Kabul örnekleri: ekstre ödemesi net nakit-borç farkını değiştirmez; yeni
harcama farkı düşürür; sonraki maaş bugün hazır para sayılmaz; maaştan önceki
vade açık kalır; aynı nakit iki karta tahsis edilmez; gelecek taksit bugünkü
ekstreye taşınmaz. Yeni hesaplar saf util ve mevcut para yardımcılarıyla,
bu örnekleri doğrulayan testler eşliğinde ayrı bir uygulama kararıyla eklenir.

## Uygulanan sözleşme — 2026-09-06
cardPaymentCycle.ts ve CardPaymentCyclePanel.tsx ile Dashboard üzerinde salt okunur uygulandı; RPC/ledger değişmedi.
- Açık arşiv ödemeleri düşülür. Arşivsiz ekstre kovası kart ayarından tahmini vade taşır; tarih yoksa bugün ayrılır ve eksik olduğu yazılır.
- Bir havuz, tarih sırası: tampon + kasa + vadesiz kişisel borç başta ayrılır; önce diğer çıkışlar, sonra ekstreler, sonra aynı gün geliri. Bugünkü/geçmiş gelir yeniden eklenmez. Geçmiş aylık ödeme için yalnız açık kaydın kendi due_date'i kullanılır; eksik aylar uydurulmaz.
- Bugünkü nakitten tahsis ve gelirli vade planının açığı ayrı; bilinmeyen rezerv uyarısı görünür. Bu gerçek hesaplar arasında para taşımaz; tahsis yalnız karşılaştırmadır.
- Sonraki kesim mevcut statementProjection k=0'ı kullanır: yalnız dönem içi ve o kesim ayına planlı taksit; provizyon ayrı.
- Ek harcama kullanıcı girişidir; geçmiş ortalaması otomatik uygulanmaz. Senaryonun tabanı cashFlowForecast üzerine kayıtlı taksit ve kart talimatlarını ekstre vadelerinde ekler; ana nakit akışı değiştirilmez. Talimat bitiş tarihi obligations tarafından korunur. Yeni aylık harcama ilk kez sonraki ay nakit çıkışıdır; son ayın harcaması ufuk dışına kalır.
- Tüm kart borcu farkında tampon/rezerv/diğer borçlar düşülmez; senaryo sütunlarında bunlar ayrılır. Kasa kovasına ayrıca kart borcu ayıran kullanıcı aynı rezervi iki kez planlamamalıdır.
- Kesim/vade eksik kartlarda ileri yük hesaplanamaz; arayüz açıklar. Tahmini gelir gerçekleşme garantisi değildir; kayıtsız harcamalar, faiz ve gecikme ücretleri modellenmez.
