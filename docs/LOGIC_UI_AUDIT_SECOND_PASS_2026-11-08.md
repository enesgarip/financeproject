# Uygulama/UI mantık denetimi — ikinci tarama, 8 Kasım 2026

9 Kasım uygulama/kabul kaydı: `docs/AUDIT_REMEDIATION_2026-11-09.md`.
M01–M23, V01–V07, F01–F05 ve T01 uygulandı. Aşağıdaki tarama durumu
bulguların tespit anını korur; güncel kanıt ve yayın kapıları düzeltme
belgesindedir. U01 gerçek telefon belirtisi birebir doğrulanmadı, açık kalır.


Kullanıcı ilk rapordan sonra başka sorunlar bulunması ihtimaline karşı tekrar
tarama istedi. İlk tur: `docs/LOGIC_UI_AUDIT_2026-11-08.md`.
Başlangıç commit'i hâlâ `a96910f`; uygulama kodu ve migration'lar değişmedi.
Bu dosya düzeltme kaydı değil, ikinci araştırmanın bulgu ve kabul planıdır.

## Birleşik sonuç

**12 yeni ürün maddesi** (7 P1, 5 P2) eklendi: M12–M23.
İki tur toplamı **23 ürün maddesi + T01 test bakımı**: 12 P1 ve 11 P2 ürün
maddesi. M11'deki altın toleransı ayrıca açık bir ürün/iş kuralı kararı olarak
ele alınmalı; mevcut TRY toleransı gelişigüzel kaldırılmamalı.
P0 doğrulanmadı; bu sonuç bütün olası hataların bulunmuş olduğu anlamına gelmez.

| Kimlik | Öncelik | Yeni bulgu | Kanıt |
| --- | --- | --- | --- |
| M12 | P1 | Manuel hesap hareketi, transfer ve varlık al/sat kayıp yanıtta tekrar uygulanıyor | Tarayıcı + gerçek SQL |
| M13 | P1 | Native sayı alanındaki 1.234 gram, 1234 olarak kaydediliyor | Tarayıcı POST gövdesi |
| M14 | P2 | Altın defterinin dört haneli miktarı varlık özetinde iki haneye düşüyor | Gerçek SQL + veri yolu |
| M15 | P1 | Altın kaydında yalnız alım/satım yönünü değiştirmek özeti senkronlamıyor | Tarayıcı, yazma sayısı |
| M16 | P1 | Satışı olan altın alışını azaltmak negatif envanter oluşturabiliyor | Tarayıcı + gerçek SQL |
| M17 | P2 | Katkılı varlık değer güncellemesinin tekrarı hayalet zarar yazıyor | Tarayıcı + gerçek SQL |
| M18 | P2 | Satır içi varlık değer taslağı gezinme korumasına girmiyor | Tarayıcı, sıfır onay diyaloğu |
| M19 | P1 | Geçersiz metin sıfır kabul edilip varlık değeri/tampon sıfırlanabiliyor | İki ayrı tarayıcı senaryosu |
| M20 | P2 | Sohbet temizlendikten sonra devam eden yanıt geçmişi geri oluşturuyor | Tarayıcı, kontrollü bekleyen yanıt |
| M21 | P2 | Depolama erişimi engelliyken başlangıçta boş ekran oluşuyor | Tarayıcı, SecurityError |
| M22 | P1 | Kabul edilen 360 aylık kredi sessizce 240 taksite kesiliyor | Gerçek plan fonksiyonu, repo yazma sınırı |
| M23 | P1 | Restore bağlantı hatası geri alma garantisi gibi sunuluyor | Repository hata enjeksiyonu + çağrı akışı |

İlk tur maddelerinin genişleyen kapsamı:

- **M06:** Gizlilik açıkken döviz varlık miktarı da görünür. 1.234 USD
  miktarı maskelenmeden görüntülendi. TL rakamlarını kapatmak, yabancı para
  miktarlarını gizlemeye yetmiyor.
- **M08:** Maaş sayfasındaki değişiklik ortak snapshot'ı yenilemiyor. 50.000
  maaş 60.000'e değiştirilip SPA içinde Özet'e dönüldüğünde snapshot isteği
  yeniden yapılmadı; liste taze, ortak finans cache'i eski kaldı.
- **M10:** Kaynak incelemesine ek olarak yerel gerçek PostgREST API'de 1.001
  fixture satırıyla doğrulandı. `limit(1500)` istendi, exact count 1.001,
  dönen veri 1.000. 1.001 fixture'ın tamamı `finally` ile temizlendi.

## Kapsam ve kanıt yöntemi

Bu tur ilk listedeki hataları tekrar saymak yerine ödeme drawer'ı dışındaki
para hareketleri, varlık ticareti/değer geçmişi, altın CRUD → varlık köprüsü,
envanter değişiklikleri, uzun kredi planları, taslak kaybı, sohbet yarışları,
depolama hatası, maaş cache'i ve restore hata dili üzerine odaklandı.
Backup sıralaması, mevcut atomik RPC ve restore/reset sonrası istemci temizliği
de okundu; gerçek restore/reset çalıştırılıp yerel finans verisi silinmedi.

13 sentetik Chromium gözlemi ve 3 Vitest gözlemi geçti. Bu testler mevcut
kusurlu davranışı gözlemler; **düzeltme kabul testinin geçtiğini söylemez**.
Tarayıcı istekleri mock'landı/engellendi. İki SQL probu yerel container'da
BEGIN/ROLLBACK ile çalıştı. API satır sınırı probu loopback adresini zorunlu
kılıyor ve yalnız kendi tam marker'ına ait sıfır değerli kayıtları temizliyor.
Üretim servisine yazılmadı. Yeni görseller sentetik veri içerir.

Kanıt arşivi: `docs/audit-evidence/2026-11-08/second-pass/README.md`.
Geçici gözlem testleri kaldırıldıktan sonra **`npm run verify` yeniden geçti**:
1930 kalıcı test, lint/guard/coverage, production audit (0 açık), build,
1038,7/1060 kB bundle ve 6 edge tip kontrolü. İlk turun 59 SQL/55 standart E2E
kapısı aynı uygulama revizyonuna aittir; bu iki büyük paket tekrar edilmek
yerine yeni sınır senaryoları ayrı çalıştırıldı.

## M12 — Ödeme drawer'ı dışındaki para yazımlarında güvenli tekrar yok

Kaynaklar: `src/services/accountMovements.ts:14`,
`src/pages/CardsPage.hooks.ts:345`, `src/services/assetTrades.ts:20`,
`src/pages/AssetsPage.tsx:444`.

**Tarayıcı:** Hesaba 500 TL giriş sunucuda uygulanmış gibi kabul edilip yanıt
kesildi. Aynı formu tekrar göndermek aynı RPC gövdesini tekrar yolladı;
20.000 başlangıç 21.000 oldu, tek niyet 20.500 olmalıydı. Varlık Al formunda
da ilk yanıt kaybından sonra aynı ticaret gövdesi tekrar gönderildi.

**Gerçek SQL:** `record_manual_account_movement` iki kez 200 TL çağrılınca
10.000 → 10.200 → 10.400. Aynı 500 TL transfer iki kez kaynak ve hedefi
değiştirdi. Fon alışında aynı 1 adet / 100 TL çağrısı miktarı 10 → 11 → 12
yaptı. Bu RPC'ler transaction bakımından atomik, fakat niyet bakımından
idempotent değil. Atomiklik ile güvenli tekrar aynı garanti değildir.

**Çözüm:** Mevcut ödeme makbuzu desenini bu kullanıcı niyetlerine genişlet.
Sabit UUID + kullanıcı + canonical gövde ve belirsiz sonucu aynı kimlikle
doğrulama. Manuel giriş/çıkış, hesaplar arası transfer, alış ve satışın hepsi
kapsansın. Kaynak/hedef sırası ve ledger trigger'ları korunmalı.

**Kabul:** Kayıp yanıt + retry + yenileme tek bakiye/adet/history/ledger
değişimi üretmeli; gerçek ikinci işlem yeni UUID ile çalışmalı. Çift tık ve
iki sekme ayrı kontrol edilmeli. M02 rezervden farklı olarak burada gerçek
banka bakiyesi de yanlış değişebiliyor.

## M13 — Native miktar alanına yerelleştirilmiş para parser'ı uygulanıyor

Kaynak: `src/pages/GoldPage.tsx:59`, `:320`, `:376`,
`src/components/CrudPage.tsx:719`, `src/utils/formatCurrency.ts` / `parseNumber`.

**Tarayıcı kanıtı:** `input[type=number]` Miktar alanına `1.234` girildi.
Alım kaydının POST gövdesinde `quantity=1234` vardı. Bu input'ta nokta ondalık
ayıracıdır; Türkçe serbest metinde kullanılan binlik nokta kuralı bu alana
uygulanamaz. `step=0.0001` olan geçerli giriş bin kat büyütüldü. Özet
sentetik 5.000 TL kurla 6.170.000 TL gösterdi.

**Çözüm:** Native sayısal alanlarda sayı değerini native semantiğiyle oku;
serbest Türkçe para metni parser'ını ayrı tut. `parseNumber`'ın 1.234 TL'yi
Türkçe binlik kabul eden mevcut sözleşmesini bütün uygulamada bozma.
Altın miktarı yanında fon/döviz miktarı ve hisse geçmişi çağrıları da incelensin;
her birinin step ve DB hassasiyeti korunmalı.

**Kabul:** `1.234` → 1,234 gram; `1.2345` → 1,2345 gram. Türkçe para girişinde
`1.234,56` → 1234,56 TL hâlâ çalışmalı. Birim fiyat ve miktar birbirine
karıştırılmamalı; düzenleyip değiştirmeden kaydetme de round-trip test edilmeli.

## M14 — Altın defteri ve varlık projeksiyonunun miktar hassasiyeti farklı

Kaynak: `supabase/migrations/20260607140000_add_gold_lots.sql:15`,
`src/utils/goldLedgerSync.ts:88`, `src/utils/goalSources.ts:187`.
Yerel şema: `gold_lots.quantity numeric(15,4)`, `assets.amount numeric(14,2)`.

**Gerçek SQL:** Köprünün ürettiği gibi 1,2345 gram / 6.172,50 TL varlık
girdisi yazıldığında `amount=1.23` saklandı. 5.000 TL canlı kurla miktardan
türetilen değer 6.150,00 TL; defter değerinden 22,50 TL farklı. Defter, genel
varlık özeti ve miktara bağlı hedef aynı pozisyonu farklı okuyabiliyor.

İlk turda yalnız doğrudan `assets` kaydında üçüncü hane örneği elenmişti.
Bu tur **geçerli dört haneli gold_lots → iki haneli assets köprüsü** bulundu;
bu nedenle o eleme bütün altın yolunun hassasiyetini doğrulamış sayılmaz.

**Çözüm:** Kanonik miktar hassasiyetini varlık projeksiyonunda koru; migration
ve ilgili miktar toplamlarını birlikte ele al. Altın miktarını `sumTL/roundTL`
ile kuruşa çevirmeyen birim hesabı kullan. TL değerleri money.ts üzerinden
iki haneli kalmalı. Geçmişte kaybolan miktarı tahmin etme; defter kaynağı
varsa ondan yeniden projekte et.

**Kabul:** 1,2345 gram defter → DB varlık → hedef kaynağı → canlı eder aynı
miktarı korumalı. Restore/export ve miktarı iki haneli kabul eden diğer
tüketiciler de kontrol edilmeli.

## M15 — Alım/satım yönü senkron anahtarında yok

Kaynak: `src/pages/GoldPage.tsx:162` ve `:176`.

**Tarayıcı:** 10 gram + 4 gram alım, yönetilen varlık 14 gram. İkinci
kaydı aynı tarih/miktar/fiyatla 4 gram satıma çevirdim. Altın sayfası 6 gram
hesaplarken yönetilen varlık 14 gram kaldı; başlangıçtaki bir sync yazısından
sonra yeni PATCH olmadı.

**Neden:** `rowsKey` id/tarih/tür/ayar/miktar/fiyat/not içeriyor, `direction`
içermiyor. Rows referansı değişip effect çalışsa bile aynı syncKey erken
dönüyor. Ayrıca son denenen anahtar başarıdan önce saklanıyor; hata halinde
aynı anahtarın yeniden denenmesi de gözden geçirilmeli.

**Çözüm:** Projeksiyonun bütün girdileri anahtarda olsun; son başarılı
senkron ile çalışan denemeyi ayır. Eski/geciken senkronun yeni özeti ezmesi
engellensin. M14'ün hassasiyet düzeltmesi bunun yerine geçmez.

**Kabul:** Yalnız yön değişimi 14 → 6 yapmalı; silme/son lotu silme, ilk
yazma hatası ve hızlı ardışık düzenleme de yeniden üretilebilir testlere girmeli.

## M16 — Altın alışını düzenleme/silme satılmış miktarı korumuyor

Kaynak: `src/pages/GoldPage.tsx:318`,
`src/utils/goldLedger.ts:57`, `src/data/repositories/crudRepo.ts:20`.

**Tarayıcı:** 10 gram alış ve sonraki 4 gram satış varken alış 1 grama
indirilebildi. Form hatasız kapandı. **Gerçek SQL:** Aynı güncelleme kabul
edildi ve net miktar −3 gram oldu. `validateGoldLot` yalnız gönderilen satır
satışsa envanteri kontrol ediyor; alış değiştirme ve silme yolu bu korumada yok.

**Ek saf gözlem:** 4 gram satışın tarihi, 10 gram alıştan önce olunca
`summarizeGoldType` negatif havuzu 0'a kırpıp son miktarı 10 gösteriyor;
imzalı toplam 6. Negatif tarihsel durum gizlenince sonraki alışla kayıp satış
ortadan kalkmış gibi görünüyor.

**Çözüm:** Ekle/düzenle/sil sonrası önerilen tüm tür bazlı envanter
zincirini kontrol et; geçmiş satışın tüketeceği miktarı alış düzenlemesiyle
yok etme. Sunucu yazma sınırında kilit ve tam plan doğrulaması gerekli;
yalnız UI kontrolü iki sekmeyi korumaz. Eski geçersiz geçmişi sessizce
yeniden yazma; inceleme uyarısı ver. Restore kendi toplu doğrulama sırasını
korumalı ve geçerli yedek ara insert sırasından dolayı reddedilmemeli.

**Kabul:** Alış azaltma, alış silme, alışın türünü değiştirme ve tarihi
satışın sonrasına alma mevcut satışı geçersiz kılıyorsa yazma reddedilmeli.
Geçerli aynı gün alım/satım ve tarihsiz açılış sözleşmeleri korunmalı.

## M17 — Katkılı değer güncellemesi tekrarda sahte zarar oluşturuyor

Kaynak: `src/components/finance/AssetValueHistoryPanel.tsx:95`,
`src/services/assetValueHistory.ts`,
`supabase/migrations/20260908160000_asset_value_events.sql:97`.

**Tarayıcı:** Katkılı güncellemenin yanıtı kaybolunca aynı form aynı değer,
katkı ve tarihle tekrar RPC gönderiyor. **Gerçek SQL:** Başlangıç 1.000 TL;
değer 1.500, katkı 500. Aynı çağrının tekrarı iki event, toplam katkı 1.000
ve toplam getiri −500 TL üretti. Gerçekte tek katkı 500 ve getiri 0 olmalı.
Güncel değerin mutlak yazılması event tarafını idempotent yapmıyor.

**Çözüm:** Güncelleme niyetine makbuz/UUID; belirsiz sonucu aynı kimlikle
doğrulama. Olay geçmişini UPDATE/DELETE ederek düzeltme yapma. Gerçek ikinci
katkı, aynı değerde olsa da yeni niyet olarak ayrı kayıt üretmeli.

**Kabul:** Kayıp yanıt tekrarı tek event/katkı/history üretmeli; gerçek ikinci
katkı engellenmemeli. Negatif katkı/çekim ve sıfır getiri durumları korunmalı.

## M18 — Değer taslağı gezinme korumasının dışında

Kaynak: `src/components/finance/AssetValueHistoryPanel.tsx:207`,
`src/lib/navigationSafety.ts:18`.

**Tarayıcı:** Değer güncellemede 8.000 yazıp Analiz'e gidildi. Hiç onay
diyaloğu açılmadı ve taslak unmount oldu. Koruma yalnız form veya dialog
altındaki input'ları izliyor; bu alanlar div içinde ve ikisinin de dışında.

**Çözüm:** Mevcut gezinme korumasının tanıdığı semantik form/explicit edit
kapsamı kullan. Başarılı kayıt temizlemeli, başarısız kayıt taslağı korumalı;
geçici filtreler ve hesap makinesi input'ları yanlışlıkla kilitlenmemeli.

**Kabul:** Link, browser geri, reload ve kapatma yolları; vazgeçme reddi
aynı taslağı tutmalı, başarılı kayıttan sonra gereksiz onay çıkmamalı.

## M19 — Geçersiz sayıyı sıfırdan ayıramayan formlar

Kaynak: `src/components/finance/AssetValueHistoryPanel.tsx:96`,
`src/components/dashboard/SeritBufferRow.tsx:20`,
`src/components/finance/KasaModuPanel.tsx:100`, `src/utils/formatCurrency.ts`.

**Tarayıcı, iki ayrı yol:** Yeni varlık değerine `abc` girip Kaydet, RPC'ye
`p_value=0` gönderdi. Güvenlik tamponuna `abc` girip kaydetmek cihazdaki
5.000 TL tamponu 0'a çevirdi. `parseNumber` geçersiz metinde 0 döndürüyor;
bu formlardaki finite/negatif kontrolü 0'ı geçerli sayıyor. Rezerv düzenleme
de aynı yapıda; bu üçüncü yol kaynak incelemesidir, tarayıcı probu yapılmadı.

**Çözüm:** İşlem formunda parse başarısını ayrıca doğrula; gerçek `0`, boş
opsiyonel alan ve geçersiz metin ayrı durumlar olmalı. Mevcut `parseNumber`
fallback'ini bütün eski tüketicilerde bir anda değiştirip regresyon üretme.
M13 native sayı/locale probleminden farklıdır: burada geçersiz giriş yıkıcı
bir geçerli değere dönüşmektedir.

**Kabul:** `abc`, bozuk ayıraç, sonsuz/taşan sayı → yazma yok, alan hatası.
Açıkça girilen `0` gerekli yerlerde geçerli. Hatalı katkı metni de sessizce
sıfır katkı olmamalı. MoneyInput blur normalizasyonu hatayı kaybettirmemeli.

## M20 — Sohbet temizlenirken çalışan yanıt silinen geçmişe yazılıyor

Kaynak: `src/pages/AssistantPage.tsx:203`, `:330`,
`src/app/useAiChat.ts:68`.

**Tarayıcı:** Kullanıcı mesajı kaydedildi, AI yanıtı bekletildi. Bu sırada
Geçmişi temizle → onay → DELETE ile dizi boşaldı. Bekleyen yanıt serbest
bırakılınca assistant INSERT yapıldı. Geçmiş yeniden tek cevaptan oluştu;
kullanıcı sorusu yoktu.

**Çözüm:** Temizleme ile çalışan gönderimi koordine et. En dar seçenek
gönderim sürerken temizlemeyi kapatmak; iptal desteklenecekse iptal/sohbet
nesli değiştikten sonra eski yanıtın DB'ye yazılması da engellenmeli.

**Kabul:** Kullanıcının temizlediği sohbet gecikmiş yanıtla geri gelmemeli;
yanıt tamamlanınca normal temizleme çalışmalı. Navigasyon/yeniden açılış ve
hata sonrası retry bu nesil sınırına uymalı.

## M21 — Depolama hatası hata sınırından önce boş ekran üretiyor

Kaynak: `src/main.tsx:15`, `src/hooks/useTheme.ts:8`,
`src/hooks/useBalancePrivacy.tsx:9` ve `:53`.

**Tarayıcı:** Tema anahtarı için Storage.getItem, SecurityError fırlatacak
şekilde engellendi. Başlangıçta pageerror oluştu, root boş kaldı. Çağrı React
error boundary kurulmadan önce olduğundan mevcut fallback bile gösterilmedi.
Bu koşul normal depolama açıkken her kullanıcıda oluşuyor diye sunulmamalı;
engelli/erişilemeyen storage koşulunun kontrollü testidir.

**Çözüm:** Başlangıç tercihlerinin güvenli okuma/yazması; storage yokken
oturum içi tema/gizlilik çalışması. Ödeme niyetinin kalıcı yazılması
gerekiyorsa onun başarısızlığını sessizleştirme: kayıt güvenliği ile kozmetik
tercih fallback'i ayrı kalmalı. Gizli tercih okunamıyorsa tutarı göstermeyi
varsaymanın mahremiyet kararı ayrıca açık olmalı.

**Kabul:** getItem ve setItem ayrı ayrı hata verirken giriş/kabuk açılmalı;
tema değiştirme çökmemeli. Gerçek finans yazımının niyet saklama gereği
korunmalı, depolama başarısızken kontrolsüz para isteği gönderilmemeli.

## M22 — Uzun kredi planı sessizce 240 satırda kesiliyor

Kaynak: `src/pages/LoansPage.helpers.ts:88`, `:176`, `:239`.

**Fonksiyon kanıtı:** 20 Ocak 2026–20 Aralık 2055, aylık 1.000 TL, toplam
360.000 TL kredi form doğrulamasından hatasız geçti. Gerçek
`syncLoanInstallmentPlan` repository'ye 240 taksit yazdırdı; son tarih
20 Aralık 2045. Son 120 ay/120.000 TL yok. Alt sınır/üst sınır açıklaması
veya form reddi bulunmuyor. Plan özet trigger'ı doğal olarak bu eksik
taksitlerden kalan borcu türetir; invariant doğru olsa da kaynak plan eksiktir.

**Çözüm:** Desteklenen vade için tam plan üret veya kaydetmeden önce açık
sınır hatası ver. Sessiz kesmeyi kaldır. Uzun planın batch/transaction ve
performans sınırını da tanımla; sadece while limitini büyütüp bilinmeyen bir
başka sınırda tekrar kesme.

**Kabul:** 239/240/241/360 aylık planlar ve ay sonu başlangıcı. Desteklenen
360 aylık plan gerçekten 360 satır olmalı; desteklenmiyorsa ana kredi bile
yazılmadan anlaşılır hata. Paid satır koruması M01/M07 ile birlikte sınanmalı.

## M23 — Restore bağlantı hatasında yanlış geri alma garantisi

Kaynak: `src/data/repositories/backupRepo.ts:90`,
`src/pages/DataHealthOperationsPage.tsx:121`.

**Hata enjeksiyonu:** Transactional restore RPC'si `Failed to fetch`
döndürdüğünde wrapper “Geri yükleme başarısız — hiçbir veri değişmedi”
fırlatıyor. Bu metin SQL transaction'ın açıkça reddedildiği hatayla commit
sonrası yanıt kaybını ayırmıyor. Ağ hatası sunucuda rollback kanıtı değildir.

**Etki:** Kullanıcı başarılı restore'u gerçekleşmemiş sanabilir; açık kalan
formdan eski yedeği tekrar yüklemek arada eklenen yeni kayıtları tekrar
silebilir. Bu ikinci yıkıcı adım probda çalıştırılmadı; çağrı sırası ve açık
formun yeniden gönderilebilmesinden doğan etkidir. Gerçek local restore/reset
çalıştırılmadı, mevcut verinin üstüne yazılmadı.

**Çözüm:** Kesin SQL reddi / belirsiz ağ sonucu mesajları ayrı. Belirsiz
sonuçta “veri değişmedi” deme; sonucu doğrulama ve mevcut veriyi yeniden
okuma adımı sun. Güvenli tekrar için restore niyeti/makbuzu ve payload hash'i
değerlendirilmeli; işlem öncesi yedek ve atomik rollback koruması korunmalı.

**Kabul:** SQL constraint/ownership reddi hiçbir veri değiştirmemeli; commit
sonrası bağlantı kaybı belirsiz gösterilmeli ve aynı niyet güvenle
doğrulanabilmeli. Taze veri varken eski yedeği kör tekrar uygulama olmamalı.

## Birleşik çözüm sırası

Kullanıcının “ikinci taramadan sonra hepsini çözelim” isteği için kapsam
M01–M23 + T01'dir. Ayrı özellik ekleme veya tasarım yenilemesi önerilmiyor.

1. **Yazma güvenliği:** M01/M02/M07/M12/M17/M19/M22/M23. Önce geçersiz giriş
   ve başarı-sonrası-hata durumu; sonra mevcut makbuz desenini para, katkı,
   rezerv ve restore niyetlerine uygula. Ledger geçmişini yeniden yazma.
2. **Altın bütünlüğü:** M13/M14/M15/M16/M11. Native sayı semantiği, miktar
   şeması, senkron girdileri, tüm envanter zinciri ve birime göre hedef
   karşılaştırması. Her SQL sınırını gerçek Postgres'te doğrula.
3. **Karar ve veri tutarlılığı:** M03/M04/M05/M08/M09/M10. Güven kapısı,
   rezerv tabanı, tam hedef referansları, maaş/bütçe cache matrisi, şema
   kapsamı ve tam okumalar. Tek ekrana özel finans kopyası oluşturma.
4. **UI dayanıklılığı ve kanıt:** M06/M18/M20/M21/T01. Gizlilik bütün görünür
   para birimlerini kapsasın; satır içi taslak ve çalışan sohbet davranışı
   korunsun. Canlı test seçicileri mevcut ürün diline uysun.

Her madde için önce mevcut kodda kırılan **doğru davranış** testi; sonra dar
düzeltme. Tüm paketler bitmeden maddeler kapatılmamalı. `npm run verify`,
ilgili tarayıcı senaryoları ve migration varsa temiz yerel seed/SQL/RLS/grant
kontrolleri kapanış kapısıdır. Backlog/AI index/domain sözleşmeleri aynı
değişiklikte güncel tutulmalı. Push/deploy ayrıca kullanıcı açıkça istemedikçe
yapılmamalı.

## Bulguların yorum sınırları

Belirli karşı örnekler kanıtlandı; gerçek finans hesabında bunların geçmişte
oluştuğu veya üretim verisinin bozuk olduğu iddia edilmez. Sayı/plan/mesaj
hataları ile bilerek seçilmiş iş varsayımları ayrıldı. Mevcut tutarsız veriye
otomatik tahminli düzeltme bu araştırmanın veya önerilen dar hata düzeltmelerinin
parçası değildir. Yeni tablolar/receipt'ler için migration timestamp'i dosya
ve git geçmişinden benzersiz seçilmeli; restore/reset/yedek sözleşmesi açıkça
test edilmelidir.
