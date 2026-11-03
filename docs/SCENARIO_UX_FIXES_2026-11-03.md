# İkinci tur senaryo ve UX — düzeltme / yayın kaydı

Kapsam: `docs/SCENARIO_UX_AUDIT_2026-11-03.md` içindeki R2-F01–F04 ve
R2-U01–U04. Kullanıcı düzeltmelerin tamamını ve ardından canlı yayını istedi.

## Son davranış ve kanıt

| Bulgu | Uygulanan davranış | Kalıcı regresyon |
| --- | --- | --- |
| R2-F01 | Arşivli kartın açık dönem vadesi gerçek kesimden türetilir; eski ekstrenin açık/ödenmiş olması tarihi değiştirmez. Aynı gün zaten kesilmiş arşiv yeni döneme ilerletilir. 72.000 TL, eski ekstre ödemesinden sonra da 72.000 TL kalır. Arşivsiz eski kaydın mevcut muhafazakâr ayrımı korunur. | `src/utils/obligations.test.ts`, `src/utils/cashFlowForecast.test.ts` |
| R2-F02 | Beş ödeme RPC'si `submit_finance_payment` transaction makbuzuyla çağrılır. Kullanıcı + işlem UUID'si bir kez uygulanır; aynı UUID/farklı payload reddedilir. Belirsiz yanıt, modal/yenileme sonrasında aynı alanlar/kimlikle “Sonucu doğrula” olur. Alanlar kilitlenir; işlemin önceki bilgileri olduğu açıklanır. | `supabase/tests/finance_payment_requests.sql`, `src/hooks/useFinancePaymentDrawer.test.tsx`, `src/services/financePaymentActions.test.ts`, `tests/e2e/simplification.spec.ts` |
| R2-F03 | Teşhis düzeltildi: önceki rapor kalıcı eski snapshot sonucunu fazla ileri taşıdı; callback çalışıyor ve Özet mount olunca yenileniyordu. Sorun eski boş verinin kısa süre görünmesiydi. Ortak invalidation artık kapalı Özet'i de fetch eder ve kaydetme bunu bekler. Yerel gerçek backend'de snapshot 1 → 2 ve ilk SPA dönüşünde 5.000 TL. | `src/app/useFinanceSnapshot.test.tsx`; yerel gerçek UI/API kanıtı |
| R2-F04 | Navigation safety router kurulmadan önce senkron yüklenir. Popstate, alanlar unmount olmadan onay alır; vazgeçince rota/modal/tutar korunur. | `tests/e2e/simplification.spec.ts`; gerçek tarayıcı Geri/Escape denemeleri |
| R2-U01 | Hesap hareketlerinde not/tarih/tutar araması tam yüklenmiş geçmişi filtreler. Toplamlar ve satır sonrası bakiye tüm geçmişten gelir; filtre toplam diye sunulmaz. 1.206 kayıt içindeki 606. hareket tek sonuçla, sayfa geçmeden bulundu. | `src/components/finance/LedgerPanels.test.tsx`, 320/390/1280px E2E |
| R2-U02 | Kayıt başlıkları tam sarılır; 320px'de benzer iki uzun soyadı ödeme öncesi ayırt edilir, yatay taşma yoktur. | `tests/e2e/simplification.spec.ts` |
| R2-U03 | Son snapshot okumasının zamanı görünür. Açık offline oturum eski veri olduğunu söyler; bağlantıda yenilenir. Soğuk offline açılışta son özet bulunmadığı ve bağlantı/tekrar deneme yolu açıklanır; teknik fetch hatası gösterilmez. | Offline E2E + yerel production build / ısıtılmış service worker denemesi |
| R2-U04 | SQL reddinden sonra kalan ve hesaplar yeniden okunur; eski özel detay kaldırılır, girilen tutar korunur. Kullanıcıya güncel kalan/uygun Türkçe hata gösterilir. Tam ödemede de açık tutar gönderilir; başka sekme kalanı değiştirdiyse sessizce farklı tutar ödenmez. | Hook/servis testleri + gerçek iki context kısmi ve tam ödeme yarışı |

## Tekrar güvenliği ve veri sınırı

`20261103120000_finance_payment_requests.sql` yalnız yeni private makbuz tablosu
ve authenticated RPC ekler. Mevcut domain RPC'lerinin sahiplik, hesap, borç,
kısmi/tam ödeme ve append-only ledger kuralları kullanılır. Geçmiş ledger
olayları güncellenmez. Aynı kullanıcı kilidiyle eşzamanlı aynı kimlik de tek yazmadır.

Makbuzda ham ödeme alanları saklanmaz: kullanıcı/işlem kimliği ve SHA-256
payload hash'i vardır. Finans reset/restore bu opak tekrar korumasını silmez;
başka sekmedeki eski yanıt yeniden yüklenen aynı kaynak kimliğine tekrar ödeme
uygulamamalı. Auth kullanıcısı silinince makbuzlar cascade silinir. Makbuzlar
finans yedeğine dahil değildir. İstemcide yalnız belirsiz isteği aynı şekilde
tekrarlamak için gereken alanlar kullanıcı/kaynak kapsamlı `v1` localStorage
anahtarındadır; kesin sonuçta, bu cihazdaki başarılı reset/restore'da temizlenir.
Bozuk veya yazılamayan yerel işlem kaydı yeni ödeme olarak gönderilmez.

Soğuk offline finans verisi kalıcı saklanmaz; açık oturumdaki bellek verisi
gösterilebilir. Bu paket banka/piyasa verisini cihazda kalıcı offline finans
cache'ine dönüştürmez. `navigator.onLine` sunucunun erişilebilir olduğunu
garantilemez; bağlantı hatası da kullanıcıya anlaşılır sunulur.

## Doğrulama

- `npm run verify`: 176 dosya / 1.848 test, 7 guard; lint, coverage, production
  audit 0 açık, build/bundle ve altı edge tipi geçti. JS gzip yaklaşık 1.011 / 1.030 kB.
- Yerel sıfırdan migration + seed; `npm run db:test:all`: 53/53 geçti.
  Yeni test beş RPC, kısmi/tam tekrar, farklı kimlik/payload, rollback,
  iki kullanıcı, yetkisiz erişim ve reset sonrası güvenli tekrar içerir.
- Playwright: 34 geçti, mevcut dört live-backend testi koşuluyla atlandı.
  Ayrı yerel gerçek backend paketi 21 temel akış + aynı kimlikle eşzamanlı
  istek ve eski tam ödeme varyasyonunu kapsar; 19 tarih/hesap kontrolü de koşulur.
  Son yerel kayıtlar Codex artifact alanındaki `round2-fixes/` altındadır.
- Sentetik kullanıcılar akış sonunda temizlenir. Canlı finans kaydına test yazılmaz.

## Yayın ve geri dönüş

Hedef: `enesgarip/financeproject` → korumalı `main`; Vercel
`prj_z1VXWYRMbFoIiCA7nnUHf6D0hBnF`, team `team_pXijOTSlaOaKdqq00DnlphZU`.
Kanonik PR → CI → squash merge → `deploy.yml`: yedek, DB kontrolleri,
migration, staged production build, promote ve `/login` smoke.
Bu doküman yerel doğrulamayı kaydeder; yayın sonucu PR/Actions koşusunda doğrulanır.

Geri dönüş tetikleri: migration hatası, login smoke hatası veya ödeme tekrar
güvenliği/kritik veri akışı arızası. Promote/smoke hatasında workflow önceki
deployment'a döner. Migration eklemelidir; eski frontend/RPC yolları korunur,
frontend rollback için tablo/fonksiyon silinmez. Şifreli yedek kanonik hattadır.

Önceki F006 eksik şema görünürlüğü, tarihsel yuvarlanmış miktar mutabakatı,
gerçek banka/SMS/PDF, fiziksel iOS/Safari ve insan katılımcı ölçümleri bu
sekiz bulgunun düzeltme iddiasına dahil değildir.
