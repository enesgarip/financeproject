# 24 Ekim 2026 — İşlem sonrası veri tazeliği denetimi

Kapsam: para hareketi/ödeme/varlık işlemi sonrası açık paneller, sayfalar arası
TanStack cache ve geciken okuma yanıtları. Tüm uygulamada her olası render
hatasının bulunmuş olduğu iddia edilmez; finansal yazma kuralları ve SQL değişmez.

| Bulgu | Düzeltme | Kanıt |
| --- | --- | --- |
| Hesap/cüzdan bakiyesi yenilenirken ledger eski kalıyordu; kartta yenileme sırasında geçici fark çıkabiliyordu | `AccountLedgerPanel.tsx` / `CardLedgerPanel.tsx`: id, zaman damgası ve tutara bağlı okuma; farklı revizyonla kıyaslama yok | `src/components/finance/LedgerPanels.test.tsx`: giriş/çıkış, gerçek fark, hata, geciken yanıt, düzeltme ve eski mutation callback'i |
| Son üç hesap hareketi cache'i bakiye değişimini izlemiyor; hata boş liste sayılıyordu | `src/pages/CardsPage.list.tsx`: revizyonlu query key, yükleme/hata ve tekrar deneme | `src/pages/CardsPage.list.test.tsx`: gerçek liste kartı + TanStack cache |
| Ödeme sonrası snapshot güncelken diğer finans listeleri eski kalabiliyordu; kart harcama temposu da yenilenmiyordu | `src/app/useFinanceSnapshot.ts`: aynı kullanıcıdaki cards/payments/loans/debts/assets/stock_trades listeleri, son hareketler, tempo, snapshot ve kart detayları birlikte invalidation alır; aktifler okunur, kapalılar eski işaretlenir | `src/app/useFinanceSnapshot.test.tsx`: ödeme sonrası aktif bakiyenin 100→75 değişimi; kapalı listeler ve diğer kullanıcının cache'ini koruma |
| Varlık al/sat ve manuel düzenleme/değer güncelleme ortak özeti/hisse defterini yenilemiyordu | `src/pages/AssetsPage.tsx`: tüm başarılı yazma girişleri ortak invalidation'a bağlandı | `src/pages/AssetsPage.cache.test.tsx`: gerçek alım formu + mock RPC, hesap/varlık yeniden okuma ve kapalı defter/snapshot geçersizliği |
| Altın defterinin asset senkronu diğer ekranlarda eski varlık bırakıyordu | `src/pages/GoldPage.tsx`: yalnız inserted/updated/deleted > 0 ise ortak invalidation | `src/pages/GoldPage.cache.test.tsx`: değişiklik var/yok |
| Değer geçmişinde eski sorgu yeni yanıtı ezebiliyor, hata eski getiriyle gösteriliyordu | `src/components/finance/AssetValueHistoryPanel.tsx`: revizyon kontrolü, sorgu sırası ve etkin revizyon koruması | `src/components/finance/AssetValueHistoryPanel.test.tsx`: ters yanıt sırası ve yenileme hatası |
| Hisselerde assets ve stock_trades farklı zamanda yenilenince sahte adet farkı çıkabiliyordu | `src/pages/BorsaPage.tsx`: iki sorgudan biri yenilenirken karşılaştırma bekler; aynı query cache'i paylaşır | `src/pages/BorsaPage.test.tsx`: iki ayrı yükleme sırası; yükleme bitince gerçek farkın korunması |

İlk ledger hatası ve ek cache/değer geçmişi/eski mutation callback'i sorunları
düzeltme öncesi regresyon testlerinde üretildi. Testler gerçek React bileşenleri
ve TanStack cache'i kullanır; repository/RPC yanıtları kontrollü örneklerdir.
Üretim kullanıcı verisine test yazması yapılmaz. SQL/RPC değişmediği için yeni
DB reset/migration doğrulaması gerekmez.

Yayın: `npm run verify` ve Playwright smoke sonrası PR CI yeşilken main'e merge;
`deploy.yml` staged build'i promote eder ve `/login` smoke uygular. Smoke başarısızsa
pipeline önceki production deployment'a döner. Sonuçlar `docs/BACKLOG.md` içinde.
