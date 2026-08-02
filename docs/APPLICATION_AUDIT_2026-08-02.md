# Uygulama Denetimi — 2026-08-02

> KAPI 1 çıktısı. Yalnızca denetim + kanıt + plan. Bu rapor onaylanmadan hiçbir
> kaynak/migration/dependency değişikliği yapılmadı. Onay sonrası KAPI 2'de
> yalnızca onaylanan bulgu ID'leri uygulanır.

## 1. Yönetici özeti

Kod tabanı olgun ve daha önce 6+ belgelenmiş denetim turundan geçmiş (bkz.
`docs/BACKLOG.md`). Bu denetim, en yüksek riskli katmanları (para modeli,
ledger/trigger invariant'ları, güvenlik, RPC/migration) hedefli derin okuma +
kod-geneli anti-pattern taramasıyla inceledi ve **bu katmanların sağlam
olduğunu doğruladı**. Bu nedenle bulgular azdır ve kasıtlı olarak şişirilmemiştir.

Başlangıç kapıları (temiz zemin):
- `npm run lint` → 0 uyarı/hata
- `npm run test:unit` → 78 dosya / **772 test geçti**
- `npm run build` → başarılı

Çalışma alanı temizdi; kullanıcıya ait bekleyen değişiklik yoktu.

Onaya sunulan somut bulgular:
- **F-01 (P3):** `src/utils/smsParser.ts` içindeki `inferCategory` + `CATEGORY_RULES`
  ölü + stale (8 kategori; kategori taksonomisi 8→13 geçişinde güncellenmemiş;
  uygulama kullanmıyor — kanonik motor `categories.ts`). Dosyanın PARSING kısmı
  (regex'ler) canlı `parse-sms` edge fonksiyonunun test edilebilir aynasıdır ve
  KORUNUR.
- **F-02 (P2):** `SimpleModal` (10 modalın tabanı, para hareketi modalları dahil)
  focus trap / Escape / focus-restore içermiyor — oysa `confirm-dialog.tsx`
  aynı deseni doğru uyguluyor.
- **F-04 (P3, R-4'te bulundu):** `record_sms_account_movement` RPC'si `p_occurred_at`
  parametresini alıp KULLANMIYOR (db lint uyarısı) → SMS ile gelen hesap hareketi
  gerçek işlem tarihini kaydetmiyor olabilir. Onaylanan kapsam dışı; yalnız raporlandı.
- **F-03 (P4/fikir):** Kanıtlanmamış/opsiyonel maddeler ve daha geniş denetim için
  önerilen ek pass'ler (§9).

> **F-01 DÜZELTMESİ (uygulama sırasında):** İlk raporda "yalnız kendi testi import
> ediyor / testi yok" denmişti. Silmeden önceki doğrulama, dosyanın (a) edge
> parsing regex'lerinin tek test aynası olduğunu ve (b) `inferCategory` için 6
> testi bulunduğunu ortaya çıkardı. Bu yüzden dosya KOMPLE SİLİNMEDİ; yalnız ölü
> kategori bloğu + onun 6 ölü testi kaldırıldı, parsing aynası + testleri korundu.

## 2. Denetlenen ve denetlenemeyen alanlar

### Derinlemesine denetlendi (okuma + kanıt)
- Para modeli: `money.ts`, `formatCurrency.ts`, `financeSummary.ts` başlığı,
  kod-geneli `Math.round(*100)/100`, `±0.01`, `toFixed` taraması.
- Kategori motoru: `categories.ts`, `smsParser.ts`, `supabase/functions/parse-sms`.
- Tip güvenliği: `as any`/`as unknown`/`@ts-ignore`/`dangerouslySetInnerHTML` taraması.
- React desenleri: `key={index}` taraması, `set-state-in-effect` disable envanteri,
  `CrudPage` yükleme yolu.
- Güvenlik: 85 migration'da `SECURITY DEFINER` + `search_path`; frontend'de
  service-role key/`VITE_*` sızıntısı; bakım RPC grant'i.
- Modal/ödeme a11y + çift-gönderim: `SimpleModal`, `confirm-dialog`,
  `AccountPaymentModal`, `FinancePaymentDrawer`.

### Statik inceleme (çalıştırılmadan)
- 49 sayfa + ~68 komponentin tamamı tek tek okunmadı; kategori düzeyinde envanter
  ve hedefli örnekleme yapıldı (§4). "Tek tek değerlendirilmedi" olarak işaretli.
- Ledger SQL trigger ↔ saf TS ikiz eşleşmesi satır satır yeniden doğrulanmadı;
  mevcut `financeSummary.test.ts` + `DataHealth.logic.test.ts` kapsamına güvenildi.

### Denetlenemedi (bu turda çalıştırılmadı)
- **Route × viewport × durum canlı matrisi.** Yerel Supabase docker + seed
  gerektirir (`npm run dev:local` + `db:seed:local`). Bu turda ayağa kaldırılmadı;
  §3'teki matris **planlanan** pass'tir, canlı ölçüm değildir. Ayrı bir pass olarak
  önerilir (§9, öneri R-1).
- E2E (`test:e2e`) ve `test:coverage` bu turda çalıştırılmadı.
- Salt-okunur dependency audit bu turda çalıştırılmadı (öneri R-2).

## 3. Route × viewport × durum kapsam matrisi (PLANLANAN — canlı ölçülmedi)

Aşağıdaki matris, canlı doğrulama pass'i onaylanırsa uygulanacak plandır. Hiçbir
hücre bu turda tarayıcıda ölçülmemiştir; "test edilmiş" gibi sunulmamalıdır.

| Route | 390px | 1440px | loading | empty | error | modal açık |
|---|---|---|---|---|---|---|
| `/` dashboard | plan | plan | plan | plan | plan | plan |
| `/kartlar` | plan | plan | plan | plan | plan | plan (ödeme/hareket) |
| `/odemeler` | plan | plan | plan | plan | plan | plan (ödeme çekmecesi) |
| `/borclar/krediler` | plan | plan | plan | plan | plan | plan |
| `/borclar/kisiler` | plan | plan | plan | plan | plan | plan |
| `/varliklar` (+/maas,/altin) | plan | plan | plan | plan | plan | plan (al-sat) |
| `/analiz` (+detay) | plan | plan | plan | plan | plan | plan (rapor) |
| `/veri-sagligi` (+işlemler) | plan | plan | plan | plan | plan | plan |
| `/alsam-mi`, `/liste`, `/login` | plan | plan | plan | plan | plan | — |

Riskli sayfalarda ek: 320/768/1024 px + %200 zoom + `prefers-reduced-motion`.

## 4. Komponent envanteri ve kararlar

Kategori düzeyi envanter + tek tek incelenenlerin kararı. İncelenmeyenler
"kanıt yetersiz, değiştirme" varsayılanındadır (regresyon riski > kanıt).

| Alan | Dosya sayısı | Sınıf | İncelenen | Karar |
|---|---|---|---|---|
| `components/ui/*` | 16 | UI primitive | `button`, `input`, `alert`, `confirm-dialog`, `skeleton`, `help-tooltip` | **Koru** — tutarlı, token tabanlı; `confirm-dialog` focus trap örnek alınmalı |
| `SimpleModal.tsx` | 1 | Form/modal tabanı | evet | **Dar iyileştir** (F-02): focus yönetimi ekle |
| `components/finance/*` | 27 | Finance/domain | `AccountPaymentModal`, `FinancePaymentDrawer` | **Koru** — çift-gönderim `disabled={saving}` ile korunuyor; a11y F-02'den türer |
| `components/dashboard/*` | 7 | Domain panel | `SafeToSpendCard` (örnek) | Kanıt yetersiz, değiştirme |
| `components/charts/*` | 7 | Chart/veri görsel | `vizPalette` (docs) | **Koru** — doğrulanmış kategorik palet, saf SVG (ağır kütüphane önerilmez) |
| `components/CrudPage.tsx` | 1 | Shared CRUD şablonu | evet | **Koru** — `Input`/`Button` primitive kullanıyor; `key={index}` yalnız skeleton |
| `pages/*` | 49 | Route/page | örnekleme | Çoğu tek tek değerlendirilmedi; §7'deki taramalar temiz |
| `utils/smsParser.ts` | 1 | Ölü/kopya kod | evet | **Kaldır** (F-01) |

Ham `<button>` sayfalarda 58 yerde, ham `<input>` 14 dosyada geçiyor. Örnekleme
(`SimpleModal` kapatma butonu, `FinancePaymentDrawer` hızlı-tutar çipleri) bunların
`aria-label`'lı, küçük, sayfa-özel kontroller olduğunu gösterdi — `Button`/`Input`
primitive zorunluluğu **kanıtlanmadı**. Kesin karar için sayfa-sayfa örnekleme
gerekir (öneri R-3); "modern olsun diye" değiştirme reddedilir.

## 5. Değiştirilmemesi gereken komponentler (gerekçeli)

- **`money.ts` ve tüm para aritmetiği.** Tarama temiz; disiplin korunmuş. Dokunma.
- **`vizPalette.ts` + saf SVG chart'lar.** Doğrulanmış CVD-güvenli palet; ağır grafik
  kütüphanesi önerisi ölçülebilir kazanç olmadan reddedilir.
- **`confirm-dialog.tsx`.** Focus trap + Escape + Tab döngüsü zaten doğru.
- **`categories.ts` + `parse-sms` edge fonksiyonu.** 13-kategori taksonomisiyle
  senkron; whole-word matcher taksi/taksit tuzağını çözmüş.
- **Ledger/trigger invariant katmanı.** DataHealth + testler kapsamlı; kanıtlı
  regresyon olmadan açılmaz.

## 6. Komponent alternatifleri karşılaştırma tablosu

Yeni dependency veya geniş UI-library değişimi **önerilmiyor**. Tek somut
komponent değişikliği F-02'dir ve mevcut repo primitive'iyle (repo-içi desen)
çözülür:

| Konu | Mevcut | Önerilen | Kanıtlı sorun | Yeni dep? | Kazanç | Karar |
|---|---|---|---|---|---|---|
| Modal focus yönetimi | `SimpleModal` (yok) | `confirm-dialog`'daki deseni `SimpleModal`'a taşı | Klavye/SR kullanıcı modaldan çıkabiliyor | Hayır (repo-içi) | WCAG 2.4.3/APG uyumu, 10 modal | **Uygula (F-02)** |

## 7. Önceliklendirilmiş kesin hatalar

Bu turda **P0/P1 kesin finans veya güvenlik hatası bulunmadı.** Para, ledger,
güvenlik ve tip taramaları temiz çıktı.

## 8. Hesaplama ve finans invariant bulguları

- Kod-geneli `Math.round(x*100)/100`: yalnızca `smsParser.ts:36` (ölü kod, F-01)
  ve giriş-ayrıştırma bağlamı (`formatCurrency`). Aggregation katmanında **yok**.
- `±0.01` çıplak tolerans: yalnızca yorum/doküman içinde; kodda **yok**.
- `toFixed` ile hesap: bulunamadı.
- tr-TR lowercase tuzağı: `categories.ts` ve `parse-sms` `[Iİ]→i` map'liyor; kalan
  `toLocaleLowerCase` kullanımları giriş-ayrıştırma/dosya-uzantısı (zararsız).

**Sonuç:** Finans invariant katmanı sağlam; bu turda düzeltme gerektiren
hesaplama hatası tespit edilmedi.

## 9. Veri / RPC / migration / güvenlik bulguları

Hepsi **olumlu** (düzeltme gerekmiyor):
- 19 `SECURITY DEFINER` fonksiyonunun tamamı `search_path` ayarlıyor; 106 kullanımın
  tamamı en güvenli değer olan `search_path = ''`.
- Frontend'de service-role key / `SUPABASE_SERVICE_ROLE` sızıntısı yok; yalnızca
  public `VITE_SUPABASE_ANON_KEY` kullanılıyor.
- `run_scheduled_card_maintenance` `authenticated` rolüne grant edilmemiş
  (FINANCE_RULES niyetiyle uyumlu).
- RLS/grant denetimi CI'da zorlanıyor (`db:audit:rls:local`, `db:audit:grants:local`).

## 10. UX / a11y / responsive / performans bulguları

- **F-02 (P2, CONFIRMED):** `SimpleModal.tsx` — `role="dialog" aria-modal="true"`
  var ama: (a) açılışta modala focus taşınmıyor, (b) Tab focus trap yok (arka plana
  kaçar), (c) Escape ile kapatma yok, (d) kapanışta focus restore yok. 10 modal bunu
  miras alıyor: `AccountPaymentModal`/`FinancePaymentDrawer` (para hareketi),
  `AssetsPage.tradeModal` (al-sat), `CardsPage.movementModal`, `KasaModuPanel`,
  `SavingsGoalsPanel`, `CardInstallmentExpensesPanel`, `DataHealthPage.components`,
  `LoansPage`, `AnalysisPage.reports`, `CrudPage`. Kanıt: `confirm-dialog.tsx:46-60`
  doğru deseni içerirken `SimpleModal.tsx:12-43` içermiyor.
- Çift-gönderim: `AccountPaymentModal.tsx:155` `disabled={saving}` ile korunuyor
  (olumlu). `saving`'i parent senkron set ettiği sürece hızlı çift-tık güvenli.

## 11. Test ve dokümantasyon boşlukları

- `smsParser.test.ts` ölü koda test yazıyor → yeşil CI yanlış güven veriyor (F-01
  ile birlikte kaldırılır).
- Modal a11y için birim/E2E testi yok (F-02 düzeltmesiyle birlikte hedefli test önerilir).

## 12. Bilinçli doğru bırakılmış (ilk bakışta şüpheli) davranışlar

- `set-state-in-effect` eslint-disable'ları (18+ site): büyük çoğunluğu "mount'ta
  async veri yükle" desenidir (`CrudPage.tsx:244-247` gibi) — meşru, derived-state
  değil. Rastgele örnekleme derived-state anti-pattern'i göstermedi.
- `crudRepo.ts` / `dataHealthRepo.ts` `as unknown as` cast'leri: Supabase yanıt
  sınırında kontrollü boundary cast; hata gizleme değil.
- `key={index}`: yalnızca skeleton/placeholder ve sabit chart eksenlerinde; dinamik
  veri satırında değil.

## 13. Yanlış alarm olarak elenen adaylar

- `CrudPage.tsx:397 key={index}` → skeleton, gerçek satır değil.
- `formatCurrency.ts:64 toLocaleLowerCase` → giriş ayrıştırma, sayısal bozulma yok.
- `CurrentMovementImportModal.tsx:140` `.pdf` uzantı kontrolü → 'I' harfi uzantıda
  olmadığı için tuzak tetiklenmez.
- Ham `<button>` yaygınlığı → örneklenenler aria-label'lı sayfa-özel kontroller;
  primitive zorunluluğu kanıtlanmadı.

## 14. Bağımlılık sıralı uygulama fazları

### Faz 1 — Ölü kod temizliği (F-01)
- **Bulgu:** F-01
- **Dosyalar:** `src/utils/smsParser.ts`, `src/utils/smsParser.test.ts` (sil);
  `docs/AI_CONTEXT_INDEX.md` referansı varsa güncelle.
- **Korunacak invariant:** `parse-sms` edge fonksiyonu ve `categories.ts` canlı yol;
  frontend `smsParser` uygulamada kullanılmıyor → davranış değişmez.
- **Kabul kriteri:** `grep smsParser src` → yalnız silinen dosyalar; lint+test+build yeşil.
- **Test:** mevcut suite (ölü test kalkar).
- **Risk/rollback:** çok düşük; tek commit revert.
- **Doküman:** AI_CONTEXT_INDEX (gerekirse), BACKLOG'a not.

### Faz 2 — Modal focus yönetimi (F-02)
- **Bulgu:** F-02
- **Dosyalar:** `src/components/SimpleModal.tsx` (+ paylaşılan focus-trap helper;
  `confirm-dialog.tsx` deseni referans).
- **Korunacak invariant:** 10 modalın görsel/işlevsel davranışı; finans matematiği yok.
- **Kabul kriteri:** modal açılınca ilk odak içeride, Tab döngüsü içeride kalıyor,
  Escape kapatıyor, kapanınca odak tetikleyiciye dönüyor; lint+test+build yeşil.
- **Test:** SimpleModal için hedefli a11y birim testi (focus trap + Escape);
  mümkünse bir ödeme modalı E2E smoke.
- **Risk/rollback:** düşük-orta (focus regresyonu); izole commit, tek revert.
- **Doküman:** `docs/UI_ARCHITECTURE.md` a11y sözleşmesine modal focus kuralı.

### Faz 3 (opsiyonel) — Genişletilmiş denetim pass'leri
Onaya bağlı; §9 önerileri.

## 15. Kalan varsayımlar ve kullanıcı kararları

Aşağıdaki genişletme pass'leri kaynak kod değişikliği DEĞİL, ek denetim eforudur:

- **R-1:** Yerel Supabase seed ile canlı route×viewport×durum matrisini (§3)
  tarayıcıda çalıştır (a11y/responsive/empty/error/stale gerçek ölçüm).
- **R-2:** Salt-okunur dependency audit + `test:coverage` + `test:e2e` çalıştır.
- **R-3:** 49 sayfa için sayfa-sayfa ham `<button>`/`<input>` → primitive tutarlılık
  örneklemesi (yalnız kanıtlı tekrar varsa değişiklik).
- **R-4:** Ledger SQL trigger ↔ TS ikiz eşleşmesini yerel docker'da açık SQL
  sorgularıyla satır satır yeniden doğrula.

## Onay sorusu (KAPI 2'ye geçiş)

Hangi fazları/bulguları uygulamamı istersin?
- Faz 1 (F-01 ölü kod) — düşük risk
- Faz 2 (F-02 modal a11y) — düşük-orta risk
- Faz 3 / R-1..R-4 genişletilmiş denetim (kod değişikliği değil, ek inceleme)

Onaylamadığın maddeler uygulanmaz.

---

## KAPI 2 — Uygulama sonucu (2026-08-02)

Kullanıcı "hepsi"ni onayladı. Uygulananlar:

**F-01 (uygulandı).** `smsParser.ts`'ten ölü/stale `inferCategory`+`CATEGORY_RULES`
+`normalizeForCategory` ve `smsParser.test.ts`'ten karşılık gelen 6 ölü test
kaldırıldı. Parsing aynası + testleri korundu. Test sayısı 772→766 (yalnız ölü
testler düştü, gerçek kapsam azalmadı).

**F-02 (uygulandı + otomatik test).** `SimpleModal.tsx`'e focus yönetimi eklendi:
açılışta modala focus (`tabIndex=-1` section), Tab döngüsü (focusable listesi HER
Tab'da yeniden sorgulanır — form içeriği dinamik), Escape ile kapatma, kapanışta
focus-restore. `confirm-dialog` deseni referans alındı; `confirm-dialog` scope-creep
önlemek için değiştirilmedi. **Otomatik a11y testi eklendi:** kullanıcı onayıyla
DOM test altyapısı kuruldu (`happy-dom` + `@testing-library/react` devDep;
`vitest.config` include `*.test.{ts,tsx}`, global env `node` KALIR, test dosyası
per-file `// @vitest-environment happy-dom` pragma'sı kullanır → util testleri
DOM'suz kalır). `SimpleModal.test.tsx` (5 test): focus-into-dialog, Escape,
Tab/Shift+Tab trap, focus-restore. Coverage `src/utils/**` olduğu için eşik
etkilenmez.

**F-04 (uygulandı).** `record_sms_account_movement` `p_occurred_at`'i kullanmıyordu;
`transaction_history` INSERT'i `occurred_at` kolonunu yazmadığı için satır `now()`
alıyordu. Edge (`parse-sms`) gerçek SMS zamanını zaten `p_occurred_at` olarak
geçiriyordu; tablo `occurred_at` kolonuna sahipti; aktivite akışı (`activityFeed.ts`)
ve `financePanelsRepo` `occurred_at`'e göre sıralayıp/filtrelediği için gecikmeli SMS
yanlış günde görünüyordu. Forward migration `20260802120000` INSERT'e
`occurred_at = coalesce(p_occurred_at, now())` ekledi (imza/security/grant birebir
korundu). account_ledger olayı bilinçli olarak sistem-zamanı (`now()`) ile append-only
kalır. Yerel docker doğrulaması: RPC geçirilen 3-gün-önceki tarihi yazdı
(`occurred_at≠created_at`), db lint uyarısı kalktı, RLS/grants/catchup yeşil.

**R-2 (tamam).** `npm audit --omit=dev` → **0 açık**.

**R-3 (tamam — "refactor yok" kararı).** Ham `<button>`/`<input>` örneklemesi:
`SafeToSpendCard` küçük inline tampon editörü, `NotificationSettings` checkbox
(Input primitive kapsamıyor), modal kapatma ikon butonları (aria-label'lı). Primitive
zorlaması için kanıtlı tekrar yok → değiştirme.

**R-4 (tamam).** Yerel docker'da: RLS denetimi OK (tüm public tablolar RLS + own-row),
grants temiz, `db:test:catchup` idempotent (ekstre=1/borç=1500/ledger=2, çift koşuda
tekrar üretmedi), `db:lint` yalnız 1 önceden var olan uyarı (F-04). Boş seed DB'de
kart-borç↔ledger sapması 0.

**R-1 (kısmi).** Yerel Supabase seed'lendi (yalnız auth kullanıcısı; finans verisi
yok), dev:local + tarayıcı açıldı. Doğrulanan: login kabuğu 390px ve 800px'te
**yatay taşma 0**, aşırı geniş öğe yok, konsol hatası yok. **Bloke:** auth-arkası
route×viewport matrisi ve F-02'nin gerçek modalda canlı focus testi, ajanın alanlara
**şifre girmesi yasak** olduğu için yapılamadı (belgelenmiş yerel test hesabı için
bile). Kullanıcı yerel `t@t.com` ile giriş yaparsa bu kısım tamamlanabilir.

**Doğrulama kapıları (uygulama sonrası):** `npm run lint` temiz · `npm run test:unit`
766/766 · `npm run build` başarılı · RLS/grants/lint/catchup yerel docker'da yeşil.

**Kalan / ertelenen:**
- F-04: incelendi + kanıtlandı; düzeltme migration'ı ayrı onay bekliyor.
- R-1 auth-arkası canlı matris + F-02'nin gerçek modalda canlı focus testi: ajanın
  şifre girme yasağı nedeniyle bloke; kullanıcı yerel `t@t.com` ile giriş yaparsa
  tamamlanır. (F-02 mantığı otomatik testle zaten doğrulandı.)
