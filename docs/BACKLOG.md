# Priority Backlog

## 2026-08-16 — Mutabakat parser'ı tek kartlı PDF + planlı ödeme kartı sadeleşmesi

- ~~**'Yemek' kategorisi 'Yeme & İçme' oldu + kafe sözlüğü genişledi.**~~ DONE
  (2026-08-16). Kullanıcı kararı: kafe/kahve harcamaları da bu kategoriye girer.
  Asıl bulgu ETİKET DEĞİL SÖZLÜKTÜ — gerçek ekstre satırlarıyla ölçüldü:
  `cafe` varken Türkçe `kafe` yoktu, `starbucks` varken bankanın bastığı
  `sbux`/`sbx` kısaltması yoktu → "PETROV KAFE", "COFFEE SINKY",
  "SBX İZM KORDON", "GLORIA JEANS", "KOFTECI YUSUF", "GREEN SALATA" satırlarının
  hepsi Diğer'e düşüyordu (tek ayda 8-9 satır). Bunlar `categoryCases.test.ts`'e
  regresyon vakası olarak eklendi.
  Kategori DB'de serbest metin olduğu için yeniden adlandırma migration ister:
  `20260816120000` üç tabloyu (`card_expenses`, `card_installments`, `budgets` —
  bütçe atlanırsa harcamalardan sessizce kopar) günceller ve safe-repair
  RPC'sindeki beyaz listeyi tazeler. RPC gövdesi kaynağıyla diff'lendi: yalnız
  beyaz liste satırı farklı. Yerel docker'da doğrulandı — 4 satır yeniden
  adlandı, 0 kaldı; RPC eski adı reddediyor, yenisini kabul ediyor; `db lint`
  temiz. Liste SIRASI korundu, yani viz rengi kaymadı.
  Geçmişte Diğer'e düşmüş satırlar bilerek toplu güncellenmedi: kullanıcı
  uygulamadaki Kategori Temizliği panelinden satıcı satıcı onaylayacak (hem
  görünür hem kategori hafızasını besliyor). `scripts/recategorize-ulasim.sql`
  arşiv olarak işaretlendi — eski sözlüğü taşıdığı için tekrar çalıştırılmamalı.

- ~~**Tek kartlı DenizBank güncel hareket PDF'i hiç okunmuyordu.**~~ DONE
  (2026-08-16). DenizBank `Kart No` + `Kart Tipi` kolonlarını yalnız karta bağlı
  ek/sanal kart varsa basar; tek kartlı üründe (ör. Gold) başlık
  `… İşlem Detayı İşlem Tutarı Bonus` olur. `ROW_PATTERN` bu iki kolonu zorunlu
  tuttuğu için TÜM satırlar `ignoredRows`'a düşüyordu — mutabakat ekranı boş
  geliyor, kullanıcı yalnız "N satır okunamadı" uyarısı görüyordu. Kolonlar
  opsiyonel gruba alındı (`CARD_COLUMNS_PATTERN`); kolon varken lazy açıklama
  yine kart grubunu tercih ettiği için çok kartlı PDF davranışı değişmedi
  (gerçek iki PDF ile doğrulandı: 7/7 ve 64/64 satır). `cardNo`/`cardType`/
  `cardLastFour` kolon yoksa boş string; taksit inceleme satırı sarkan `**** `
  basmıyor. Golden fixture: `movement.denizbank-2026-08-tekkart.txt`.
- ~~**Tanınmayan işlem detayı açıklamaya sızıyordu.**~~ DONE (2026-08-16).
  `KNOWN_DETAILS`'e `OGS-HGS Yükleme İşlemi` ve `Talimatlı Taksitli Satış`
  eklendi. Sıra kuralı yazıldı: uzun varyant kısa olandan önce gelmeli, aksi
  halde "Talimatlı Taksitli Satış" kısa etikete düşüp açıklamada sarkan
  "Talimatlı" bırakıyordu.
- ~~**Planlı ödeme kartındaki "Öde" butonu kaldırıldı.**~~ DONE (2026-08-16).
  Kart talimatlı satırda hemen üstteki "talimat bilgilendirmedir, SMS/ekstre ile
  işlenir" notuyla çelişiyordu (yeşil buton "bunu sen ödemelisin" diye okunuyor).
  Ödeme aksiyonu sayfa başındaki `ObligationsCalendar`'da ve panodaki şeritte
  duruyor; `paymentToObligation` ölü kaldığı için silindi.
- **Açık:** Veri Sağlığı'ndaki `payment-overdue-*` kontrolü BM-5'ten habersiz —
  kart talimatlı ödeme SMS/ekstre eşleşene kadar `bekliyor` kalır ve vadeyi bir
  gün geçince "vadesi geçmiş" uyarısı üretir. 2026-08-16'da gözlenen vaka gerçek
  bir bekleyen ödemeydi, o yüzden aksiyon ALINMADI. Tekrarlarsa doğru çözüm:
  talimatlılarda kısa tolerans penceresi + "SMS/ekstre eşleşmesi gelmedi" metni
  (kontrolden büsbütün çıkarmak, SMS hiç gelmeyen planı görünmez yapar).

## 2026-08-12 — Uygulama geneli denetim (kod + UI + docs)

Tüm `src/`, `supabase/` ve `docs/` dosya dosya tarandı; canlı UI turu yapıldı.
Bulguların tamamı ve önerilen faz planı: `docs/APPLICATION_AUDIT_2026-08-12.md`.
Özet: 18 kritik/yüksek bulgu (gizlilik maskesi sızıntısı, ilk girişte 401 yarışı,
`post_card_provision` migration regresyonu, çift ekstre ödemesi riski, altın grafiği
maliyet hatası, mutabakat parse hatası, agregat gelecek-taksit netlemesi vb.),
geniş ölü kod envanteri (~500 satır bayraklı ölü dal + 7 ölü dosya + ölü CSS),
tekrar eden yüzey haritası (kart kırılımı 11 yüzey, "Harcanabilir" 2 formül) ve
pgTAP kapsam boşlukları. Docs senkronu aynı gün yapıldı (bkz. rapor §11).
Düzeltme fazları (A–E) rapor §12'de. Faz F rapor §5/§6/§9/§10'daki kalan
ORTA/DÜŞÜK katmanı kapatır — denetimden açık bulgu kalmadı.

- ~~**Faz F — kalan ORTA/DÜŞÜK bulgular.**~~ DONE (2026-08-12). Üç ayrık kümede
  toplandı (+ DB tarafı ana oturumda):
  **DataHealth:** `card-split-` sayacı artık etkilenen KART üzerinden tekilleşiyor
  (tek kartta `splitOk = −1` bitti; tüm `*Ok` sayaçları `max(0, …)`); sabit ID'li
  bulgulara (`card-expense-missing-*`, `loan-paid-at-*`) `affectedSetSignature()`
  imzası eklendi — kalıcı "kapat" artık GELECEKTEKİ yeni kayıtları gizlemiyor;
  örtüşen borç bulguları tek "taşma" bulgusuna indi (diğerleri detay satırı);
  snooze "Bu görünümde gizle" / "Bu doğru, kalıcı kapat" olarak ayrıştı; detay
  React key'leri stabil; "en fazla 100" metni `MAX_SAFE_REPAIR_BATCH_SIZE`'dan;
  jargon (`posted_at`/`paid_at`/idempotent/immutable) Türkçeleşti; DataHealth
  kategori düzeltmesi artık kategori hafızasını besliyor.
  **Veri/servis:** `persistEstimatedValues` `{requested, updated, failed}`
  döndürüyor (kısmi başarı sessiz değil); `addCardExpense` araç etiketi hatasında
  `ok` + `carTagWarning` (tekrar gönderim kaynaklı çift harcama riski gitti);
  `useDailyNetWorthSnapshot` yalnız AYNI günün cache'ini kabul ediyor ve
  `setQueryData` yan etkisi kaldırıldı (finans bakımı atlanamaz);
  `paymentHistory` undo penceresi ay dışına taşındı + metin sözleşmesi tek
  sabitte; `purchaseImpact` modelle hizalandı (+ufuk aşan taksit uyarısı, son
  taksit kalanı emer, boş forecast guard'ı); `budgetAlerts` boş kategoriyi
  'Diğer'e katıyor; `CardsPage.expense` banka hesabında provizyonu ve bakiye
  aşımını engelliyor; `DueStatementAutomation` yalnız başarıda damgalıyor;
  `LoansPage` sabit `+03:00` yerine cihaz ofseti; Dashboard `monthMeta` gün
  değişimini yakalıyor.
  **UI/a11y:** ortak `use-dialog-a11y` (odak içeri → Tab hapsi → Escape → odağı
  tetikleyiciye geri ver) confirm-dialog + QuickActions + Layout menüsü + iki
  import modalında; ortak `QueryError` (`role="alert"` + "Tekrar dene")
  Analysis/AnalysisDetail/Planning/PurchaseDecision/AssetsPage'de + skeleton'lı
  erken dönüş (yanlış "Maaş eklenmedi" flash'ı bitti); toast success/info
  `role="status"`+polite; CrudPage satır menüsü tek `RowMenu` + klavye gezinme;
  BarChart/LineChart `role="img"`+özet; ObligationsCalendar gün `aria-label`ları
  ve aynı günde giriş+çıkış birlikte; WishlistPage/PurchaseDecision `parseNumber`;
  LoginPage kayıt ikincil + başarı stili; GoldPage elde olandan fazla satış
  engeli; masaüstü vade tablosunda ödeme aksiyonu; "Planlı" tonu tekilleşti;
  onboarding'de negatif kahraman rakam yerine yönlendirme; `CurrencyInput`
  silinip `MoneyInput` tekil oldu; tek `--overlay` token'ı + dark `--success`
  ayrıştırıldı.
  **Parser/lib:** YapıKredi "ÖDEME" filtresi satır-başı kalıbına daraldı (gerçek
  satıcılar artık düşmüyor) + YK checksum kimliği açıldı; parserFixtures banka
  önekiyle YK fixture'ı kabul ediyor; DenizBank hareketlerinde iade satırı ayrı
  toplanıyor; bonus regex'i binlik ayraçlı tutarı temizliyor; `sectionCategoryFor`
  İ/ı normalizasyonuna bağlandı; `bankBranding` dört kusuru (maximiles, Enpara
  sırası, tam-kelime ptt/ing/teb) testle kilitlendi; `date.daysUntil` ISO-saatli
  girdide NaN üretmiyor; `valuationSync` gerçek `updated`/`failed` bildiriyor;
  `marketRatesClient` timeout + inflight yarışı; `stockQuotesClient` 24 saat
  bayatlık eşiği (bayat fiyat artık persist edilmiyor); `pdfText` destroy;
  `receiptParseClient` LLM kategori/tarih doğrulaması; `supabase.ts` üretimde de
  env hatasını bildiriyor; yakıt özeti odometresiz ara dolumu doğru dağıtıyor;
  TCO ₺/km iki ondalık; zekât yorumları koda hizalandı (davranış aynı).
  **DB (`20260812120000`):** `update_card_expense` banka yolunda bakiye kontrolü
  IADE SONRASI değeri kullanıyor (yanlış red bitti); `reset_card_import_data`'nın
  `20260805120000`'de düşen iki anlamlı ön-koşul mesajı geri geldi; edge
  fonksiyonlarında Gemini anahtarı query-string'den `x-goog-api-key` header'ına
  taşındı ve fiş boyut sınırı/mesajı tutarlı hale getirildi.
  pgTAP: `faz_f_db_fixes.sql` (yanlış red yok + gerçek yetersizlik hâlâ red +
  ön-koşul mesajı). Kapılar: lint + 1140 unit + build + 28/28 SQL.
  **Bilinçli bırakılanlar:** varlık geçmişi N+1 (toplu çekim repo/service
  imzası gerektiriyor), `useStockPrices` gösteriminde bayatlık rozeti yok
  (persist yolu kapatıldı), Şerit `duration-[120ms]` değerleri `--motion-*`
  token'ına bağlanmadı (Tailwind sınıfı CSS değişkeninden süre okuyamıyor),
  `guard_current_settlement_allocation`'ın ölü dalı ve
  `cut_due_card_statements`'ın hata-mesajı bağı (400+ satır fonksiyon
  kopyalamanın davranış-kaybı riski kazançtan büyük).

- ~~**Faz E — test borcu.**~~ DONE (2026-08-12). Denetim raporu §8 pgTAP
  boşlukları kapatıldı — 5 yeni SQL testi (hepsi yerelde yeşil):
  `pay_card_statement_flow.sql` (mutlu yol + B4 `p_skip_source_debit` dalı),
  `pay_card_debt_residual.sql` (B1 residual: allocation'sız satırlar
  settlement'a bağlanır, kova-satır farkı settlement notu + correction history
  kaydıyla denetlenebilir), `payment_flows.sql` (`pay_payment`,
  `pay_loan_installment`+`sync_loan_summary`, `transfer_between_accounts`,
  `record_manual_account_movement`+account_ledger), `ledger_projection_integrity.sql`
  (card_ledger borç+kova delta projeksiyonu = kart değerleri; account_ledger =
  bakiye; `app.ledger_suppress` event üretmez ve geri açılır),
  `cancel_card_expense_reversal.sql` (5b: tersleme = çocuk taksit toplamı;
  devreden planda diğer borç korunur). UNIT: `LineChart.test.tsx` (K17
  null-segment bölünmesi, connectNulls tek path, G2 tüm-null "Veri yok";
  vitest config'e `@` alias'ı eklendi). S4 sistemik düzeltme: ci.yml +
  deploy.yml `supabase/tests/*.sql`'in TAMAMINI döngüyle koşuyor (tek tek adım
  bağlama kuralı kalktı); yerel eşdeğer `npm run db:test:all`
  (`scripts/run-db-tests.mjs`, Windows uyumlu). e2e-only tüketici
  (`buildDashboardMonthlyLoad`) kararı Faz C'de silinerek kapanmıştı.

- ~~**Faz D — tutarlılık ve dil.**~~ DONE (2026-08-12). Denetim raporu §5–§7'nin
  25 maddesi: 17 dil/metin düzeltmesi (ASCII'ye düşmüş Türkçe, kesme işareti,
  ek uyumu kalıplarının yeniden kurulması, "app"→"uygulama", terminoloji
  tekleştirme: "Araçlar", "Banka hesabı", "Geçmiş işlemler", "Ekstreyi öde",
  "Mutabakat", "Alım sonrası kalan"; yüzde/para biçimi `formatPercent`/
  `formatSeritAmount`'a bağlandı) + 8 tutarlılık düzeltmesi: kontrol merkezi
  "açık ekstre" artık kart listesiyle aynı formül (tüm açık arşivlerin toplamı,
  ton da ondan türer), mutabakat eşiği/yaş yardımcısı `reconciliation.ts`'te
  tekleşti, `statementReminder` dueDate sabit `from`a göre hesaplanıyor,
  `paymentUsesCreditCard` kaynak kartın türüne bakıyor (banka hesabına
  talimat = nakit çıkışı), rozet/sayaç kesme uyarıları ("İlk 40 kayıt",
  "ilk 8 gösteriliyor"), aylık rapor dipnotları (projeksiyon-gelir vs
  gerçekleşen-çıkış, provizyon dahil) şeffaflaştı.

- ~~**Faz C — ölü kod temizliği.**~~ DONE (2026-08-12). 11 dosya silindi
  (8 ölü dosya: `CardsPage.installment.tsx`, `InstallmentPlanner.tsx`,
  `debtsRepo.ts`, `paymentsRepo.ts`, `spendingAnomalies.ts`+test,
  `animated-number.tsx`, `separator.tsx`, `dashboardPanelUtils.ts`; +
  `DashboardPanels.tsx` (FocusAction tipi DashboardInsights'a taşındı) ve
  zincirleme tüketicisiz kalan `statementReconcileReview.ts`+test). Sabit
  bayrak ölü dalları kaldırıldı: `StatementImportModal` yalnız clean-import
  (non-clean gövde, A2/B1 blokları, işlevsiz "PDF kapsamı"/satır seçimi UI'ı
  gitti), `CurrentMovementImportModal` yalnız eşleştirme akışı
  (`handleCleanImport` + guard-arşiv bloğu gitti). Zincirleme repo/util
  temizliği: `resetCardImportData`, `insertGuardStatementArchive`,
  `cutCardStatement`, `setStatementReconciliation`, `payLoanInstallment`,
  `matchTransactions`/`checkStatementInstallments`/
  `reusableStatementInstallmentParentId` (+parser eşleştirme türleri/yardımcıları),
  `buildFinancialHealth`, `buildBudgetAlerts`, `buildCalendarEvents` ailesi,
  `buildDashboardMonthlyLoad`, ledger `groupEventsBy*`/`project*By*`,
  `totalScheduledInstallments`, `addKurus`, `estimateConfidence`/
  `worstConfidence`, `reconciliationDriftCount`, `attentionDayKey`,
  `renderCardExtra`, `AppPage`/`PageCommandHeader`, `InputWithIcon`,
  `SkeletonMetricGrid`/`SkeletonTable`, `Sparkline`, `hasRate`/
  `RATE_SYMBOL_LABELS` (+ilgili test bölümleri). `index.css`'ten kullanılmayan
  sınıf/token blokları (~300 satır: finance-surface/glass/hero-panel,
  app-sidebar/header, safe-spend-card, accounts-signature-hub, animate-*/delay-*,
  brand-* paleti, kullanılmayan gölgeler vb.) silindi. Toplam 53 dosyada
  −3.890 / +147 satır (taşıma/yorum/docs dahil). `snapshotToUpsertPayload`
  bilinçli bekletiliyor (Faz 2 server cache).

- ~~**Faz B — güven/UX kritikleri.**~~ DONE (2026-08-12). K1: gizlilik maskesi
  artık metne gömülü tutarları da kapatıyor (`maskAmountsInText` +
  dikkat bandı/odak kartları/ekstre hatırlatıcısı/kategori içgörüleri).
  K2: snapshot sorgusu `retry: 3` — giriş sonrası geçici 401 kendi kendine
  iyileşiyor. K7 (kapsam daraltıldı, ↓ aşağıya bak): asgari ipucu yalnız EKSTRE
  kovası üzerinden ve taban 0 iken gizli (`minimumPaymentBase`). K8: `?section=
  ekstre` kırık linki düzeldi. K9: CSV her zaman tam eşleşme kümesini indiriyor.
  K10: odak paneli "Ay sonuna kalan" kahraman rakamla aynı kaynaktan
  (safeToSpend). K11: Kasa paneli etiketi "Rezerv sonrası" (iki farklı formüle
  aynı "Harcanabilir" adı verilmiyor). K12: hero + Borçlar→Kart Borcu limitte
  `totalCreditLimit` (ortak grup çift sayımı bitti). K17: LineChart null
  noktalarda çizgiyi bölüyor (+tüm-null girdide boş-veri kutusu, G2; BarChart
  tooltip sol kırpma, G3). K18: parse-sms `SMS_OWNER_USER_ID` env'i ile tenant
  daraltması; çok-kullanıcılı son-4 çakışması artık keyfî seçim yerine 409.
  O3: edge hata gövdesi `context.json()` ile gerçekten okunuyor
  (`edgeErrorMessage`). Ayrıca yerel gotcha: `config.toml [auth.email]
  enable_signup=false` güncel GoTrue'da girişleri de kapatıyor → true yapıldı.

- ~~**K7 kalan kapsam — kısmi/asgari EKSTRE ödemesi.**~~ DONE (2026-08-12,
  migration `20260812110000_partial_statement_payments.sql`). Tasarım notta
  önerildiği gibi uygulandı: append-only `card_statement_payments` çocuk tablosu
  (insert yalnız RPC/restore, update/delete guard trigger'la reddedilir), arşiv
  tutarı DEĞİŞMEZ kaldı ve kalan türetildi —
  `kalan = arşiv.statement_debt_amount − Σ ödemeler`; kartın ekstre kovası açık
  arşivlerin kalanları toplamına projekte ediliyor
  (`private.statement_remaining_amount` + TS ikizi
  `src/utils/cardStatementPayments.ts`). `pay_card_statement(p_amount)` kalanın
  altındaki tutarı kısmi ödeme olarak yazıp arşivi açık bırakıyor, kalana eşit
  tutar (ya da `p_amount` verilmemesi) arşivi kapatıyor; K4 çift-ödeme guard'ı
  aynen duruyor. Kalan-bazlı okuyan yüzeyler: kart listesi/hero, kontrol merkezi,
  ekstre paneli ("X ₺ ödendi" satırı), Borçlar→Kart Borcu, obligations
  projeksiyonu (kalanı biten arşiv artık yükümlülük üretmiyor ve `pay_card_debt`
  yolunu kapatmıyor). Çekmecede ekstre tutarı düzenlenebilir + asgari ipucu
  kalan üzerinden. Backup `RESTORE_TABLE_ORDER`'a arşivden sonra eklendi; reset
  kapsamı GUC'lu blokta. pgTAP `partial_statement_payment.sql` (kısmi → kalan
  üstü red → ikinci kısmi → tam kapama → kapalıya red → append-only red).
  **Bilinçli atlanan:** DataHealth'e ödeme tablosu eklenmedi; kovayı her ödemede
  RPC'nin kendisi kalanlar toplamına eşitliyor (tek yazar), mevcut
  `card-orphan-statement-debt` kontrolü de kova>0 ⟹ kalanı olan açık arşiv
  ilişkisiyle geçerli kalıyor.

- ~~**Faz A — para doğruluğu.**~~ DONE (2026-08-12). K3: `post_card_provision`
  regresyonu geri alındı (`20260812090000` — tarih=işlem günü, vadesi geçmiş
  taksitler posted, current=geçmiş taksitler toplamı; context_id korunuyor;
  idempotent onarım bloğu dahil; pgTAP `provision_post_semantics.sql`).
  K4: `pay_card_statement`'a çift-ödeme guard'ı (`20260812091000`; pgTAP
  `statement_double_payment_guard.sql`). K5+O1: GoldPage grafiği
  `buildGoldAccumulation`'a bağlandı, fiyatsız satış artık iki fonksiyonda da
  maliyet havuzunu düşürüyor. K6: mutabakat girişi `parseNumber`'a geçti.
  K13: gelecek-taksit borcu kart başına. K14: guard arşiv Result'ı artık
  uyarı üretiyor. K15: kısmi borç kararı `greaterThanTL`. K16+O3: kasa rezervi
  TanStack Query'de (`KASA_BUCKETS_QUERY_KEY`), hata halinde Dashboard/Alsam-mı
  "rezerv doğrulanamadı" uyarısı gösteriyor, KasaModuPanel mutasyonları
  invalidate ediyor. Ayrıca `supabase/.temp` ESLint ignore'una alındı (yeni CLI
  start-secrets artefaktı lint'i kırıyordu).

## 2026-08-11 — Veri doğruluğu denetimi (Faz D1–D4)

Denetimin sorusu: türetilebilir bilgi DB'de gereksiz/korumasız saklanıyor mu, ve
kararı değiştirecek bir bilgi kullanıcıdan gizleniyor mu? Çekirdek para modeli
(kart borcu, banka bakiyesi, kredi özeti, taksit tutarı) ledger + trigger + TS
ikizi ile zaten temiz çıktı; açıklar sonradan eklenen alanlardaydı.

- ~~**D1 — Mutabakat kaydı düzeltilen farkı siliyordu.**~~ DONE. "Farkı düzelt"
  akışı (`LiveReconciliationPanel`, `CurrentMovementImportModal`) ledger
  düzeltmesini uyguladıktan sonra mutabakat satırına `app_amount = gerçek`,
  `drift = 0` yazıyordu; yani "bankayla arasında X TL fark vardı" gözlemi tam da
  onu tutması gereken tablodan siliniyordu. Sonucu somut: `buildReconciliationItems`
  drift=0 gördüğü için kartı `ok` sayıyor, modülün başlığında hedeflenen sapma
  trendi hiç oluşamıyordu. Artık `drift` DAİMA ham ölçüm (DB'de
  `check (drift = app_amount - real_amount)` ile zorlanır — eski hatalı desen
  veritabanı seviyesinde reddediliyor) ve akıbet ayrı `resolution` kolonunda
  (`matched` | `open` | `corrected`). `cardControlCenter` de aynı mantığa geçti,
  aksi halde düzeltilen kart sonsuza dek "fark var" kalırdı. Yeni
  `buildDriftHistory` "son N mutabakatın M tanesinde fark çıktı" desenini
  panelde gösteriyor. Migration: `20260811140000_reconciliation_preserves_drift.sql`.
  Eski satırlarda düzeltme öncesi `app_amount` hiç yazılmamış olduğu için gerçek
  fark geri getirilemez; `resolution` NULL = "bilinmiyor" kalır ve okuma tarafı
  o satırlarda eski davranışa düşer (uydurma veri üretilmedi). `hasLegacyRows`
  bayrağı bu körlüğü kullanıcıya da bildirir.
  Bilerek EKLENMEYEN kolon: uygulanan düzeltme tutarı — her iki akışta da tam
  `-drift`'e eşit, yani bu maddenin düzelttiği hatanın (türetilebilir değeri
  korumasız saklamak) aynısı olurdu.
- ~~**D2 — Karma birikim hedefinde ana satır türetilmiş ama korumasızdı.**~~ DONE.
  `savings_goals.target_amount` = bileşen sayısı, `current_amount` = hedefine
  ulaşan bileşen sayısı; `upsert_savings_goal` client'ın gönderdiğini sorgusuz
  yazıyordu. Artık composite'te `p_target_amount`/`p_current_amount` YOK SAYILIR
  ve sayaçlar `p_components`'tan hesaplanır ("ulaştı" tanımı TS ikizi
  `savingsGoalTargetReached` ile aynı: hedef > 0 ve eksik ≤ 1 kuruş). Client'taki
  ikinci hesap `SavingsGoalsPanel`'den kaldırıldı — ayrışmanın yolu oydu.
  Migration halihazırda ayrışmış hedefleri bileşenlerinden onarır (mutabakat
  farkının aksine bu veri kayıp değil, türetilebilir olduğu için onarım tam).
  Bileşeni kalmamış karma hedefin sayacı da sıfırlanır.
  Ayrıca bu sayaç iki yerde TL sanılıyordu ve ikisi de düzeltildi:
  `analysisView.ts` arama/CSV listesinde `formatAmount()` ile "₺2,00" basıyordu →
  artık `amount: null`, sayaç alt satırda ("Aktif · 2/3 bileşen"); ve
  `financeSummary.buildGoalProgressSummary` bileşen sayısından TL "aylık gerekli"
  üretiyordu → `savingsSuggestion.ts`'teki guard'ın aynısı eklendi.
  Migration: `20260811150000_composite_goal_totals_from_components.sql`,
  regresyon: `supabase/tests/composite_goal_totals.sql`
  (`npm run db:test:composite-goal`; eski fonksiyonla negatif kontrol yapıldı —
  client değeri 99 sızıyor, test kırmızı).
  ~~Not: `buildGoalProgressSummary` tüketicisiz kalmıştı.~~ DONE (D5) —
  fonksiyon, `GoalProgressSummary` tipi ve testleri silindi. Ürettiği her alanın
  canlı bir karşılığı zaten vardı (`savingsGoalProgressRate`,
  `buildSavingsSuggestion`) ve asıl gerekçe ölü kod değil: aynı hesabın iki
  implementasyonu olması D2'deki hatanın SEBEBİYDİ — biri karma hedef guard'ını
  taşıyordu, diğeri taşımıyordu. Düzeltilmiş kopyayı tüketicisiz tutmak aynı
  tuzağı canlı bırakırdı. `financeSummary.ts`'te yerinde bir açıklama notu var.
  `FinanceSummaryInput.savingsGoals*` alanları duruyor ama artık bu modülde
  okunmuyor — çağıranlar aynı nesneyi başka util'lere geçirdiği için opsiyonel
  kaldı, tipte bu da belgelendi.
- ~~**D3 — Otomatik değerlemede tazelik bilgisi saklanmıyordu.**~~ DONE.
  `assets`/`debts`/`savings_goals` üzerinde `estimated_value_try` + `auto_valued`
  vardı ama `valued_at` ve kullanılan kur yoktu (`updated_at` bu işi göremez —
  not değişince de ilerler). `effectiveAssetValue` canlı kur gelmediğinde
  sessizce saklı değere düşüyordu; kullanıcı bayat rakamı canlı sanıyordu.
  Artık üç tabloda `valued_at` + `valuation_rate` var ve `persistEstimatedValues`
  ikisini de yazıyor. `valuation_rate` NEDEN türetilebilir sayılmadı:
  kabaca `estimated_value_try / amount`'a eşit ama `amount` sonradan
  değiştirilebiliyor ve miktarın geçmişi tutulmuyor — miktar değişir değişmez
  oran geri hesaplanamaz. `net_worth_snapshots`'ın `gold_try`/`usd_try`'yi
  saklamasıyla aynı gerekçe.
  Görünür taraf: yeni `ValueSource` (`live`/`stored`/`manual`) ve
  `valuationConfidence` ile Varlıklar sayfasında rozet, Borçlar'da
  "Canlı kurla otomatik" yerine "Kur alınamadı · N gün önceki kur", birikim
  hedefinde "Güncel" etiketi yalnız gerçekten canlıyken. Bulgu 6: `RatesBanner`
  yalnız Varlıklar/Borçlar/Altın'daydı; Dashboard'daki "Net değer" paneline kur
  yaşı uyarısı eklendi (net değerin içinde altın/döviz var, kur bayatsa rakam da
  bayat). Migration: `20260811160000_valuation_freshness.sql`.
- ~~**D4 — "Harcanabilir" sayısı ekrandan ekrana farklıydı.**~~ DONE. Dashboard
  (`useSafeToSpend`) kasa kovalarındaki rezervi düşüyordu; `PurchaseDecisionPage`
  ve `PlanningPage` `buildSafeToSpend`'i `reserved` olmadan çağırıyordu. Yani
  "bunu alsam ne olur?" ekranı — kararın fiilen verildiği yer — harcanabilir
  tutarı ayrılmış rezerv kadar FAZLA gösteriyordu (PlanningPage'in yorumu
  "Dashboard kahraman rakamıyla aynı hesap" diyordu ama değildi). Rezerv
  `useSafeToSpend`'in içinden `useKasaReserved` hook'una çıkarıldı ve üç ekran
  da onu kullanıyor.
  Bu sınıf hata (saf fonksiyon doğru, çağrı yeri eksik girdiyle çağırıyor)
  birim testiyle yakalanamaz — fonksiyon her iki çağrıda da "doğru" çalışır.
  `src/utils/safeToSpend.guard.test.ts` kaynak metnini tarayıp her
  `buildSafeToSpend` çağrısının `reserved` geçtiğini zorluyor
  (`docs.guard`/`encoding.guard` ile aynı desen; negatif kontrol yapıldı —
  `reserved` kaldırılınca guard kırmızıya dönüyor). Guard ayrıca glob'un
  gerçekten çağrı bulduğunu doğruluyor ki yalancı yeşil olmasın.
  Ayrıca `clampCardBreakdown`'ın yanıltıcı yorumu düzeltildi: "current absorbs
  the remainder" diyordu ama hiçbir kova şişirilmiyor, üçü de yalnız kırpılıyor.

## 2026-08-11 — Ödeme alarmı sadeleştirmesi + bağlam etiketleme kapsamı

- ~~**S1 — Dashboard "Ödeme alarmı" paneli kaldırıldı.**~~ DONE. Detay
  katmanındaki `UpcomingAlertPanel` şerit dilindeki `SeritOverview` yaklaşan
  vade listesinin dublikatıydı; abonelik/faturalar SMS otomasyonuyla ödendiği
  için ikinci bir uyarı yüzeyi gereksizdi. Ayıraç "Vadeler ve mutabakat" →
  "Mutabakat". Yerinde ödeme çekmecesi KALDI (şerit listesi kullanıyor);
  `buildFocusActions`'taki "N vade 3 gün içinde" aksiyonu da kaldı, yalnız
  metnindeki kaldırılmış panele atıf takvime çevrildi. `/odemeler`, takvim ve
  nakit akışı projeksiyonu dokunulmadan duruyor.
- ~~**S2 — Bağlam etiketleme listesi provizyonları kapsıyor.**~~ DONE. Liste
  `fetchRecentCardExpenses(40)` (yalnız `posted`, `created_at` sırası) yerine
  yeni `fetchTaggableCardExpenses(100)` (`posted` + `provision`, `spent_at`
  sırası) kullanıyor; provizyonlar rozetle işaretli. SMS'ten yeni düşen
  harcamalar kesinleşene kadar listede olmadığı için bağlam atanamıyordu.
  `fetchRecentCardExpenses`'in "yalnız kesinleşmiş" anlamı değişmedi (tekrarla
  çipleri, araç giderleri ve son hareketler paneli ona bağlı).
- ~~**S3 — Kısmi provizyon kesinleşmesi bağlamı kaybediyordu.**~~ DONE.
  `post_card_provision` kısmi yolda kesinleşen tutar için YENİ satır açıyor ve
  `context_id`'yi kopyalamıyordu → etiketlenmiş provizyonun kesinleşen kısmı
  bağlam özetlerinde hiç görünmüyordu (tam kesinleşme yolunda aynı satır
  güncellendiği için sorun yoktu). `20260811100000_partial_provision_keeps_context.sql`
  + regresyon: `supabase/tests/partial_provision_context.sql`
  (`npm run db:test:provision-context`). Eski fonksiyonla negatif kontrol
  yapıldı: test kırmızı, yeni fonksiyonla yeşil.
- ~~**S4 — Son DB regresyon testleri CI'da koşmuyor.**~~ DONE (2026-08-12,
  Faz E kapsamında sistemik çözüm): `ci.yml` ve `deploy.yml` artık tek tek adım
  yerine `supabase/tests/*.sql`'in tamamını döngüyle koşuyor; yeni test dosyası
  otomatik kapsanır. Yerel eşdeğer: `npm run db:test:all`.

## 2026-08-10 — Şerit görsel dili: temel + Özet pilotu

Masaüstündeki `design_handoff_denge_redesign/` handoff'unun uygulanması.
Tasarımın fikri: **kart yığılmasını bitir**, sayıyı ekranın birincil nesnesi yap,
rengi yalnız sinyal olarak kullan. Bilgi mimarisi ve iş kuralları değişmiyor.
Handoff'un iki varsayımı eskiydi ve düzeltildi: repo React 19 + Tailwind v4
(config dosyası yok, tokenlar `index.css`) ve koyu tema burada birinci sınıf.

- ~~**Ş0 — Token katmanı, iki tema.**~~ DONE. `--page`/`--raised`/`--ink*`/
  `--line*`/`--track`/`--chart-idle`/`--accent-soft`/`--neutral-bar` ve
  `--signal-*` hem `:root` hem `:root.dark` için tanımlandı; koyu karşılıklar
  prototipin `1c` seçeneğinden okundu. Sinyal renkleri mevcut
  `--destructive/--warning/--info`'dan KASITLI olarak ayrı tutuldu ki
  dönüştürülmemiş ekranlar bu commit'te kaymasın. `.serit-num` (mono +
  tabular) ve `.serit-eyebrow` (Türkçe Ş/Ç/Ğ için sabit line-height) eklendi.
- ~~**Ş1 — Ortak parçalar.**~~ DONE. `src/components/serit/*`: `ScreenHeader`,
  `SectionEyebrow`, `HeroNumber`, `LineGroup`/`LineRow`/`DayBadge`,
  `BreakdownBar`. Kart bileşeni bilinçli olarak YOK. Para biçimi
  `formatSeritParts` (sembol sonda, ondalıksız, negatifte U+2212).
- ~~**Ş2 — Özet ekranı pilotu (`2a` mobil + `4e` masaüstü).**~~ DONE.
  Kahraman rakam = "ay sonuna kalan"; tek yeni türev ay şeridi
  (`utils/dashboardMonthStrip.ts`, +test). `SafeToSpendCard` kaldırıldı, hesabı
  `hooks/useSafeToSpend.ts`'e taşındı (PlanningPage de artık oradan okuyor);
  tampon düzenleme `SeritBufferRow` olarak çizgi biçiminde geri geldi.

- ~~**Ş3 — Uygulama kabuğu (`4e`).**~~ DONE. 216px rail (raised zemin, 1px
  ayıraç, gölge yok); kırılımlar <768 alt bar · 768-1024 ikon-only rail ·
  ≥1024 tam rail. Alt bar yüzen hap olmaktan çıkıp dibe oturdu ve FAB için
  **76px'lik opak ayrılmış bant** taşıyor — FAB artık hiçbir kaydırma
  konumunda içeriğin üstüne binmiyor (ölçüldü: bandın en üstteki elemanı barın
  kendisi). `QuickActions` panel/tetikleyici olarak ayrıldı.
- ~~**Ş4 — Kalan sekiz ekran.**~~ DONE. Hesaplar `4a` (CardsPage.overview),
  Kart Borcu `3a` (LiabilitiesCardsPage), Ödeme Takvimi `3b` (PaymentsPage),
  Krediler `4b` (LoansPage + .components), Varlıklar `4c` (AssetsPage),
  Hedefler `4d` (PlanningPage + BudgetProgress), Analiz `3c`
  (AnalysisPage.hero), Veri Kontrolü `3d` (DataHealthPage). `HubNav` hap
  yerine 2px jade alt çizgili sekme şeridi oldu (5 hub'ı birden etkiler).
  `CrudPage`'in kendi sayfa başlığı kaldırıldı — başlık artık yalnız kabukta;
  kahraman rakam en üstte, arama+ekle çubuğu onun altında.
- ~~**Ş5 — Para biçimi tekilleştirildi.**~~ DONE. `formatPrivateCurrency`
  (yani `useBalancePrivacy().formatAmount`) `formatSeritAmount`'a geçti:
  sembol sonda, kuruş korunuyor. Aynı blokta "196.680 ₺" ile "₺196.680,00"
  yan yana düşmesi bitti. `formatCurrency` dışa aktarım/PDF/rapor yollarında
  duruyor (orada sembolün önde olması beklenen çıktı).

**Renk kuralı sapması (bilinçli):** Şerit "renk yalnızca sinyal" der; bu kural
DURUM için uygulandı. Kompozisyon dilimleri (varlık sınıfı, gider kategorisi)
repo'nun CVD-doğrulanmış `vizPalette` kimlik renklerini kullanmaya devam ediyor —
`BreakdownSegment.color` bunun için var. Dört sinyal rengiyle sekiz varlık
sınıfını ayırt etmek mümkün değildi.

- ~~**Ş6 — Handoff'un tarif etmediği 9 alt rota + uzun kuyruk.**~~ DONE.
  `/varliklar/maas` (kahraman + 6 kayıtlık trend), `/varliklar/altin` (güncel
  değer + kâr/zarar Delta), `/varliklar/araclar`, `/borclar/kisiler` (net
  denge + borç/alacak kırılımı), `/odemeler/alsam-mi`, `/odemeler/liste`
  (bekleyen istek toplamı), `/odemeler/baglamlar`, `/analiz/detay`,
  `/veri-sagligi/islemler`. Dört sayfadaki **başlık tekrarı** giderildi:
  `PageCommandHeader` bu sayfalardan kaldırıldı (kabuk zaten başlığı taşıyor).
- ~~**Ş7 — Kart bileşeni Şerit'e indirildi.**~~ DONE. `components/ui/card.tsx`
  gölge/parlaklık yerine 1px `line-strong` + `raised` zemine geçti; 40+
  çağıranı olan `variant` API'si korundu. Bu, dosya dosya dolaşmadan kalan
  tüm yüzeyleri (araçlar, bağlamlar, modal/çekmece içleri, detay panelleri)
  aynı dile getirdi.
- ~~**Ş8 — Gölge süpürmesi.**~~ DONE. 41 dosyadan 87, ikinci turda 13 dosyadan
  18 gölge yardımcısı ve `index.css`'ten 9 `box-shadow` kaldırıldı. Kalan
  tek gölge FAB'ın (tasarımın açık istisnası) ve login ekranının (Şerit kapsamı
  dışında). Ekrandaki `ring-1` kullanımları teknik olarak box-shadow üretiyor
  ama 1px çizgi anlamına geliyor — kasıtlı bırakıldı, layout'u da bozmuyorlar.
- ~~**Ş9 — Token setleri birleştirildi.**~~ DONE. `--destructive/--warning/
  --info/--primary` Şerit değerlerine çekildi (hepsi eskisinden daha koyu →
  kontrast arttı), `--signal-*` artık onlara alias. `--page`/`--raised`
  `--background`/`--card`'a bağlandı: tek kaynak. Tek ayrık değer
  `--signal-warning` (açık temada çubuk dolgusu #c68a1f, metin AA için
  `--warning`).
- ~~**Ş10 — Özet detay katmanı budandı.**~~ DONE. Net değer (artık Analiz'in
  kahraman rakamı) ve borç/limit metrik kutuları (kendi ekranlarında)
  kaldırıldı. Odak aksiyonları, ekstre hatırlatıcısı, mutabakat ve işlem
  geçmişi kaldı — bunların tasarımda karşılığı yok ve silmek işlev kaybı olurdu.
  `DataHealthBadge` ve `buildFinancialHealth` kullanımı ölü kaldığı için düştü.

- ~~**Ş11 — Para biçimi cümle üreten util'lere kadar indi.**~~ DONE.
  `dashboardInsights`, `attention`, `statementReminder`, `dashboardUpcoming`,
  `savingsGoal`, `analysisView` artık `formatSeritAmount(x, { decimals: 2 })`
  kullanıyor — sembol sonda, kuruş korunuyor. 10 rota tarandı: uygulamada
  eski biçim (₺ önde) SIFIR. `formatCurrency` yalnız `financialReport` (PDF/
  dışa aktarım) ve `marketRates` (kur etiketi) yollarında kaldı.

- ~~**Ş12 — Kapanış denetimi.**~~ DONE. Kontrast iki temada ölçüldü; açık
  temada `--ink-faint` #7c8880 → 3.43:1 çıktı (11px uppercase eyebrow için AA
  altı) ve `--ink-ghost` 3.07:1 idi. Hue korunarak koyulaştırıldı (#667069 /
  #6b756e): hepsi artık ≥4.5. **Tasarımdan bilinçli sapma** — handoff bu iki
  değeri veriyordu, gerekçe `index.css`'te yazılı.
  768–1024 kırılımı doğrulandı (rail 56px ikon-only, etiketler gizli, alt bar
  yok). Odak halkası global `:focus-visible` ile 2px jade + 2px offset; `--ring`
  iki temada da jade. `PageCommandHeader` kullanımı sıfır. Login ekranındaki
  demo tutarları da sembol-sonda biçime alındı.
- ~~**Ş13 — Bayat e2e testi onarıldı.**~~ DONE. `money-mutation.spec.ts`
  varsayılan atlandığı için (`E2E_LIVE_SUPABASE=1` kapısı) sessizce çürümüştü
  ve üç ayrı yerde bozuktu: aradığı "Güncel borç" etiketi arayüzde yok
  (`main`'de de yok — yani Şerit'ten önce de kırıktı), "Detay"ı doğrudan buton
  sanıyordu (kartın taşma menüsünde) ve tutar beklentisi eski para
  biçimindeydi. Üçü düzeltildi; yerel Supabase'e karşı canlı koşuldu, geçiyor.
- ~~**Ş14 — Kontrol sayısı üretiliyor.**~~ DONE. `buildHealthCounts` artık
  `checksRun` ve `cleanChecks` döndürüyor (kart 3, planlı kredi 2, taksitli
  harcama 1, limit grubu 1 kontrol; koşmayan kontrol sayaca girmez).
  Veri Kontrolü ekranı için `buildAreaCoverage` eklendi: bulguları alan
  düzeyinde sayar ("6/8 alan temiz"). Granülerlik ALAN düzeyinde kaldı —
  check aileleri içindeki koşulları tek tek saymak veri bütünlüğü katmanının
  tamamını elden geçirmeyi gerektirirdi, regresyon riski kazanca değmez.
  Özet'in satırı kasıtlı olarak daha çekingen ("hızlı kontrollerde sapma yok"):
  o satır hafif ikizi okur, kesin cevabı Veri Kontrolü ekranı verir.
- ~~**Ş15 — `/kartlar` alt sekmelerine kahraman rakam.**~~ DONE.
  `CardsPage.hero.tsx`: Kartlar → toplam borç + limit kullanımı çubuğu,
  İşlemler → dönem içi harcama (+ provizyon notu), Ekstreler → ödenecek
  ekstre + en yakın son ödeme. Özet sekmesinde rakam zaten `AccountHubPanel`
  içinde olduğu için orada çizilmiyor.

**AÇIK:** Şerit tarafında kalan yapısal iş yok. Sonraki turda bakılabilecekler:
- `finance-page-command` / `PageHero` gibi artık kullanılmayan FinanceUI
  parçaları silinebilir (ölü ama zararsız).
- `--surface-elevated`, `--shadow-*` tokenları artık kullanılmıyor; token
  bloğu sadeleştirilebilir.
## 2026-08-10 — Banka modeli Faz 8: kısmi borç + vade çakışması

Faz 7'de ertelenen kalemlerin devamı. Hâlâ AÇIK (bilinçli, düşük değer/yüksek
altyapı): (2b) ay-sonu carryover anchor gün kaybı — çevrim başına kendini
düzeltiyor, düzeltmesi ağır overload zincirine (7/8-arg carryover +
replace_card_statement_import preserved-parent) dokunuyor, risk/değer düşük;
gece penceresi (UTC/TR) ve Şubat+statement_day=31 için pgTAP kenar testleri
(saat enjeksiyonu altyapısı gerekir — mevcut testler current_date bazlı);
(1f) K3 ay-atlama dönem anahtarı kenarı — düşük frekans.

- ~~**BM8 D-1 — Kısmi kişisel borç/alacak ödemesi.**~~ DONE.
  `settle_personal_debt` opsiyonel `p_amount` aldı (migration `20260810190000`):
  null/tam değer → kapatır (eski davranış); daha azı → estimated_value_try ve
  amount'u oransal düşürür, kaydı açık bırakır, nakiti yalnız ödenen kadar
  oynatır (auto_valued kayıtta miktar da oransal → sonraki değerleme senkronu
  tutarlı). Çekmece tutarı settle/collect'te düzenlenebilir + borç değeri tavan
  validasyonu; DebtsPage detayı toplam değer + kısmi açıklaması. Regresyon:
  `partial_debt_and_due_collision.sql`.
- ~~**BM8 2d — cut_card_statement due_date çakışma ötelemesi.**~~ DONE. Aynı
  migration: `due_day <= statement_day` iken arşiv vadesi bir sonraki aya taşınır
  (TS ikizi `getCardStatementPeriod` ile hizalı; eskiden DB'de arşiv
  `due_date = statement_date` çakışıp UI projeksiyonundan ıraksıyordu). PDF
  importu `p_due_date` verdiğinde o yine otoritedir. Regresyon aynı dosyada.

- ~~**BM7 C-1/C-2 — Varlık satışı oransal değer.**~~ DONE. Miktar taşıyan
  satışta değer satılan miktarla oransal düşer (tam satış sıfırlar → hayalet
  değer yok); nakit bedel oransal değeri aşabilir (gerçekleşen kâr artık
  engellenmiyor). Miktarsız TRY-nakit satışta kayıtlı değer üst sınırı korunur.
  Migration `20260810180000` + UI kilidi miktarsıza daraltıldı + gerçek Postgres
  regresyonu (`asset_trade_proportional_value.sql`).
- ~~**BM7 A-2 — Kredi plan düzenlemeleri kayıtta hortlamıyor.**~~ DONE. `afterSave`
  planı yalnız HİÇ yoksa jenerik şablondan kurar; plan bir kez oluştuktan sonra
  kullanıcıya aittir (satır düzenleme/silme + "Ödendi say" korunur). Toplu
  yenileme boş plandaki "Plan oluştur" ile yapılır.
- ~~**BM7 A-3 — Ölü unpay_loan_installment drop edildi.**~~ DONE. UI çağırmıyor,
  iade yapmadığı için elle çağrılsa banka bakiyesi ile kredi özetini ayrıştırırdı
  (BM-4'teki kart muadili deseninin kredi karşılığı). Migration `20260810180000`
  + types temizliği.

## 2026-08-10 — Banka modeli Faz 6: iptal yaşam döngüsü

Uyuyan-akış denetiminin iptal (İptal-B2/B4/B6) bulgularının UX + canlandırma
dilimi.

- ~~**BM6 — İptal keşfedilebilir + geri alınabilir.**~~ DONE. (İptal-B6) Yeni
  `RecentCardExpensesPanel` (`/kartlar?section=islemler`) son 20 kesinleşmiş
  hareketi listeler ve tek yerden append-only iptal sunar; ekstreye kesilmiş /
  erken-ödemeyle kapatılmış satırlar kilitli (RPC de reddeder). (İptal-B2)
  Migration `20260810170000`: iptal edilen kayıt `source_event_id`'yi rezerve
  etmez — unique index + `add_card_expense`/`record_card_installment_carryover`/
  `pay_payment_from_card_import` lookup'ları `status <> 'cancelled'` süzer; aynı
  satırı yeniden import taze kayıt = iptali geri almanın kanonik yolu. Retry
  güvenliği (advisory lock + aktif satır index'i) korunur; `record_sms_card_expense`
  bilerek dışarıda. (İptal-B4) Planlı ödemeden doğan kaydın iptalinde çekmece,
  planın "ödendi" kalacağını açıkça uyarır. Regresyon: `card_expense_idempotency`
  canlandırma senaryosu.

- ~~**BM5-a — Kart talimatlı ödeme bilgilendirme moduna indi (kullanıcı
  kararı).**~~ DONE. Denetim B-1: tahmini tutarı proaktif karta yazan iki
  kaynak (istemci hook'u vade günü + `post_due_card_auto_payments` ertesi gün)
  SMS ile tutar sapmasında çift harcama üretebiliyordu. Artık talimat yalnız
  bilgidir: `useAutoPayments`/`AutoPaymentConfirmation`/`utils/autoPayment`
  kaldırıldı, RPC drop edildi (migration `20260810160000`), bakım zinciri iki
  RPC'ye indi. Gerçek kayıt SMS'ten (plan ilerletme eşleşmesi KORUNDU) veya
  ekstre importundan gelir; PaymentsPage kart talimatlı satırda bunu söyler ve
  manuel "Öde" artık talimatlılarda da açıktır (kayıt kartındaki buton
  2026-08-16'da kaldırıldı — bkz. üstteki bölüm; aksiyon takvimde durur).
  Regresyonlar yeni modele
  güncellendi (`maintenance_catchup.sql`, `sms_card_payment_reconciliation.sql`).
- ~~**BM5-b — Devreden plan iptali borcu fazla düşürmüyor.**~~ DONE. Denetim
  İptal-B1: carryover parent'ı tam plan tutarını taşır ama borca yalnız kalan
  eklenir; `cancel_card_expense` amount kadar düşünce fark kayboluyordu. Yeni
  kural (aynı migration): posted çok taksitli planda borç terslemesi = child
  satır toplamı (planın gerçek katkısı); `add_card_expense` planlarında çocuk
  toplamı = amount olduğundan davranış değişmez, çocuksuz legacy fallback
  amount kalır. History kaydı da gerçek tersleme tutarını yazar.
- ~~**BM5-c — Devam eden kredi girilebilir: "Ödendi say" (nakit hareketsiz).**~~
  DONE. Denetim A-1: geçmiş taksitleri kapatmanın tek yolu bugünkü banka
  bakiyesinden gerçek para düşürmekti. Plan panelinde artık geçmiş vadeli
  bekleyenler için toplu "Geçmişi ödendi say (N)" + satır menüsünde "Ödendi
  say" var: banka bakiyesine dokunmadan durum işaretlenir (paid_at = vade,
  not: "Uygulama öncesi ödendi"), `sync_loan_summary` özeti otomatik kurar,
  merge ödendi satırları zaten korur. Saf yardımcılar
  (`pastDuePendingInstallments`, `markPaidWithoutCashPayload`) test edildi.

## 2026-08-10 — Banka modeli Faz 4: sertleştirme

Üç-akış denetiminin son planlı fazı.

- ~~**T9 — Ölü taksit ödeme RPC'leri drop edildi.**~~ DONE.
  `pay_card_installment(uuid,uuid)` + `unpay_card_installment(uuid)` eski
  modelin (taksit başına borç düşme) kalıntısıydı; UI çağırmıyor ama grant'leri
  açıktı ve çağrılsalar borcu ikinci kez düşürürlerdi. Migration
  `20260810150000` + types temizliği.
- ~~**O2 — YapıKredi plan toplamı tutarlılık kontrolüne bağlandı.**~~ DONE.
  Alt satırdaki gerçek toplam ("146.999,00 TL'lik işlemin 4/9 taksidi") artık
  çöpe atılmıyor: `kalan = toplam − aylık × sıra` çevirisiyle DenizBank'ın
  `checkInstallmentNotation` kontrolünden geçer; eşit bölünmeyen plan veya
  yanlış okunan adet needs-review'a düşer.
- **T1 — `card_installments` yazımını RPC-only yapmak: ERTELENDİ.** Sebep:
  `update_card_expense` ve `cut_card_statement` invoker-rights çalışır ve
  taksit satırlarına authenticated tablo grant'leriyle yazar; grant'i kaldırmak
  önce bu RPC'lerin security definer'a taşınmasını gerektirir (ayrı, dikkatli
  bir güvenlik geçişi). Bugünkü koruma: arşivli/settled satırlar trigger
  guard'lı; açık satır drift'ini Data Health non-fixable olarak raporlar.
- **D2 — İstemcideki ölü ekstre eşleştirme kodu (matchTransactions,
  checkStatementInstallments, reusableStatementInstallmentParentId ve
  StatementImportModal'ın cleanImport=true ile erişilmez kalan yolları):
  AÇIK.** K1 sunucu tarafı yeniden kullanım gelince kalıcı olarak gereksizleşti;
  ayrı bir temizlik dilimi olarak silinebilir (davranış değişikliği yok).

## 2026-08-10 — Banka modeli Faz 3: ödeme banka modeline indi

Üç-akış denetiminin üçüncü fazı.

- ~~**B1 — Tam güncel ödemenin kuruş-eşitlik kilidi kalktı.**~~ DONE.
  `pay_card_debt` tam güncel ödemede tüm allocation'sız satırları ödemenin
  settlement'ına bağlar; kova-satır farkı (satırsız kova oynatan meşru yollar:
  import kilidi, iade düzeltmesi, otomatik ödeme tutar düzeltmesi, kısmi
  aggregate ödeme) auditable residual olarak settlement notu + correction
  history kaydına yazılır. "Güncel borcun hareket dağılımı uyuşmuyor" hatası
  bitti; tutarlılık her tam ödemede kendini onarır. historical_repair yolu
  (daha iyi provenance) önce denenmeye devam eder. Regresyon:
  `legacy_current_payment_allocation.sql` residual senaryosunu assert eder.
- ~~**B4 — SMS ile düşen bakiye ödemede ikinci kez düşmez.**~~ DONE.
  `pay_card_debt`/`pay_card_statement` `p_skip_source_debit` alır; ödeme
  çekmecesi seçili hesapta son 3 günde aynı tutarlı SMS kaynaklı çıkış bulursa
  varsayılan işaretli "tekrar düşme" kutusu gösterir. RPC kaynak hesabı
  doğrular ama borçlandırmaz; ödeme kaydı/settlement/arşiv kapanışı aynen
  işler, history notu durumu söyler.

## 2026-08-10 — Banka modeli Faz 2: taksit kimliği ve ödenmişlik

Üç-akış denetiminin ikinci fazı.

- ~~**K1 — Süregiden taksit planı importta yeniden kullanılır.**~~ DONE.
  `replace_card_statement_import` carryover'da parent id gelmezse aynı kart +
  aynı taksit adedi + birebir açıklama + ödenmiş/settled geçmişli TEK korunan
  parent'ı sunucuda bulur ve açık planı ona kurar; her aylık importta yeni
  parent açılması (harcama/kategori/geçmiş mükerrerliği) bitti. Belirsizlik
  yeni parent'a düşer; tutar drift'i bilinçli olarak eşleşme kriteri değildir
  (SI-07 notu ile korunur). Regresyon: Senaryo D artık yeniden kullanımı assert eder.
- ~~**F1/T3 — Taksit ödenmişliği kanıttan türetilir.**~~ DONE. `isInstallmentSettled`
  (utils/cardInstallmentCalendar.ts): satır `paid` VEYA current-settlement bağlı
  VEYA arşivi `paid`. Repo taksitle birlikte arşiv durumunu embed eder;
  taksit paneli sayaç/tamamlananlar/etiketleri bununla türetir — "X/9 ödendi"
  bankadaki gibi ekstre ödemesiyle ilerler. SI-10 kararı korunur (ekstre
  ödemesi satıra yazmaz).
- ~~**T4/T5 — Taksit giriş formu sözleşmesi netleşti.**~~ DONE. Devir formu
  etiketi "Aylık taksit tutarı" + "toplam değil" uyarısı; hızlı harcama
  taksit modunda etiket "Toplam tutar". İki formda da sıradaki vade bugünden
  ileri değilse "bugün dönem borcuna işlenir" uyarısı çıkar (erken posting
  sürprizi bitti). Sözleşmeler bilinçli farklı kaldı: devir formu banka
  ekstresindeki aylık tutarla, yeni harcama formu fişteki toplamla düşünülür.

## 2026-08-10 — Banka modeli Faz 1: kanama durdurucular

2026-08-10 üç-akış denetiminin (ekstre import / taksit modeli / borç ödeme; 3
yapısal kök neden) ilk fazı.

- ~~**B3 — Borçlar sayfası açık-ekstre koruması.**~~ DONE. `LiabilitiesCardsPage`
  açık arşivleri yükler; açık ekstresi olan kartta buton `pay_card_statement`
  akışına döner (Hesaplar'daki desenle aynı drawer), `pay_card_debt` yalnız
  arşivsiz kartta kalır. Çift düşme yolu kapandı.
- ~~**K2 — Ödenmiş dönem PDF'inin yeniden importu reddedilir.**~~ DONE.
  `replace_card_statement_import` başında ödenmiş (veya PDF tarihinden yeni)
  arşiv varsa açık hata verir; re-import borcu ikiye katlayıp korunan planların
  açık taksitlerini silemez. Regresyon: Senaryo F.
- ~~**K3 — Banka belgesi tarih otoritesi.**~~ DONE. `cut_card_statement`
  opsiyonel `p_statement_date`/`p_due_date` alır: kart takviminden ±7 gün içinde
  PDF tarihi kesim sınırı ve arşiv tarihleri olur (hafta sonu/tatil kaydırması
  importu kilitlemez); dönem üyeliği import kapsamıyla birebir hizalanır.
  Tarihsiz çağrılar (bakım/client) aynen davranır. Regresyon: Senaryo G; E ise
  toleransın dışına (9 gün) taşınarak atomik rollback amacını korur.
- ~~**T2 — Taksit sayacı yeni carryover notunu tanır.**~~ DONE.
  `CardInstallmentExpensesPanel` regex'i iki formatı da okur; `update_card_expense`
  da (T2b) yeni notu tanır — tanımasa düzenleme geçmiş taksitleri sıfır sayıp
  planı 1..M yeniden kurar ve borcu şişirirdi.
- ~~**B7 — Takvim kart borcu kaleminde ödenebilir tavan.**~~ DONE.
  `FinanceObligation.maxPayableAmount` (= `cardPayableDebt`) çekmece üst sınırı
  oldu; nominal tutar ekstre borcu kalır (nakit projeksiyonu değişmez). Drawer'da
  "Ekstre (X)" + "Tamamı (Y)" hızlı butonları tavanla uyumlu.

## 2026-08-09 — Banka kart yükü mutabakatı

- ~~**Veri Sağlığı kilidinin ödenmiş ekstre artıklarını güvenle onarması.**~~ DONE.
  Bankadaki gelecek taksitler dahil toplam kalan yük kaynak gerçek olarak alınır;
  dönem/ekstre/provizyon kovaları değiştirilmeden yalnız toplam borç düzeltilir.
  Ödenmiş bir ekstreye bağlanmamış eski hareketler ancak bağlı toplamla birlikte
  arşiv tutarına kuruşu kuruşuna eşleşirse arşive alınır. Böylece gerçek dönem
  ödemesi eski taksitleri yeniden saymadan çalışır; belirsiz eşleşme reddedilir.
- ~~**Eski aggregate dönem ödemesinin eksik child allocation'ını onar.**~~ DONE.
  Tam dönem ödemesinde allocation'sız posted toplamın fazlası, yalnız aktif hesap
  kesim döneminden önceki hareketlerden oluşuyor ve tutar tam eşleşiyorsa eski
  satırlar `historical_repair` settlement'ına bağlanır. Bu onarım yeniden banka
  hesabı düşmez; güncel ödeme normal kaynaktan ayrı kaydedilir. Belirsiz farkın
  tamamı transaction içinde rollback olur.

## 2026-08-09 — SMS faturası ve abonelik tekilleştirme

- ~~**Kredi kartı otomatik ödemesi ile banka SMS'ini tek harekette birleştir.**~~
  DONE. `record_sms_card_expense` tek kart/yakın tarih/toleranslı tutarda yalnız
  bir plan adayı varsa SMS harcamasını o ödeme ile atomik eşler ve aylık planı
  ilerletir. Otomatik görev vade gününde bekler, SMS gelmezse ertesi gün fallback
  olarak postalar; geç gelen SMS mevcut otomatik harcamaya bağlanıp borcu ikinci
  kez artırmaz. Belirsiz birden fazla aday otomatik birleştirilmez.
- ~~**PDF açık-plan kayıtlarını Veri Sağlığı'nda eksik geçmiş taksit sayma.**~~
  DONE. Yeni `N/M taksit ekstre öncesinde tamamlandı` notu geçmiş sentetik
  satırların bilerek bulunmadığını anlatır; Data Health yalnız açık `N+1..M`
  planını bekler. Eski carryover notu da geriye uyumlu kalır.
- ~~**Banka taksit/masraf bileşenlerini mükerrer sayma.**~~ DONE. Açıklamadaki
  farklı `1.Tk`/`2.Tk` numaraları ile `anapara`/`faiz`/`BSMV`/`KKDF` bileşenleri
  aynı gün ve tutarda olsalar da yapısal olarak ayrı satır kabul edilir.

## 2026-08-09 — Ekstre ve taksiti banka modeline indir

- ~~**Ekstre importunda tarihsel taksit eşleştirmesini kaldır.**~~ DONE. PDF açık
  dönemin kaynak gerçeğidir; `StatementImportModal` eski taksit/parent satırı
  sorgulamaz. Devreden `3/6` plan yalnız `3..6` açık satırlarını üretir; geçmiş
  `1..2` sentetik `paid` kayıtlar olarak yeniden yaratılmaz.
- ~~**Ekstre ödemesini taksit yaşam döngüsünden ayır.**~~ DONE.
  `pay_card_statement` arşivdeki banka tutarını öder, kaynak hesabı borçlandırır,
  arşivi kapatır ve kartın ekstre kovasını açık arşivlerden tekrar projekte eder.
  Aggregate drift ödemeyi engellemez; bağlı taksitlerin `status/paid_at` alanları
  değişmez. Gerçek Postgres regresyonları import ve ödeme davranışını doğrular.

## 2026-08-04 — Bağlam türleri + tür registry

- ~~**Yeni bağlam türleri.**~~ DONE. `pet`/`project`'e ek: `health` (Sağlık),
  `hobby` (Hobi), `business` (Yan iş/İşletme), `travel` (Seyahat/Tatil). Her
  türün kendi kategori seti + süreli/süresiz davranışı. "Ev" bilerek eklenmedi
  — düzenli fatura aboneliğe ait, bağlam düzensiz "şey maliyeti" içindir.
- ~~**Tür registry (refactor).**~~ DONE. `EXPENSE_CONTEXT_KINDS`
  (`utils/expenseContexts.ts`) tek kaynak: `{ label, categories, timeboxed }`.
  Sayfa dropdown/kategori/tarih-görünürlüğü/ikon hep registry'den türer; elle
  `kind === 'pet'` karşılaştırması kalmadı. Yeni tür = registry'ye bir satır +
  CHECK'i genişleten migration + ikon eşlemesi. `expense_contexts_kind_check`
  widened; mevcut satırlar geçerli, RLS/grant değişmez.

## 2026-08-04 — Süresiz bağlam + mobil hub menüsü

- ~~**Süresiz bağlam.**~~ DONE. Bağlam formu tarihleri opsiyonel; evcil hayvan
  türünde tarih alanı hiç gösterilmez (doğası gereği süresiz), proje türünde
  bitiş boş = süresiz. `ends_on` null olan bağlam özet kartında "Süresiz"
  rozetiyle işaretlenir. Şema değişmedi (`starts_on`/`ends_on` zaten nullable) —
  sorun form UX'iydi (çıplak datepicker'lar zorunlu gibi görünüyordu).
- ~~**Mobil hub menüsü.**~~ DONE. `HubNav` `flex-1` → `flex-none` (mobil):
  sekmeler içerik-boyunda ve yatay kaydırılır (44px dokunma alanı), aktif sekme
  görüşe kaydırılır, scrollbar gizli; `sm:flex-1` ile desktop'ta şerit dolu
  kalır. 5 sekmeli Plan hub'ında sıkışma çözüldü.

## 2026-08-04 — Gider bağlamları + Arabalarım v2

- ~~**Evcil hayvan ve etkinlik/proje bağlamları.**~~ DONE. Genel bağlam modeli, kart annotation'ı, kart-dışı gider, proje bütçesi ve burn-down `/odemeler/baglamlar` altında.
- ~~**Yakıt takibi.**~~ DONE. Litre + odometre girişi, full-to-full L/100 km, TL/km ve aylık maliyet trendi.
- ~~**Araç bakım/yenileme hatırlatıcıları.**~~ DONE. Tarih/km hedefi, ay/km tekrarı, yaklaşan/geciken durumları ve 7 gün kala tercih kontrollü Web Push.
- ~~**Araç TCO karnesi.**~~ DONE. Yıllık toplam, günlük maliyet, önceki yıl ve gizlilik güvenli indirilebilir PNG.

## 2026-08-04 — Bağlam-odaklı navigasyon (IA) yeniden düzeni

Amaç: "routinglerde kafam karışıyor" — her şey bağlamına göre yerleşsin, az
tıklama. URL mimarisi korunur (redirect'lerle), yalnız gruplama/isim/görünürlük
değişir.

- ~~**İsim hizalama.**~~ DONE. Nav etiketi = sayfa kimliği: "Birikim"→**Varlıklar**,
  "Takvim"→**Plan**.
- ~~**Arabalar → Varlıklar.**~~ DONE. `/analiz/araclar` → `/varliklar/araclar`
  (araç = sahip olunan bağlam). Eski path redirect.
- ~~**Alsam mı? görünür + Plan'a.**~~ DONE. `/alsam-mi` → `/odemeler/alsam-mi`,
  Plan hub sekmesi oldu (eskiden sadece Hızlı işlemler'de). Eski path redirect.
- ~~**Kredi kartı borcu → Borçlar.**~~ DONE. Yeni `/borclar/kartlar`
  (`LiabilitiesCardsPage`): kart borcunu krediler/kişiler ile aynı "ne borçluyum"
  bağlamında gösterir + ödetir. Kart borcunu OKUR, ödemeyi Hesaplar'daki
  `openDebtPayment` deseni + aynı paylaşılan drawer + `pay_card_debt` RPC'siyle
  yapar (mükerrer yazma yok). Kart ledger/ekstre döngüsü Hesaplar'da kalır.
- **Açık:** mobil alt bardaki 5 slot kullanıcıyla ayarlanacak (6 ana alan var).

## 2026-08-04 — Arabalarım: araç başına gider takibi + vergi takvimini kaldır

Amaç: Araç giderlerini (yakıt, bakım, MTV, sigorta...) araç başına ayrı izlemek.
Kullanıcı çoğu gideri aynı kartla ödüyor ama araç kırılımını ayrı istiyor; nakit/
banka giderleri (MTV, sigorta) de kapsanmalı.

- ~~**Vergi takvimini kaldır.**~~ DONE. "Türkiye finans takvimi" preset'leri
  (`TurkishCalendarPresets` + `obligationPresets`) ve Ödeme Takvimi'ndeki kullanımı
  silindi.
- ~~**Arabalarım modülü.**~~ DONE. `/analiz/araclar` (Analiz hub alt-sekmesi).
  Veri modeli çift saymayı yapısal olarak imkânsız kılar: kartla yapılan gider
  bugünkü gibi `card_expenses`'te kalır, yalnız `car_id` ETIKETI düşülür (borç RPC'si
  değişmez — dönen satıra ayrı UPDATE, `updateCardExpenseCategory` deseni). Kart-dışı
  (nakit/banka) giderler ayrı `car_expenses` tablosunda. Bir gerçek harcama ya
  kartta ya kart-dışı → ayrık kümeler → mükerrer yok. `car_expenses` net değer/nakit
  akışı/yükümlülük matematiğine GİRMEZ (saf raporlama merceği). Etiketleme iki
  yerden: Arabalarım sayfası + Hesaplar'daki Hızlı harcama formu araç seçici.
  Saf toplama `utils/carExpenses.ts` (araç başına toplam/bu-ay/kategori kırılımı).
  Yerel Postgres'te RLS/grant/lint + uçtan uca UI (borç 800 tek sayıldı, araç
  toplamı 2300) doğrulandı.

## 2026-08-09 — Ekstre PDF kaynak-gerçek yeniden kurulum

- ~~**SI-09 — Cari PDF satırını paid child/yeniden numaralanmış parent ile karıştırma.**~~ DONE.
  Paid taksitler cari eşleştirme adayından çıkarıldı. Açık child ile PDF'nin
  taksit no/adedi birebir değilse tarihsel parent import payload'ında yeniden
  kullanılmaz; eski paid geçmiş kendi parent'ında kalırken PDF yeni açık plan
  kurar.

- ~~**SI-08 — Taksit satırını yanlış tarih/sıra parent'ına bağlama.**~~ DONE.
  Strict sıra+tarih eşlemesindeki tek aday, açıklama uyuşmuyorsa artık yalnız
  tutarı da yakınsa kabul edilir. Aksi halde aynı ekstre dönemindeki açıklama ve
  tutar uyumlu plan aranır; böylece farklı merchant'ın parent id'si import
  payload'ına taşınmaz.

- ~~**SI-07 — Tarihsel taksit parent toplam farkını güvenle kabul et.**~~ DONE.
  Ödenmiş geçmişi bulunan planda parent toplam tutarı ile PDF'nin aylık-tutar ×
  adet projeksiyonu farklıysa parent ve paid child'lar değişmeden kalır; açık
  child'lar PDF'den yeniden kurulur ve fark yeni child notlarında izlenir. Yalnız
  taksit adedi çakışması yapısal belirsizlik olarak atomik importu durdurur.

- ~~**SI-06 — Açık ekstre kapsamını PDF'den atomik yeniden kur.**~~ DONE.
  `replace_card_statement_import` ekstre tarihine kadarki yeniden kurulabilir
  harcama/açık taksit/arşiv kapsamını tek transaction'da temizleyip parser'ın
  doğrulanmış aksiyonlarını yeniden oynatır. Ödenmiş ekstre ve current-settlement
  kanıtları ile PDF tarihinden sonraki hareket/provizyonlar korunur. Taksit
  parent'ında paid arşiv çocuğu varsa parent + tarihsel child kalır, yalnız açık
  child planı PDF'den yeniden oluşur. Kesim/son ödeme tarihi kart döngüsüyle
  uyuşmazsa tüm işlem rollback olur; aynı PDF'nin yeniden importu borç/child/arşiv
  sayısını değiştirmez. Modal tüm PDF satırlarını varsayılan/zorunlu kapsam yapar;
  belirsiz taksit adedi doğrulanmadan RPC çağrılmaz.

## 2026-08-04 — Taksit import doğruluğu: kalan-borç cross-check + belirsiz taksit koruması

Amaç: Ekstreden taksit kurulumunda en büyük sessiz hata sınıfını kapatmak —
toplam adedi körlemesine `aylık × adet` ile kurmak.

- ~~**TI-01 — Notasyondaki kalan borcu yakala + tutarlılık invariant'ı.**~~ DONE.
  `denizBankStatementParser.ts` artık `<kalan>/<toplam>-<sıra>` notasyonundaki
  kalanı `ParsedTransaction.remainingDebt`'e okur (eskiden strip edilip atılıyordu).
  `checkInstallmentNotation` (utils/importedInstallmentPlan.ts) invariant'ı:
  `kalan ≈ aylık × (toplam − sıra)` (gerçek ekstrede bire bir; BEYLER
  43.333,33 = 21.666,67×2, NEOVA 12.033,65 = 2.005,61×6). Tutmuyorsa adet şüpheli
  → körlemesine toplam kurma.
- ~~**TI-02 — Belirsiz/tutarsız taksit sessiz tek-harcama YAZMASIN.**~~ DONE.
  `resolveStatementImportAction` yeni `needs-review` aksiyonu döner: (a) toplam
  adet parser'dan belirsizken (override yok, count ≤ 1) — 12 taksit küçük bir
  harcamaya dönüşmesin; (b) notasyon tutarsızken. Override (kullanıcı adedi elle
  doğruladı) her ikisini de atlar. `StatementImportModal.isImportable` tutarsız
  notasyonu manuel incelemeye düşürür; executor `needs-review`'ı yazmaz, hata döner.
- ~~**TI-03 — Tüm-ekstre parse checksum'ı.**~~ DONE. 8 gerçek DenizBank ekstresinde
  kalibre edilen İKİ bağımsız kimlik (`checkStatementParseTotals`,
  denizBankStatementParser.ts; her ikisi de 8/8 ekstrede residual 0):
  - **Başlık:** `Dönem Borcu = Önceki − Ödemeler + Dönem İçi + Faiz` (parser başlık
    alanını yanlış okursa tutmaz).
  - **Satır:** `Σ(işlem) − Σ(iade) = Dönem İçi + Faiz` (parser bir satırı
    DÜŞÜRÜR/yanlış okursa tutmaz — kategori/taksit sessizce eksik kalır). Dönem
    İçi'ye dayandığı için ödenmemiş-önceki (carryover) durumunda da sağlam.
  Parser artık `previousBalance/payments/periodSpending/feesAndInterest` başlık
  alanlarını okur. `StatementImportModal` tutarsızlıkta engellemeyen kırmızı uyarı
  gösterir (`buildParseTotalsWarning`). app-vs-banka kilidinden (SI-04) FARKLI: o app'i
  bankaya çeker, bu PDF'in kendi iç tutarlılığını sorar (kilit satır-düşmesini maskeler).

## 2026-08-04 — SMS provizyonu ↔ import mükerrer kaydını azalt

Amaç: SMS anında açılan provizyon ile ekstre/güncel-hareket import'undan gelen
aynı işlemin ikinci kez yazılmasını önlemek. Kök neden eksik dedup DEĞİL, eşleşme
penceresinin darlığıydı (provizyon tarihi = harcama anı; banka post tarihi
birkaç iş günü sonrası; döviz/bahşiş tutar sapması).

- ~~**SM-01 — Eşleşme penceresini genişlet + göreli tolerans.**~~ DONE.
  `utils/importMatch.ts` (yeni; + `importMatch.test.ts`) iki matcher'ın (güncel
  hareket + ekstre) TEK tuning kaynağı: tarih penceresi 3→7 gün, tutar toleransı
  `max(5 TL, %1)`, uzak pencerede (4-7 gün) açıklama uyumu ZORUNLU
  (`selectImportMatchIndex`; körlemesine eşleşme yok → iki farklı işlemi
  birleştirmez). `denizBankMovementParser.ts` + `denizBankStatementParser.ts` bu
  modülü kullanır. Küçük tutarda taban 5 TL baskın (mevcut testler korunur).
- ~~**SM-02 — Eşleşen provizyonu otomatik terfi.**~~ DONE. Güncel hareket
  import'unda banka "Dönem İçi" (posted) + app kaydı provizyon eşleşince mevcut
  provizyon `post_card_provision` (`applyCardProvision`) ile kesinleştirilir —
  yeni satır AÇILMAZ, tek otoriter kayıt. Total borç değişmez (provizyon zaten
  borcu artırmıştı; provizyon→posted bir kova reclass'ı). `CurrentMovementImportModal.tsx`.
  Yeni migration yok.

## 2026-08-03 — Ekstre importunu aylık mutabakat çıpası yap

Amaç: SMS otomasyonu anlık ama eksik olabildiği için ekstreyi aylık "kesin
kapanış" yapmak — import bitince app ekstre borcu = bankanın bildirdiği toplam.

- ~~**SI-01 — Banka toplamına kilit (çekirdek çıpa).**~~ DONE. Import + tüm
  düzeltmeler sonrası `fetchCardById` ile TAZE borç kovaları okunur; kalan fark
  (`reconcileResidualTL` = banka − app) success ekranında gösterilir ve tek
  denetlenebilir ters-kayıtla (`postCardDebtCorrection`, `lockCorrectionNote`)
  banka toplamına çekilir. `post_card_debt_correction` işaret-bazlı kova mantığı
  (+ → current, − → önce current sonra statement) sayesinde kilit sonrası
  `statement+current = banka` garanti. Yeni migration yok.
- ~~**SI-02 — App'te fazla (ekstrede yok) harcamaları temizle.**~~ DONE.
  `findAppOnlyExpenses` dönem içinde eşleşmeyen tek-çekim posted kayıtları bulur;
  modal içinden çoklu seçim + `cancelCardExpense` ile append-only iptal. Taksitler
  ayrı taksit kontrolünde kalır (arşiv bozulmasın).
- ~~**SI-03 — Manuel taksitlere inline "elle ekle".**~~ DONE. Toplam taksiti
  belirsiz satırlara modal içi adet inputu; `buildImportedInstallmentPlan` +
  `addCardExpense`/`recordCardInstallmentCarryover` ile idempotent (row
  `sourceEventId`) eklenir. Kartlar ekranına gitmeye gerek kalmaz.
- ~~**SI-05 — Taksit import kararını saf plancıya çıkar + test et.**~~ DONE.
  `resolveStatementImportAction` (utils/statementImportPlan.ts) ekstre satırını
  payment/carryover/expense aksiyonuna çözer; modaldaki 3 inline tekrar tek
  `runStatementImportAction` executor'ında birleşti. 9 birim senaryosu + gerçek
  Postgres DB regresyonu (`supabase/tests/statement_import_installments.sql`,
  CI+deploy DB gate'inde): 1. taksit 12×1000=12000; plan-ortası 4/12 → yalnız
  `4..12` açık satırları ve 9000 borç; son taksit 12/12 → yalnız tek açık satır,
  250 borç ve ay-sonu vade (2026-07-31). İnvariant: devreden plan geçmişi yeniden
  üretmez; kart borcu cari+gelecek açık taksit toplamıdır.
- **SI-04 — Çok bankalı cihaz-içi parser.** YapıKredi DONE, diğerleri PENDING.
  `utils/yapiKrediStatementParser.ts` (+ test) YapıKredi/Worldcard ekstresini
  cihazda çözer: Türkçe ay-isimli tarih ("05 Mart 2026"), Türkçe sayı, taksit
  bilgisi ALT satırda ("146.999,00 TL'lik işlemin 4/9 taksidi"), İşlem tablosu
  bölge sınırı (WORLDPUAN tarih satırlarını sahte harcama saymaz). Modal DenizBank
  → YapıKredi → Gemini sırasıyla dener; ikisi de cihaz-içi. amount AYLIK taksit
  (DenizBank ile aynı semantik); aylık×adet ile ekstre toplamı arası ~kuruş
  yuvarlaması mutabakat kilidinde kapanır. DenizBank + YapıKredi dışı bankalar hâlâ
  Gemini edge'e düşüyor; yeni banka örneği gelince aynı desende parser eklenir.

Saf domain: `utils/statementReconcileReview.ts` (+ test). UI:
`components/finance/StatementImportModal.tsx`.

## 2026-08-03 — Veri Sağlığı çözüm aksiyonları ve güvenli otomasyon

- ~~**DH-05 — Her sağlık bulgusuna gerçek çözüm aksiyonu.**~~ DONE.
  `DataHealth.resolution.ts` tüm issue kind'larını exhaustive biçimde otomatik
  yeniden hesaplama, korumalı tek-tık, domain akışına yönlendirme, manuel
  uzlaştırma veya bilgi inceleme moduna ayırır. Eski `fixable` alanı tek başına
  yazma butonu açmaz. Aktif 69 id deseninin tamamında fix/ödeme/sayfa-içi review
  veya sahip ekran aksiyonu vardır.
- ~~**DH-06 — Deterministik düzeltmeler için transaction/audit sınırı.**~~ DONE.
  `apply_data_health_safe_repairs` kart/account ledger projeksiyonu, kredi plan
  özeti ve kart borç kırılımı clamp'ini exact `updated_at` CAS + hedef kilitleriyle
  uygular. Planlar 1..100, duplicate-free ve tek domain'dir; stale bir hedef tüm
  planı finans yazısı olmadan conflict'e düşürür. Idempotency key kanonik isteğe
  bağlıdır; `data_health_repair_runs` / `data_health_repair_steps` before-after
  fişleri istemciye karşı immutable ve yalnız sahibine görünür. `loanTotals` aynı
  RPC'yi bireysel loan-domain aksiyonda kullanır ve toplu seçime girmez.
  Repair/reset kullanıcı bazında transaction mutex ile lineerleştirilir.
- ~~**SEC-03 — Ledger aggregate yetkisi istemciden forge edilebiliyordu.**~~ DONE.
  Authenticated doğrudan INSERT policy/grant'ları `card_ledger` ve
  `account_ledger` için kaldırıldı. Event üretimi trigger ve kanonik correction
  RPC'lerinde kalır; `supabase/tests/data_health_safe_repairs.sql` gerçek Postgres
  runtime permission denial'ını CI/deploy DB gate'inde doğrular.
- ~~**DH-07 — Duplicate ve eksik metadata yönlendirmeleri işlevsizdi.**~~ DONE.
  Data Health exact `payload.ids` kayıtlarını yan yana gösterir. Kullanıcı
  gerçekten duplicate olan satırı iki-aşamalı onayla `cancel_card_expense`
  üzerinden append-only tersler; açıklama/kategori yalnız finans alanı kabul
  etmeyen, owner/stale guard'lı metadata RPC'siyle düzenlenir; sınıflandırma
  finansal archive/settlement toplamlarını değiştirmez.
- ~~**DH-09 — “Bu doğru, kapat” yalnız tek tarayıcıda kalıyordu.**~~ DONE.
  `data_health_issue_acknowledgements` kabul edilen deterministik bulgu kimliklerini
  kullanıcı hesabına bağlı saklar. Yazma/temizleme yalnız auth-bound RPC'lerden,
  okuma own-row RLS üzerinden yapılır; böylece seçim tüm cihazlarda geçerlidir.
  Eski `datahealth:dismissed` localStorage kayıtları ilk yüklemede sunucuya taşınır.
  Kayıtlar tam yedek/restore ve kullanıcı reset kapsamındadır; finans satırlarını
  veya immutable geçmişi değiştirmez.
- **DH-08 — Yapısal taksitleri sessiz/tek-tık tamamlama (opsiyonel sonraki faz).**
  Generic REST amount/count/date/posted/missing-row düzeltmeleri parent/sibling
  yarışında güvenli olmadığı için kaldırıldı. Hiçbiri aksiyonsuz değildir:
  kanonik Kartlar plan editörüne gider ve kilitli domain rebuild ile çözülür.
  Gelecekte ayrı bir card→expense→siblings lock'lu RPC yazılırsa future-only
  satırlar yeniden tek-tık adayı olabilir; geçmiş için banka gerçeği olmadan
  otomasyon yapılmayacaktır.

## 2026-08-02 — Prod veri tutarlılığı denetimi ve düzeltme paketi

Salt-okunur prod denetiminde kart borç bileşimi, 1000+ satırlı ledger yükleme,
yedek kapsamı ve SMS otomasyonu birlikte kontrol edildi. Düzeltmeler yerelde
hazırdır; **prod deployment/main push kullanıcı açıkça istemeden yapılmayacaktır.**

- ~~**INC-02 — Eski provizyon modelinden kalan kesin toplam-borç farkı.**~~
  IMPLEMENTED LOCALLY. `20260802160000_repair_legacy_provision_debt.sql` yalnız
  aktif provizyon satırları, kartın provizyon kovası ve görünür bölünüm + planlı
  taksit projeksiyonu kuruşu kuruşuna aynı farkı doğruladığında toplam borca
  append-only adjustment ekler. Belirsiz kartlara dokunmaz; kart kilidinden sonra
  bütün projeksiyonları tekrar hesaplar.
- ~~**INC-03 — Mutabakat iptalinde provizyon borcu terslenmiyordu.**~~ IMPLEMENTED
  LOCALLY. `20260802165000_cancel_expense_reverses_provision_debt.sql`, geçici
  provizyon-ayrık davranışını kaldırır; `cancel_card_expense` provizyonda hem
  `debt_amount` hem `provision_amount` etkisini tersler. Gerçek Postgres regresyonu
  `provision_debt.sql` içinde CI/deploy DB gate'ine bağlandı.
- ~~**DH-03 — Data Health ve JSON backup satır sınırı.**~~ DONE. Offset/örtük
  PostgREST limiti yerine immutable PK keyset sayfalama kullanılır; 1000+ ledger
  ve backup satırı test edilir. Çoklu REST istekleri transaction snapshot değildir;
  concurrent üyelik değişimi bilinen residualdır, mevcut satırlar offset kaymasıyla
  atlanmaz/çift okunmaz.
- ~~**DH-04 — Kart borcu/taksit kısmi örtüşmesi ve riskli otomatik fix.**~~ DONE.
  `cardDebtBreakdown` kısmi planlı-borç örtüşmesini ayrı uyarı olarak üretir.
  `cardScheduledDebt` ve `cardInstallmentOverflow` banka gerçeği olmadan artık
  otomatik `debt_amount` yazmaz; legacy payload verilse dahi write yapılmaz.
  Ekstre arşivine doğrudan veya aynı taksit planındaki bir sibling üzerinden bağlı
  yapısal taksit sorunları da tarihsel satırları silip yeniden üretmez; Data Health
  bunları manuel inceleme olarak gösterir.
- ~~**D8 — Eksik backup/reset tabloları.**~~ IMPLEMENTED LOCALLY. Wishlist, kasa
  kovaları ve bildirim tercihleri export/restore/reset kapsamındadır. Restore önce
  FK-güvenli tek reset RPC'si çağırır. Ledger/log ve immutable current-settlement
  kanıtı export-only kalır; parent settlement olmadan güvenle taşınamayan child
  satırları v2 ve legacy v1 formatlarında konservatif normalize edilir. Reset owner
  SMS/notification loglarını da siler; eski notification dedupe anahtarları restore
  edilmiş kayıtları bloke etmez.
- ~~**SMS-01 — Yeni DenizBank formatları, saat ve hesap retry idempotency'si.**~~
  IMPLEMENTED LOCALLY. Tam maskeli kart, otomatik ödeme ve gelen FAST/HAVALE/EFT
  formatları tanınır; karma tutar ayraçları kuruş hassasiyetinde ayrıştırılır ve SMS
  saati açık `+03:00` taşır. `20260802180000` hesap webhook'unu
  `(user, source_table, source_event_id)` ile tekilleştirir, kart satırı kilidi +
  unique index kullanır ve RPC'yi yalnız service role'a açar.
- ~~**SEC-01 — Aynı-kart parent id ile sahte child allocation.**~~ IMPLEMENTED
  LOCALLY. `20260802190000_protect_card_allocation_paths.sql`, expense/installment
  satırlarının eski bir erken-ödeme veya ekstre parent'ına doğrudan `UPDATE` ile
  bağlanmasını engeller. Bu alanları yalnız aynı transaction'da kart toplamlarını da
  taşıyan `pay_card_debt` / `cut_card_statement` açabilir; transaction-local bağlam
  kullanıcı, satır sahibi, kart ve parent ile doğrulanıp hemen temizlenir. Current
  settlement marker'lı doğrudan child `INSERT` de reddedilir. Tarihsel ekstre-marker'lı
  `INSERT`, mevcut JSON restore doğrudan replay yaptığı için same-user/same-card RLS
  kontrolünde kalır; tam provenance gelecekte transactional restore RPC gerektirir.
- ~~**INC-04 — Ekstreye kesilmiş harcama current-period edit algoritmasına
  girebiliyordu.**~~ IMPLEMENTED LOCALLY. `20260802200000`, doğrudan archive'a
  bağlı tek çekim harcamayı ve herhangi bir child taksiti archive'a bağlanmış
  taksit parent'ını `update_card_expense` içinde değişmez kılar. Böylece edit eski
  tutarı yanlış kovadan tersleyip statement kovasını clamp'leyemez ve satır eski
  archive toplamına bağlı kalamaz. DB guard ayrıca arşivlenmiş expense/installment'ın
  tutar, tarih, kart ve plan alanlarını raw REST `UPDATE`'ine karşı korur. Tek child
  tutarını parent/card/ledger etkisi olmadan değiştiren statement-import otomatik fix'i
  kaldırıldı; fark manuel uzlaştırma sinyali olarak kalır. Kanonik ekstre ödemesi
  artık child `status/paid_at` alanlarına dokunmaz. Single + installment gerçek DB
  regresyonu vardır.
- ~~**SEC-02 — Ekstre lifecycle/DELETE yolları arşiv toplamını atlayabiliyordu.**~~
  IMPLEMENTED LOCALLY. `20260802190000`, arşivlenmiş expense/installment ve ekstre
  parent'ının ham DELETE, finans alanı ve lifecycle değişikliklerini reddeder; yalnız
  user+statement bağlı `pay_card_statement` ile exact `open→paid` geçişine izin verir.
  Arşivlenmiş harcama iptali düzeltme/uzlaştırma akışına yönlendirilir. Pay/cut/edit/
  cancel/import-reset aynı card→child kilit sırasını kullanır. Geçersiz legacy arşiv
  statüsü banka debit'i olmadan `paid` yapılmaz; Data Health bunu manuel gösterir.
  Current-settlement veya ödenmiş-ekstre taksit geçmişi bulunan kart clean-import
  resetinden önce güvenle reddedilir. Kullanılmayan ve immutable geçmişi tanımayan
  `reset_card_data` RPC/helper'ı kaldırıldı.
- **Açık manuel uzlaştırma:** Prod'daki bir kartta ₺298,20 kısmi taksit/borç
  örtüşmesinin hangi tarafta eski olduğu banka ekstresi olmadan belirlenemez.
  Tarihsel tanınmayan SMS'lerde de mevcut kayıtla kesin eşleşmeyen adaylar vardır;
  iptal/manual kayıt ihtimali nedeniyle otomatik backfill yapılmayacaktır.

## 2026-08-02 — Uçtan uca fonksiyonel kabul testi (yerel)

Yerel Supabase'de gerçek RPC'ler kullanıcı-impersonation ile çağrılıp tablo/ledger/
history kuruş hassasiyetinde doğrulandı (15+ senaryo PASS: taksit, ekstre, transfer,
kartla-ödeme çift-sayım, varlık al-sat, kredi, borç/alacak, negatifler). Bir P2 hata
bulundu ve düzeltildi:

- ~~**INC-01 — Provizyon toplam borcu artırmıyordu (kayboluyordu).**~~ DONE.
  20260625 provizyonu `debt_amount`'tan ayırmıştı ama `clamp_card_breakdown` hâlâ
  `statement+current+provision ≤ debt` istediği için boş/düşük-borç kartta provizyon
  clamp'le 0'a düşüp **kayboluyor** ya da current'ı yiyordu (hızlı harcama "Provizyonda"
  + DenizBank bekleyen-işlem yollarıyla kullanıcıya açık). Kullanıcı kararı: provizyon
  toplam borcu artırmalı (CARD_DEBT_TRANSITIONS.md ile uyumlu). Migration
  `20260802130000_provision_increases_debt.sql` (forward-only, imza/grant korunur):
  `add_card_expense` provizyonda `debt += amount`; `post_card_provision` posting'de
  borç eklemez (create'te eklendi, yalnız provision→current taşır). Yerel docker'da
  tam yaşam-döngüsü doğrulandı (boş kart create→post→cancel + normal kart
  cannibalization yok + regresyon posted). Regresyon: `supabase/tests/provision_debt.sql`
  + `npm run db:test:provision`. db lint/rls/grants temiz. Doküman güncellendi.
- ~~**DH-01 — Carryover geçmiş taksit satırları "fazla" yanlış pozitifi.**~~ DONE.
  Kullanıcı prod'da "çift harcama gibi gözüken" bir kayıt bildirdi; canlı inceleme
  (salt-okunur) duplicate sayaçlarının 0 olduğunu, işaretin aslında "OLKA SPOR ...
  fazla taksit satırı (1/3, 2/3)" olduğunu gösterdi. Kök neden:
  `record_card_installment_carryover` geçmiş taksitleri (installment_no ≤ paidBefore)
  `posted` satır olarak bilerek yaratır, ama `checkCardInstallments`
  (`DataHealth.checks.ts`) `extraRows = installment_no <= paidBefore` ile bunları
  "fazla" sanıyordu (yerelde carryover üretilip doğrulandı: 1/3,2/3 posted + 3/3
  scheduled). Fix: `extraRows` artık yalnız gerçekten geçersiz numaraları
  (`> installment_count` veya `< 1`) işaretler. TS-katmanı, migration yok. Regresyon:
  `DataHealth.logic.test.ts` "DH-01" (yanlış pozitif gitti + gerçek plan-dışı hâlâ
  yakalanır). Gerçek veri kaybı/çift-sayım yoktu — yalnız yanıltıcı uyarı.
- ~~**DH-02 / OBS-01 — Kart harcaması kaynak-olay idempotency'si.**~~ DONE.
  Denizbank Black'teki aynı gün/tutar/açıklamalı iki BURULAŞ satırının kullanıcı
  tarafından doğrulanan iki ayrı arka arkaya işlem olduğu ortaya çıktı. Kaba
  `transaction_fingerprint` artık "kesin duplicate / %98" diye sunulmaz; yalnız
  manuel inceleme sinyalidir. Gerçek retry ayrımı için `card_expenses.source_event_id`
  + kısmi unique index eklendi (`20260802140000_card_expense_source_event_id.sql`).
  Manuel formlar mantıksal submission UUID'si, fiş/SMS artefakt hash'i, PDF importları
  belge hash'i + satır içeriği hash'i + occurrence sırası kullanır. Aynı dosyadaki birebir eş iki satır
  ayrı kalır; aynı satırın retry/reimport'ı borç, taksit, ledger veya history'yi ikinci
  kez üretmez. Eski RPC istemcileri opsiyonel/yeni overload sözleşmesiyle uyumludur.
  Regresyon: `supabase/tests/card_expense_idempotency.sql` +
  `npm run db:test:card-expense-idempotency`; CI ve deploy migration gate'ine bağlıdır.

## 2026-08-02 — Tam uygulama denetimi + kontrollü iyileştirme

Kanıta dayalı tam denetim (rapor: `docs/APPLICATION_AUDIT_2026-08-02.md`). Olgun kod
tabanı; para/güvenlik/veri-bütünlüğü katmanları temiz doğrulandı (P0/P1 hata yok).

- ~~**F-01 — Ölü/stale SMS kategori ikizi.**~~ DONE. `utils/smsParser.ts`'teki
  `inferCategory`+`CATEGORY_RULES` (8 kategori, uygulama kullanmıyor; kanonik motor
  `categories.ts`, 13 kategori) ve `smsParser.test.ts`'teki 6 ölü test kaldırıldı.
  Dosyanın PARSING kısmı canlı `parse-sms` edge fonksiyonunun test aynası olduğu için
  KORUNDU (komple silme, SMS-parsing regresyon kapsamını yok ederdi).
- ~~**F-02 — Modal a11y (SimpleModal focus yönetimi).**~~ DONE. `SimpleModal` (10
  modalın tabanı; ödeme/al-sat/hareket modalları dahil) focus trap / Escape /
  focus-restore kazandı (`confirm-dialog` deseni). Kullanıcı onayıyla komponent-test
  altyapısı kuruldu (`happy-dom` + `@testing-library/react`; per-file
  `@vitest-environment happy-dom` pragma, global env `node` korunur) ve
  `SimpleModal.test.tsx` (5 test: focus-into-dialog/Escape/Tab-trap/restore) eklendi.
- ~~**F-04 — `record_sms_account_movement` kullanılmayan `p_occurred_at`.**~~ DONE
  (P3). RPC `p_occurred_at`'i kullanmıyordu → `transaction_history.occurred_at`
  `now()` alıyordu; aktivite akışı/financePanelsRepo `occurred_at`'e göre
  sıraladığından gecikmeli/retry SMS yanlış günde görünüyordu. Forward migration
  `20260802120000_sms_account_movement_use_occurred_at.sql`: INSERT'e `occurred_at`
  eklendi (`coalesce(p_occurred_at, now())`); imza/security definer/search_path/grant
  birebir korundu. Bakiye/ledger matematiği DEĞİŞMEDİ (account_ledger olayı sistem
  kaydı olarak now()'da kalır). Yerel docker doğrulaması: RPC 3-gün-önceki tarihi
  yazdı (occurred_at≠created_at), db lint uyarısı kalktı ("No schema errors"),
  RLS/grants/catchup yeşil.
- Denetim pass'leri: R-2 dependency audit 0 açık; R-3 primitive örneklemesi →
  refactor gerekmez; R-4 RLS/grants/lint/catchup yerel docker'da yeşil; R-1 canlı
  denetim login kabuğunda taşma-0 (auth-arkası kısım şifre-girme yasağıyla bloke).

## 2026-07-28 — Fonksiyonel revizyon (Faz G, devam ediyor)

Görsel revizyondan (Nocturne) sonra fonksiyonel tur. Canlı denetimde (yerel seed +
tarayıcı) çıkan iki kalıp: (a) panel ayıklaması dashboard'a uygulanmış ama Hesaplar
ve Analiz'de aynı rakamlar tekrar ediyordu; (b) birkaç gerçek boşluk (kasa modu,
hedef önerisi, push v1.1) hâlâ açıktı. Kullanıcı dört yönü de kapsama aldı; sıralı
plan G1→G5.

- ~~**G1 — Hesaplar Özet + Analiz tekrar ayıklama.**~~ DONE. Masaüstünde kart borcu
  kırılımı 4 yerde (CardControlCenter, CreditCardOverview, LiveReconciliation +
  kompakt tekrar), Analiz'de kategori dağılımı 2 yerde görünüyordu. Kök neden:
  `CreditCardOverview` her viewport'ta, `CardControlCenter` yalnız `md:block` →
  masaüstünde ikisi birden. Çözüm: `CreditCardOverview` artık `md:hidden` (mobil
  yüzey; masaüstünde CardControlCenter asıl yüzey, 2026-07-24'te öyle kurulmuştu).
  Masaüstünde kaybolmasın diye limit kullanımı (`buildLimitGroupSummaries` ile
  paylaşımlı limit doğru toplanır) `CardControlCenter`'a taşındı. Analiz'de
  `MonthlyReport`'un inline "Kategori dağılımı" listesi kaldırıldı; kategori tek
  yerde (`CategorySpendingChart` — CompositionBar + içgörü). "Geçen aya göre"
  değişim özeti korundu. PDF (`window.print`) ve paylaşım kartı (`renderShareableCard`
  `summary` nesnesinden) DOM'a bağlı olmadığı için export'lar etkilenmedi. 1280px ve
  375px tarayıcıda doğrulandı; finans matematiği değişmedi.
- ~~**G2 — Ödeme Alarmı'nda yerinde tek-tıkla ödeme.**~~ DONE. "Bugünün Odağı"
  aksiyonları toplu (ör. "2 geciken ödeme") olduğu için tekil ödeme için uygun
  değildi; asıl inline kazanç dashboard "Ödeme Alarmı" (yaklaşan vadeler)
  panelindeki tekil kalemlerdi. `DashboardUpcomingItem` artık kaynak
  `FinanceObligation`'ı taşıyor; `action` taşıyan (ödenebilir) kalemlerde "Öde"
  butonu paylaşılan `useFinancePaymentDrawer` + `FinancePaymentDrawer`'ı sayfa
  değiştirmeden açar (PaymentsPage/LoansPage ile aynı çekmece). Ödeme sonrası
  `useInvalidateFinanceSnapshot` ile cache tazelenir. Tarayıcıda uçtan uca
  doğrulandı: Kira ödendi → listeden düştü, sıradaki vade öne geldi. Yeni finans
  matematiği yok.
- **G3 — Hedef bazlı birikim önerisi + Kasa modu.** (Kullanıcı: Supabase tablo +
  ikisini de.) İki parça:
  - ~~**G3a — Birikim önerisi.**~~ DONE. `utils/savingsSuggestion.ts` (+10 test):
    `buildSavingsSuggestion` hedefe/hedef tarihe göre aylık gerekli tutarı verir
    (TRY tutar, altın birim, composite desteklenmez); `buildSavingsCashflowAdvice`
    bu ayki harcanabilirle (safeToSpend, PlanningPage'ten geçer) kıyaslayıp
    ayır/kısmi/ara-ver önerir (yapısal döner, mesajı panel `formatAmount` ile kurar
    → bakiye gizlemeye saygılı). `SavingsGoalsPanel` kart başına "Aylık gerekli"
    satırı + üstte tavsiye banner'ı. Tarayıcıda doğrulandı.
  - ~~**G3b — Kasa modu.**~~ DONE. Yeni `kasa_buckets` tablosu (migration
    `20260728120000`, RLS own-row + explicit grant + `set_updated_at` trigger;
    yerel docker'da `db:reset` + RLS/grant denetimi temiz). `kasaBucketsRepo`
    (CRUD, Result<T>), `utils/kasaMode.ts` (+4 test: `totalReservedTL`,
    `spendableAfterReserves` — likit − rezerve, aşırı ayırmada negatif). Yönetim
    UI'ı `KasaModuPanel` (PlanningPage'de, Likit/Rezerve/Harcanabilir + CRUD).
    Dashboard `SafeToSpendCard` kovaları çekip rezervi "bu ay harcanabilir"den
    düşer (`safeToSpend.ts`'e `reserved` alanı + 2 test). Planlama katmanı;
    gerçek bakiye/ledger DEĞİŞMEZ. Bu, "kasa modu / spendable balance" P2 açık
    maddesini kapatır.
- ~~**G4 — Tekrar eden kart harcaması / son harcamayı tekrarla.**~~ DONE.
  `cardsRepo.fetchRecentCardExpenses` son 40 kesinleşmiş hareketi veri katmanından
  yükler; `utils/expenseRepeat.ts` yalnız peşin hareketleri açıklama bazında
  Türkçe arama normalizasyonuyla tekilleştirip en yeni 6 öneriyi üretir. Hızlı
  harcama panelindeki çip tek dokunuşla kart, tutar, açıklama ve kategoriyi forma
  doldurur; kullanıcı kaydetmeden önce alanları değiştirebilir. Taksit/provizyon
  akışları bilinçli olarak tekrar önerisine girmez. Kayıt sonrasında öneriler
  tazelenir; saf seçim davranışı 4 birim testiyle korunur.
- ~~**G5 — Web Push v1.1: tür toggle'ları + sessiz saatler + son gönderim.**~~ DONE.
  Yeni `notification_preferences` tablosu (migration `20260729120000`, user_id PK,
  RLS own-row + grant + `set_updated_at`; yerel docker + authenticated REST
  round-trip ile doğrulandı). `notificationPreferencesRepo` (get/upsert +
  `fetchLastNotification`). `utils/notificationPreferences.ts` (+6 test): tür→tercih
  eşleme + sessiz saat (gece devri dahil); `push-notify` edge fonksiyonu ikizini
  gönderim öncesi uygular (kapalı türü ve sessiz saatteki kullanıcıyı eler; test
  modu bypass; `deno check` temiz). `NotificationSettings` 4 tür toggle + sessiz
  saat aralığı + "son gönderilen" satırı (notification_log'dan). Açık P1 v1.1
  maddelerini kapatır.

## 2026-07-27 — Modern UI/UX dönüşümü, ilk dilim (DONE)

- ~~Ortak tasarım dili ve uygulama kabuğu.~~ DONE. Açık/koyu tema token'ları
  soft-neutral/premium-fintech yönünde hizalandı; gölge, radius, border ve hareket
  dili sadeleştirildi. Masaüstü sidebar/header ile mobil yüzen bottom-nav aynı
  görsel sisteme geçirildi. İlk görsel geri bildirim sonrasında ayrışma
  güçlendirildi: masaüstü sidebar kalıcı koyu yüzeye, dashboard karar kartları
  indigo ve ink imza yüzeylerine geçirildi. Bu sınıflar normal tema kapsamında
  çalışır; `prefers-reduced-motion` bloğuna taşınmamalıdır.
- ~~Dashboard pilotu.~~ DONE. "Bu ay harcanabilir" ve finansal durum aynı karar
  katmanında yan yana; bugünün odağı ikinci katmanda. Mobil hero metrikleri iki
  sütun ve negatif harcanabilir tutar tek satır. Finans matematiği/veri akışı
  değişmedi.
- ~~Font yükleme optimizasyonu.~~ DONE. Google Fonts + Fontshare render-blocking
  CSS istekleri kaldırıldı; Türkçe latin/latin-ext kapsamlı DM Sans, Manrope ve
  JetBrains Mono variable fontları uygulamadan yerel sunuluyor.
- ~~Kart import araçlarını talep anında yükle.~~ DONE. Ekstre ve güncel hareket
  import modalları ayrı lazy chunk. `CardsPage` 177,42 → 117,62 kB; gzip
  44,31 → 30,67 kB (yaklaşık %31 azalma).
- Yerel seed ile 390px mobil ve masaüstü dashboard; ayrıca Hesaplar mobil ekranı
  açık/koyu temada tarayıcıda doğrulandı.
- ~~Ortak sayfa şablonu + Hesaplar finans merkezi, ikinci dilim.~~ DONE.
  `PageCommandHeader` CRUD tabanlı sayfalara ortak başlık/açıklama/meta/araç
  hiyerarşisi sağlıyor. Hesaplar özetinde koyu imza yüzeyi; hesap bakiyesi,
  ödenebilir kart borcu ve `borç sonrası nakit` (`diffTL`) ilişkisini transfer
  aksiyonlarıyla birlikte gösteriyor. Kredi kartı yoksa sıfır değerli kart özeti
  çizilmiyor. Gerçek yerel hesap verisiyle masaüstü ve 390px mobil doğrulandı.
- ~~Uygulama çapı premium fintech görsel mimari, üçüncü dilim.~~ DONE.
  İkonlu `HubNav`; Analiz, Veri Sağlığı, Alışveriş Kararı ve Alışveriş Listesi
  için ortak `PageCommandHeader`; bütün CRUD route'larında domain label/açıklama;
  login, karar ve liste formlarında ortak `Input`/`Button`/`Card` primitive'leri
  kullanılıyor. Görsel sözleşme `docs/UI_ARCHITECTURE.md` altında kalıcılaştırıldı.
  Finans matematiği, repository çağrıları ve mutation davranışı değişmedi.
- ~~Finans varlık kartları, dördüncü dilim.~~ DONE. Hesap, kredi kartı ve altın
  lotları ortak `premium-entity-card` okuma sırasına geçti: güçlü kimlik,
  büyütülmüş ana tutar, kısa destek metrikleri, opsiyonel son hareketler ve ana
  aksiyon. Hesap/kredi kartı ızgarası masaüstünde en fazla iki sütun; Altın
  kartları iki sütun, mobilde tam genişlik. Ortak aksiyonlarda `Button`
  primitive'i kullanılıyor; finans davranışı değişmedi. Local gerçek veriyle
  1440px masaüstü ve 390px mobil doğrulandı.
- 2026-07-30 mobil regresyonu: kredi kartı satır menüsü mavi imza yüzeyinin
  `overflow-hidden` kuralıyla kesiliyordu. Dekorasyon kendi katmanında kırpılmaya
  devam ederken imza yüzeyi menü taşmasına açıldı.
- ~~Etkileşim kalitesi denetimi, beşinci dilim.~~ DONE. Görsel mimari yerinde
  ama dokunma/erişilebilirlik katmanı geride kalmıştı; 14 route 1440px ve 390px'te
  tarayıcıda ölçüldü (taşma, hedef boyutu, erişilebilir ad, kontrast):
  - Ortak `.tap-target` yardımcısı (`index.css`): görsel boyut korunurken dokunma
    alanı 44px'e çıkar. `Button`'ın `icon`/`icon-sm`/`icon-xs` boyutlarına
    uygulandı — tek yerden bütün ikon butonları kapsıyor. Metinli boyutlar
    zaten yeterince geniş olduğu için kapsam dışı.
  - Nokta düzeltmeler: kredi taksit menüsü (32px), hedef düzenle/sil (26px,
    üstelik **adsız**), alışveriş listesi işaretle/sil, hesap transfer butonu,
    aktivite yenile, CrudPage satır menüsü (`aria-label="Menu"` → satır adlı).
  - **Dokunmatikte erişilemeyen aksiyon:** alışveriş listesi sil/geri al yalnız
    `group-hover` ile görünüyordu → `hover-actions` + `@media (hover: none)`.
  - Bitişik ikon çiftlerinde genişletilmiş alan komşunun görünür kutusunu
    çalıyordu (sil, düzenle'nin sağ kenarını kapıyordu); çiftlere sahte
    genişletme yerine gerçek boyut + aralık verildi. `elementFromPoint` ile
    bütün route'larda doğrulandı.
  - `--muted-foreground` açık temada beyazda 4.94:1 ama muted yüzeyde 4.37:1
    kalıyordu → `#697084` → `#646b7f` (muted üstünde 4.70:1). Her iki temada
    ölçülebilir kontrast hatası kalmadı.
  - `SafeToSpendCard` yüzde ekini kaldırdı: Türkçe iyelik eki sayının okunuşuna
    göre değişiyor (%6'sı / %18'i), sabit `'i` yanlıştı.

- ~~Grafik renk sistemi ve parça-bütün formu, altıncı dilim.~~ DONE. Grafik rengi
  dosya başına zevk meselesiydi; üç ayrı yerde (DonutChart, AnalysisPage.wealth,
  AssetsPage) yarı-token yarı-hardcoded palet kopyalanmıştı. Ölçülen sorunlar:
  - **Durum rengi kimlik taşıyordu:** kategori dilimleri `--success`/`--warning`/
    `--destructive` ile boyanıyordu; kırmızı "Ulaşım" dilimi "kötü" diye okunuyor
    ve görsel ilke 4'ü ihlal ediyordu. `#a78bfa`/`#fb923c`/`#2dd4bf` gibi sabit
    hex'ler koyu temaya uyum sağlamıyordu; `--muted-foreground` gri olduğu için
    kimlik işi yapmıyordu.
  - **Renk veri sıralamasına bağlıydı** (`dizi[i % n]`): ayın en büyük kalemi
    değişince Market mavi'den turuncuya atlıyordu. Dokuzuncu kategori birinciyle
    aynı renge düşüyordu.
  - **"Banka" dilimi `--info` ile boyanıyordu** ve slot-1 "Nakit" ile normal
    görüşte ΔE 9.3 kalıyordu (eşik 15) — anlamca bitişik iki kavram, iki mavi.
  - Çözüm: `--viz-1..8` + `--viz-other` token'ları (doğrulanmış palet, iki tema
    ayrı basamaklandı) ve `charts/vizPalette.ts` — kanonik anahtardan sabit atama,
    döngü yok, nötr artık kovası. `dataviz` skill'inin doğrulayıcısıyla projenin
    kendi `--card` zeminlerine karşı ölçüldü: light CVD ΔE 9.1 / normal 19.6,
    dark 8.4 / 19.3, hepsi geçer.
  - **Form değişikliği:** parça-bütün için halka (donut) bırakıldı,
    `CompositionBar` (yatay yığın + sıralı etiketli satırlar) geldi. Gerekçe
    ölçüldü: halka sarmalı doğrusal dizide olmayan bir komşuluk üretiyor (son
    dilim ilk dilime değiyor) ve koyu temada slot-7↔slot-1 protanopide ΔE 1.9'a
    düşüyordu; ayrıca yay açısı büyüklük karşılaştırması için kötü bir kanal
    (%6,5 ile %5,0 halkada okunmuyor) ve "Nakit (USD)" gibi uzun adlar halka
    çevresine sığmıyordu. Yığında sarmal yok → komşuluk = doğrulanmış slot
    komşuluğu; kapasite kısıtı da ortadan kalktı (7 kategori de görünüyor).
    `DonutChart.tsx` silindi.
  - Efsane satırları artık gerçek buton: dilimler yalnız hover ile seçilebiliyordu,
    dokunmatikte hiçbir dilim etkinleştirilemiyordu.
  - `formatCompactCurrency` ortak: eksen `₺1.787.291`'i "₺1787K" yazıyordu, milyon
    basamağı ve işaret yoktu; takvim hücresindeki kopya biçimlendirici kaldırıldı.

- ~~İmza yüzeylerinde dekorasyon içeriğin üstüne biniyordu + Lighthouse kırılganlığı.~~ DONE.
  Tarayıcıda gözle bakınca çıktı; ölçüm denetimleri kaçırmıştı (katmanlı gradient
  zeminde arka plan çözümlenemiyor):
  - `.dashboard-signature-hero::after` / `.accounts-signature-hub::after` dekoratif
    halkaları `z-index:auto` ile ağaç sırasında en son boyanıyor, yani **içeriğin
    üstüne** geliyordu; 40/80px yayılan box-shadow'ları sağ-alttaki istatistik
    kutusunu yıkıyordu. `isolation:isolate` + `z-index:-1` ile arkaya alındı.
  - Aynı kartlarda `--info` yeniden basamaklandırılmamıştı (diğer semantikler
    öyleyken); "Bekleyen tahsilat" küresel orta maviyle yazılıp koyu zeminde
    kayboluyordu → `#93c5fd` (~9:1).
  - Lighthouse exit 124 takibinin ilk adımında `npx @lhci/cli` indirmesi
    **ölçüm penceresinin dışına** alındı: prefetch + `~/.npm/_npx` cache'i ve açık
    `LHCI_VERSION` job env'i eklendi. Takip koşularında indirme tamamlanmasına rağmen
    runner Chrome 150 + LHCI 0.14.0 ölçümü 90 saniye sınırına tekrar ulaştı. Araç
    0.15.1'e yükseltilip pencere genişletilince gerçek hata görünür oldu: çalışan
    login formuna rağmen sekme `NO_FCP` üretiyordu. Headful + Xvfb koşusu da aynı
    sonucu vererek Chrome görünürlük varsayımını eledi. Kök neden tüm rotayı
    `fade-in-up` ile ilk karede `opacity:0` yapan page transition'dı; audit sekmesi
    ilerlemeyince sayfa hiç boyanmıyordu. Route geçişi opacity içermeyen
    `route-slide-in` animasyonuna taşındı. PR/gece ölçüm sınırları 180/420 saniye,
    job sınırı 10 dakikadır; takılan süreç TERM + 15 saniyelik KILL ile sonlu kalır.
    Gizli `.lighthouseci` çıktısı artifact filtresinden kaçmasın diye hidden-file
    upload açıldı ve rapor eksikliği artık job'ı kırar.
  - `ÖDEME ALARMI` kartında `items-start` sol sütunu tepeye çivileyip altında
    ~180px boşluk bırakıyordu → dikey ortalandı.
  - **Yüzde biçimi Türkçe değildi:** tutarlar `₺1.150.000,00` iken yüzdeler
    `%59.9` / `(+16.2%)` çıkıyordu (nokta ondalık, % sayının arkasında). Ortak
    `formatPercent` eklendi: `%59,9`, `+%16,2`.
  - PR incelemesinde iki sınır vakası kapatıldı: kısa para biçimi milyon eşiğinde
    `₺1.000K` yerine `₺1M` üretir; `CompositionBar` hover/focus önizlemesini
    kalıcı dokunma/klavye seçiminden ayrı tutar, böylece click seçimi geri kapanmaz.

## 2026-07-27 — "En iyi versiyon" yol haritası (F serisi, TAMAMLANDI)

Hedef değişti: daha çok özellik değil, **daha az manuel emek + hâlâ dürüst
rakamlar**. Durma kriteri (kullanıcıyla kararlaştırıldı): aylık manuel giriş
< 10 dk, haftalık mutabakat farkı < ₺50, "Diğer" kategori oranı < %15.

- ~~**F1 — Harcama kaynağı ölçümü.**~~ DONE. `card_expenses.source` kolonu
  (migration `20260727140000`, check constraint + index). `add_card_expense`
  RPC'ye `p_source` eklendi (eski 8 argümanlı imza düşürüldü — aksi halde
  aşırı yük belirsizliği). Yazma yolları etiketlendi: hızlı harcama `manual`,
  fişten dolduruldu ise `receipt_scan`, ekstre import `statement_import`,
  hareket import `movement_import`, parse-sms `sms`. `pay_payment`/carryover
  yolları kolonu yazmaz (yeniden yazmak yüksek riskli) — istemci tarafı note
  metninden türetir.
- ~~**F2 — Otomasyon kapsamı paneli.**~~ DONE. `utils/automationCoverage.ts`
  (+7 test): kaynak dağılımı, otomasyon oranı (bilinmeyen kayıtlar paydaya
  KATILMAZ, eski veri oranı haksız düşürmesin). `AutomationCoveragePanel`
  `/veri-sagligi/islemler` altında. `fetchUnrecognizedSmsLog` ile kaçan SMS
  formatları çıkarılabilir.
- ~~**F3 — Güven kalibrasyonu.**~~ DONE. `utils/dataConfidence.ts` (+5 test):
  üç seviye (`exact` / `estimate` / `stale`); `exact` rozet BASMAZ (güvenilir
  rakamı işaretlemek gürültü). `components/ui/confidence-badge.tsx` ortak dil;
  kart kontrol merkezi ve kart listesindeki borç rakamları mutabakat yaşına göre
  etiketlenir (`RatesBanner`'daki bayat kur rozetiyle aynı dil).
- ~~**F4 — Tek sayı: harcanabilir tutar.**~~ DONE. `utils/safeToSpend.ts`
  (+7 test) + `SafeToSpendCard` dashboard'un tepesinde; tampon localStorage'da
  düzenlenebilir. `CashFlowSummary.expectedIncome` eklendi. **Mobil turda bug
  yakalandı ve düzeltildi:** boş hesapta tutar tampon yüzünden negatif çıkıp
  "yükümlülükler parayı aşıyor" sahte alarmı veriyordu → `negativeCause`
  ('obligations' | 'buffer') ayrımı; yalnız gerçek açık kırmızı.
- ~~**F5 — Karar anı.**~~ DONE. `utils/purchaseImpact.ts` (+6 test) +
  `/alsam-mi` (QuickActions'ta ilk sıra). Kartla alımda ilk taksitin bir sonraki
  ekstrede nakde döndüğü modellenir. Yeni matematik yok; forecast + safeToSpend
  üstüne kurulu.
- ~~**F6 — Mobil gerçeklik turu.**~~ DONE (375px, yerel dev + seed). 10 rotada
  yatay taşma **0**. Dokunma hedefi düzeltmeleri: tampon butonu 90x20 → min 36px,
  HelpTooltip görsel boyut korunarak hit alanı 40px, SMS panel toggle 28 → 44px.
  **Ayrıca yerel giriş bozukmuş:** `seed.sql` `gen_salt('bf')` cost 6 üretiyor,
  güncel GoTrue reddediyor ("Invalid login credentials", DB'de hash doğru
  görünürken) → cost 10 verildi. Belgelenmiş `dev:local` akışı yeniden çalışıyor.
- ~~**P — Panel ayıklama.**~~ DONE (2026-07-27, kullanıcı 40 panellik listeyi
  gözden geçirip "önerilerin tamamını uygula" dedi). **17 panel kaldırıldı,
  2 panel katlandı.**
  - *Özet (20 → 8):* kaldırılan — Bu ay ödeme yükü, Kredi kartları, Bütçe
    uyarıları, Nakit takvimi (30 gün), Aylık nakit akışı, Güncel borç toplamları,
    Analiz özeti, Akıllı içgörüler, Hedef ilerlemeleri, Harcama radarı, Limit
    grupları, Maaş nabzı. Kalan: veri sağlığı şeridi, **Bu ay harcanabilir**,
    Finansal durum, Bugünün odağı, Ekstre hatırlatma, Yaklaşan vadeler,
    Ekstre mutabakatı, Son işlemler (+ borç/limit metrik kutuları).
  - *Analiz (12 → 9):* kaldırılan — Dönem karşılaştırması, 6 aylık gelir/ödeme
    yükü, Nakit akış takvimi (Özet'teki takvimle çakışıyordu).
  - *Detay (8 → 4 + 2 katlı):* kaldırılan — Kredi uygunluğu, FIRE. Katlandı
    (istenince açılır) — Yıl sonu özeti, Zekât hesaplayıcı.
  - Silinen util'ler: `periodComparison`, `fullMonthCalendar`,
    `loanAffordability`, `fire` (+ testleri) ve `buildSmartInsights`.
    `spendingAnomalies` KALDI (analysisView hâlâ kullanıyor).
  - Bundle 528 → **510 kB** gzip; Özet sayfası hesaplama yükü de azaldı
    (creditLimitGroups/salaryTrend/nextMonthLoad artık hesaplanmıyor).
  - Gerekçe: aynı soruya cevap veren paneller çakışıyordu (harcanabilir tutar
    ödeme yüküyle, hero borçla, odak içgörüyle). Silinenlerin verisi kaybolmadı;
    hepsi kendi sayfasında (kartlar, ödemeler/hedefler, analiz) duruyor.

## 2026-07-27 — Güvenilirlik paketi A/B/C/D (DONE)

Risk haritasından çıkan dört paket. En büyük iki kazanç: property testinin
bulduğu gerçek tarih bug'ı ve migration/üretim grant sapması.

**A — Görünürlük & tutarlılık**
- ~~Aylık rapor "Nakit çıkışı" artık GERÇEKLEŞEN ödemelerden.~~ Yeni saf util
  `utils/realizedCashFlow.ts` (+5 test) işlem geçmişini okur; kart talimatlı
  ödemeler nakit sayılmaz, "geri alındı" satırları netleştirilir. Projeksiyon
  (dashboard kalan yükü) ile rapor artık bilinçli olarak ayrı ve etiketli.
- ~~Net değer snapshot'ı app açılışına taşındı.~~ `app/useDailyNetWorthSnapshot.ts`
  Layout'a bağlı, günde bir; cache doluysa ek ağ turu yok. Analiz sayfası artık
  yalnız okur (`fetchNetWorthSnapshots`). Seri artık Analiz hiç açılmasa da dolar.
- ~~Bayat kur rozeti.~~ `formatSnapshotAge` (+test) + RatesBanner'da amber rozet
  ("Güncellenemedi · 3 gün önce"); bayat kur sessizce yanlış varlık değeri
  göstermesin.
- ~~Import'ta atlanan satır görünürlüğü.~~ Okunamayan satırlar artık sayı değil
  liste: açılır dökümle ham satırlar gösterilir.

**B — Test güvence ağı**
- ~~Tarih sınırı property testleri.~~ `utils/dateBoundaries.property.test.ts`
  (fast-check, 3000 koşu): kırpma, dönem kapsama, ardışıklık, vade sınırları.
  **GERÇEK BUG BULDU:** kesim günü 30 / vade günü 31 olan kartta 30 çeken aylarda
  ve Şubat'ta son ödeme tarihi ekstre tarihiyle AYNI güne düşüyordu ("bugün
  kesildi, bugün son ödeme"). `cardStatement.ts` düzeltildi + hedefli regresyon
  testi eklendi.
- ~~Parser golden-file altyapısı.~~ `utils/__fixtures__/parsers/*.txt` +
  `parserFixtures.test.ts`: yeni banka formatı eklemek = dizine dosya bırakmak.
  Yapısal invariantlar (tarih/tutar/kategori/taksit tutarlılığı, atlanan satır yok).
- ~~Bakım catch-up idempotency testi.~~ `supabase/tests/maintenance_catchup.sql`
  + `npm run db:test:catchup`: bakım RPC'leri iki kez koşturulur, ikinci koşu
  yeni ekstre/borç/ledger olayı üretmemeli. CI'ın migration job'una eklendi.

**B3b — Migration/üretim grant sapması (yeni bulgu)**
- ~~`authenticated` rolü için eksik tablo yetkileri migration'a alındı.~~
  Yerel docker'da `select ... from public.cards` **permission denied** veriyordu:
  erken tablolar (cards, assets, payments, card_expenses, transaction_history,
  net_worth_snapshots ...) üretimde arayüzden oluşturulduğu için yetkiliydi ama
  migration dosyalarında `grant` satırı yoktu. Üretim çalışırken yerel çalışmıyor
  = **yerel doğrulama yanıltıcıydı**. Yeni migration
  `20260727120000_grant_authenticated_table_privileges.sql` (grant idempotent,
  üretimde no-op). Denetim `supabase/tests/grants_audit.sql` +
  `npm run db:audit:grants:local` + CI adımı: policy'si olup grant'i olmayan
  tablo = ölü policy → kırmızı. Denetim ayrıca `wishlist_items`'ı da yakaladı.

**C — Akış**
- ~~Hareket importuna akış-içi mutabakat.~~ Import bittiğinde "bankadaki gerçek
  borç" sorulur; `Farkı kaydet` / `Farkı düzelt` (ters kayıt) aynı ekranda.
  Doğrulama için ayrı ekrana gitme ihtiyacı kalktı.
- ~~Mutabakat kadansı 7 güne indi + haftalık push.~~ `STALE_AFTER_DAYS` 30→7;
  `push-notify` Pazartesi bildirimi (`reconciliation_stale_weekly`, referenceId
  hafta başı → haftada en fazla bir kez).

**D — Süreç**
- ~~Restore tatbikat runbook'u.~~ `docs/RESTORE_DRILL.md`: şifreli artifact →
  gpg çöz → yerel docker'a yükle → RLS/grant denetimi → uygulamayı yedekle aç →
  veri sağlığı. Sonuç kaydı tablosu içinde; ilk tatbikat henüz koşulmadı.

## 2026-07-26 — Prod inceleme turu düzeltme paketi (DONE)

Canlı uygulama + kod incelemesinden çıkan bulgular tek pakette kapatıldı:

- **Ay sonu nakit sahte açığı düzeltildi.** `buildMonthlyCashFlow` cari ayda dönem içi harcamayı ay-başı perspektifiyle geçmiş vadeye (ör. 14 Tem) yazıp bugünkü nakitten bir kez daha düşüyordu (−₺53k sahte alarm; Analiz forecast'i ile çelişki). Yeni `remainingOutflow` alanı bugün perspektifiyle hesaplanır; `projectedCash` ve dashboard "Bu ay ödeme yükü" paneli artık kalan yükü gösterir. Ay-görünümü alanları (rapor/trend) değişmedi. Regresyon testleri `financeSummary.test.ts`'te.
- **Abonelik dedektörü ≥3 ay** (`subscriptions.ts`): 2 ay eşiği OPET benzin gibi tesadüfi tekrarları abonelik sayıyordu.
- **Aktivite akışı**: sıfır tutarlı ledger olayı (reclass) artık yönsüz — "−₺0,00" basılmıyor; `reclass` türüne Türkçe etiket eklendi.
- **Kategori hafızası importa bağlandı**: `parseDenizBankStatement` / `parseDenizBankMovementPdf` / `parseStatementText` artık `CategoryMemory` alır (modallar `useCategoryMemory` geçirir). Yeni `CategoryCleanupPanel` (`/kartlar?section=islemler`) "Diğer"de kalan harcamaları satıcı bazında gruplar, tek seçimle kategiler ve hafızayı tazeler → sonraki importlar öğrenir. (Bulgu: aylık harcamanın %71'i "Diğer"deydi.)
- **Takvim sadeleştirme**: Analiz'deki duplicate "Finans takvimi" paneli kaldırıldı (tek takvim /odemeler + Nakit akış takvimi); Nakit akış takvimi geçmiş günleri soluk gösterir, bakiye yalnız bugünden ileri basılır, statlar "kalan" olarak etiketlendi.
- **Sessiz gün + Finansal başarımlar panelleri kaldırıldı** (süs; `utils/quietDays.ts`, `utils/milestones.ts` + testleri silindi). Bundle 600→518 kB gzip.
- **FIRE gürültü koruması**: net değer trendi <60 günse varsayılan birikim maaş−gider olur (kısa pencere negatif "ulaşılamıyor" gürültüsü kesildi), açıklayıcı not gösterilir.
- **Varlıklar sayfası** toplamı dashboard tanımıyla hizalandı (banka bakiyeleri dahil; "Nakit (banka dahil)" + donut'a Banka dilimi).
- **Ekstre arşivi** Analiz→Detay'dan `/kartlar?section=ekstreler`'e taşındı (`StatementArchivePanel`).
- **Lighthouse CI non-blocking** (`continue-on-error`): kronik NO_FCP flake main'i kırmızı göstermesin; rapor artifact'ı sürüyor.

## P0 - High Confidence / High Value

- ~~Break large finance-heavy page files into smaller domain modules without changing behavior.~~ DONE.
  - All four candidates split: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions).
  - `DataHealth.logic.ts` further split: guide/presentation → `DataHealth.guide.ts`, undo/export → `DataHealth.actions.ts`, domain check functions → `DataHealth.checks.ts`; `DataHealth.logic.ts` is now a thin orchestrator (~160 lines) with types + `buildIssues` delegation.
- ~~Finish Faz C money cleanup (ledger integer-kuruş conversion).~~ DONE.
  - `financeSummary.ts` fully migrated: `sum()` delegates to `sumTL`, all direct float additions use `sumTL([...])`, subtractions use `diffTL`, `clampCardBreakdown` operates in kuruş internally. No float TL arithmetic remains in the aggregation layer.
  - Rounding/comparison sweep was already done: all TL sums route through `roundTL`, and `+0.01` tolerances use `exceedsTL`/`moneyDiffers`. The remaining bare `Math.round(x*100)/100` sites (`fire`, `realValue`, `marketRates`, `goldLedger`) are intentionally NOT money (display/rate/quantity precision) and are commented as such — do not route them through `money.ts`.
  - Repo/service layers were already clean (no money arithmetic, only DB queries/RPCs).
- ~~Extract shared account movement helpers for account-backed RPCs.~~ DONE.
  - Bank debit/credit row locking, ownership checks, type checks, balance validation, and balance updates now live in internal `private.debit_bank_account` / `private.credit_bank_account` helpers.
  - User-facing RPCs keep their existing contracts and transaction-history writes; helpers are not exposed as public RPCs.
- ~~Maintain the documented source of truth for card debt transitions in `docs/CARD_DEBT_TRANSITIONS.md`.~~ DONE.
  - expense added
  - provision posted
  - statement cut
  - debt paid
  - 2026-06-15 review added credit-card funded `pay_payment`, ledger repair/correction, reset flow, and shared debt-breakdown helpers.
  - 2026-06-15 follow-up verified the transition matrix against `docs/RPC_ACTION_REFERENCE.md`, current card repositories/services, and latest card migrations; future behavior changes should update the source-of-truth doc in the same change.
- ~~Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.~~ DONE.
  - ~~normalized upcoming obligations view~~ DONE for dashboard upcoming, analysis calendar, payments-page obligation calendar, payment drawer intents, forecast buckets, and dashboard monthly load.
  - 2026-06-15 audit refresh moved the completed CardsPage module split out of remaining work and narrowed the open banking UX candidate to data-health maintenance polish.
  - 2026-06-15 data reset flow now takes an automatic JSON backup before calling the destructive reset RPC.
  - 2026-06-15 audit closeout moved the last notes into future-maintenance guidance; no P0 banking simplification candidate remains open.

## P1 - Product / Reliability

- ~~Add success/error visibility for the SMS automation pipeline.~~ DONE.
  - 2026-06-26: `sms_log` table records every `parse-sms` outcome (card_expense/account_movement/unrecognized, success/error + error detail). New `SmsLogPanel` (collapsed by default, error-count badge) renders the last 20 entries on `/veri-sagligi/islemler`, kept off the frequently-opened `CardsPage`/`CardAliasPanel`.
- ~~Complete roadmap Y1 server-side Web Push sender.~~ DONE.
  - `push-notify` Supabase Edge Function sends VAPID-signed Web Push notifications for tomorrow's planned payments, tomorrow's loan installments, 3-day card statement cut reminders, and Monday weekly summaries.
  - `notification_log` prevents duplicate user/type/reference sends, and stale 404/410 endpoints are removed from `push_subscriptions`.
  - GitHub Actions invokes the sender daily at 04:00 UTC (07:00 Turkey time).
- Add Web Push v1.1 controls and observability.
  - ~~Add a "test bildirimi gönder" action from the notification settings UI.~~ DONE.
    - 2026-06-21: Bildirim ayar kartı mevcut browser aboneliğini Supabase kaydıyla self-heal eder; VAPID public key değişmişse cihaz aboneliğini yeniler. `push-notify` authenticated test mode, kullanıcının kendi endpoint'ine gerçek Web Push payload'u gönderir.
  - ~~Let the user enable/disable payment, loan installment, statement cut, and weekly summary notifications separately.~~ DONE (2026-07-29, Faz G/Madde 5): 4 tür toggle `notification_preferences`'te; edge fonksiyonu kapalı türü eler.
  - ~~Show last push run / last sent notification status in the settings card.~~ DONE: ayar kartı `notification_log`'dan son gönderilen tür + tarihi gösterir.
  - ~~Add quiet-hours handling so scheduled notifications are not sent during user-defined silent hours.~~ DONE: sessiz saat aralığı (gece devri dahil); edge fonksiyonu Istanbul saatiyle pencereyi atlar.
- ~~Reduce fallback logic that depends on missing Supabase schema cache or missing RPC deployment.~~ DONE.
  - Legacy `add_card_expense` retry against the retired 4-argument RPC signature was removed; the canonical RPC now surfaces missing-capability instead of silently falling back.
  - App-start finance maintenance no longer suppresses missing `post_due_card_auto_payments` / `cut_due_card_statements`; migration drift now surfaces through the shared missing-capability message.
  - Cards-page due statement automation now reports missing `cut_due_card_statements` deployment instead of silently skipping the cut.
  - Ledger and live-reconciliation panels now show shared migration-drift warnings instead of disappearing when optional tables are missing.
- ~~Improve visibility of migration/version mismatches between frontend expectations and live database state.~~ DONE.
  - Missing schema/RPC errors now share `missingSupabaseCapabilityMessage`, which calls out migration/RPC deployment drift and includes Supabase codes when available.
- ~~Document and standardize transaction history side effects for all finance mutations.~~ DONE.
  - `docs/TRANSACTION_HISTORY.md` now defines activity-feed role, type/source conventions, current RPC side effects, and no-history repair rules.
- ~~Review whether recurring payments, loan installments, and card installments can be unified under a clearer planning model.~~ DONE.
  - `docs/PLANNING_MODEL_REVIEW.md` keeps separate write tables, names `FinanceObligation` as the shared read-side projection, and lists the remaining low-risk cleanup.

## P2 - UX / Maintainability

- ~~Fix chronic CI failures and gate deploys.~~ DONE.
  - 2026-07-02: Kök neden = Dependabot'un playwright'ı yükseltmesi ama ci.yml'deki sabit `mcr.microsoft.com/playwright:vX-noble` imajının geride kalması; 22 Haziran'dan beri her CI koşusu Playwright Smoke + Lighthouse'ta kırmızıydı ve deploy CI'a bağlı olmadığı için fark edilmiyordu. Düzeltme: (1) tarayıcı artık `npx playwright install --with-deps chromium` ile package-lock sürümünden kuruluyor (sabit imaj kaldırıldı); (2) deploy.yml'e `verify` kapısı (lint+test+build) eklendi — kırık push migration/Vercel'i tetiklemiyor. Öneri (elle yapılacak): "Playwright Smoke"u branch protection zorunlu kontrolüne ekle ki Dependabot auto-merge onu da beklesin.
- ~~Show completed loans in a collapsed "Tamamlananlar" section.~~ DONE.
  - 2026-07-02: `CrudPage` opsiyonel `collapsibleGroups` prop'u kazandı: bu gruplar listenin sonuna alınır ve taksitli harcamalardaki desenle aynı, varsayılan kapalı "Tamamlananlar (N)" bölümü olarak çizilir (boş grup adı = başlıksız normal liste). `LoansPage` bunu kullanır: aktif krediler başlıksız üstte, `status='closed'` krediler (sync_loan_summary trigger'ı kapatır) katlanır bölümde.
- ~~Make SMS account movement matching tolerant.~~ DONE.
  - 2026-07-02: `record_sms_account_movement` artık birebir rakam eşleşmesi bulamazsa karşılıklı içerme ile eşleştirir (SMS "4230-13300128-351" ↔ kayıtlı "13300128-351" gibi kısmi girişler çalışır; kısa taraf ≥ 6 hane). Birden fazla hesap eşleşirse işlem reddedilir; eşleşme yoksa hata mesajı kullanıcıyı "Hesap numarası" alanını doldurmaya yönlendirir. Migration: `20260702120000_tolerant_sms_account_matching.sql`.
- ~~Consolidate bank account row actions into one movement modal.~~ DONE.
  - 2026-07-02: "Transfer yap" butonu kaldırıldı; tek "Para hareketi" butonu, işlem tipi seçicisinde para geldi / para gitti / hesaplar arası transferi birlikte sunan MovementModal'ı açar (ikinci hesap yoksa transfer seçeneği pasif). "Hareketler" (account ledger paneli) satırın ⋮ menüsüne taşındı (`renderMenuActions`, `ledgerOpenIds` CardsPage'de).
- ~~Unify old-installment carryover with normal installment entry.~~ DONE.
  - 2026-07-02: `CardsPage.expense.tsx` taksit formuna "su ana kadar odenen taksit" alani eklendi. Deger 0 ise `add_card_expense`, 0'dan buyukse `record_card_installment_carryover` calisir; kalan borc eklenir ve taksit numarasi toplam plana gore devam eder.
- ~~Let card debt be paid before the statement is cut.~~ DONE.
  - 2026-07-02: Kart satırına "Borç öde" butonu eklendi (`CardsPage.openDebtPayment`). Paylaşılan ödeme çekmecesi `pay_card_debt` RPC'sini kullanır: kaynak banka hesabı seçilir, tutar düzenlenebilir (varsayılan `cardPayableDebt` = ekstre + dönem içi), ödeme önce ekstre borcundan düşülür. Ekstre kesilmeden dönem içi borç ödenebilir; provizyon ve gelecek taksitler kapsam dışı (RPC guard). Açık ekstre arşivi varken buton devre dışı — `pay_card_debt` arşiv satırını kapatmadığı için o durum ekstre ödeme akışına ait.
- ~~Add classic banking polish to account/card rows.~~ DONE.
  - 2026-07-02: Kredi karti satiri iki ana aksiyona indi; detay/import/mutabakat/taksit menude. Banka hesaplarina IBAN + kopyala, son 3 hareket ve hareket sonrasi bakiye eklendi. `useBalancePrivacy` tek goz ikonuyla tutarlari maskeler; kredi karti gorseli SMS alias son hanelerinden maskeli numara gosterir.
- ~~Flag overdue open card statements in Data Health.~~ DONE.
  - 2026-07-02: `DataHealth.checks.ts` vadesi gecmis acik ekstre arsivlerini uyarir; issue karti paylasilan `FinancePaymentDrawer` ile dogrudan ekstre odeme akisini acar.
  - 2026-07-06: Data Health runtime'da `open`/`paid` dışı legacy/pasif ekstre statüsünü görünür kılar. 2026-08-02 hardening sonrasında banka debit'i ve kart borcu hareketi olmadan `paid` normalizasyonu yapılmaz; konu manuel uzlaştırmadır.
- ~~Add DenizBank current movement PDF reconciliation.~~ DONE.
  - Cards page now opens a current movement import flow for DenizBank internet banking PDFs.
  - Pending rows import as provisions, posted spending imports as current-period expenses, payment rows are excluded, and installment rows are matched/imported with their bank installment number and exact derived date.
  - Review now lists the detected period's app spending history, keeps matched bank/app pairs collapsed by default, and starts importable rows unselected for deliberate row-by-row import.
  - 2026-06-20 update: statement/current movement imports match still-open planned payments and use `pay_payment_from_card_import`, so card-paid bills do not remain as duplicate pending obligations after import.
  - 2026-06-20 follow-up: import review selection now uses stable per-row keys, so identical-looking rows can be selected one by one; Data Health also flags exact/possible duplicate card expenses using transaction fingerprints.
  - 2026-06-20 v2: Mutabakat ekranı conflict-resolution tarzına dönüştürüldü — eşleşen/sadece bankada/sadece app'te kategorileri yan yana gösterilir, app-only harcamalar direkt iptal edilebilir (`cancel_card_expense` RPC). Mobil tarayıcılarda PDF import devre dışı.
  - 2026-06-21: Plan-ortası taksitler (2/12, 3/12 gibi) artık normal import'ta otomatik aktarılır — `recordCardInstallmentCarryover` ile geçmiş taksitler ödendi olarak, gelecek olanlar planlanmış olarak eklenir. Son taksit (12/12 gibi) tek ödeme olarak import edilir.
  - 2026-06-22 follow-up: `cancel_card_expense` taksitli harcamalarda toplam borcu tam terslerken yalnız ilgili görünür split kovasını azaltır; ekstre import, app harcamaları okunamazsa duplicate riskine girmeden durur.
  - 2026-07-06 follow-up: Ekstre/güncel hareket importlarında temiz import korundu ama artık `reset_card_import_data` kullanır; geçmiş ödenmiş ekstre arşivleri ve bağlı eski satırlar silinmez. DenizBank ekstrelerindeki `+ TL` alacak/iade satırları `post_card_debt_correction` ile negatif ledger düzeltmesi olarak işlenir, bu yüzden banka dönem borcu net tutarla eşleşir.
  - 2026-07-24 follow-up: temiz import aynı aktif döneme denk gelen ödenmiş arşivi de silebiliyordu; `reset_card_import_data` artık tüm `paid` arşivleri ve bağlı geçmiş satırları koşulsuz korur. Güncel hareket PDF'i bağımsız toplam borç taşımadığı için sentetik sıfır-fark mutabakat kaydı da kaldırıldı.
  - 2026-07-24 installment/payment follow-up: import ekranlarındaki yıkıcı temiz-import seçeneği kaldırıldı; normal eşleştirme arşivleri korur. Ekstre ve güncel hareket taksitleri ortak `importedInstallmentPlan` ile orijinal işlem günü + gerçek taksit numarasını korur. Güncel hareket importu mevcut taksit satırlarını ayrıca eşleştirir; eşleşmeyenlerde toplam taksit sayısı alınarak plan/plan-ortası carryover oluşturulur. Tam dönem içi borç ödemesi `card_current_settlements` ile hareketlere dağıtılır, vadesi gelmiş taksitleri ödenmiş yapar ve sonraki ekstreye yeniden girmelerini önler.
- ~~Kart kullanımını nakit akışından ayrı, kart-merkezli bir kontrol yüzeyinde göster.~~ DONE.
  - 2026-07-24: `/kartlar` özetinin başına ekstre, dönem içi, provizyon, gelecek taksit ve son gerçek banka mutabakatını kart bazında birleştiren `CardControlCenter` eklendi. Durumlar `mutabık / fark var / kontrol zamanı / hiç kontrol edilmedi`; gerçek banka borcu aynı özet içindeki `LiveReconciliationPanel` ile girilip düzeltilebilir. Eski kart içi yüzde etiketi bankayla karışmaması için "İç veri sağlığı" oldu.
- ~~Add bucket tracking to card_ledger for derivable debt breakdown.~~ DONE.
  - 2026-07-24: `card_ledger`'a 3 nullable bucket delta sütunu (`statement_delta_kurus`, `current_delta_kurus`, `provision_delta_kurus`) ve `reclass` kind eklendi. AFTER trigger her yazımda kova deltalarını otomatik kaydeder. `projectCardSplit(events)` TS projeksiyonu, DataHealth bucket drift kontrolü, `recompute_card_debt_from_ledger` bucket-aware RPC. 200-satır ledger fetch limiti kaldırıldı. `LiveReconciliationPanel`'a hızlı mutabakat ("Farkı düzelt") butonu eklendi — banka rakamını girip tek tıkla auditable correction, PDF import'suz.
- ~~Add "kasa modu" / spendable balance planning.~~ DONE (2026-07-28, Faz G/Madde 3b).
  - `kasa_buckets` tablosu + `KasaModuPanel` (PlanningPage): banka bakiyesi acil fon,
    vergi, tatil gibi kovalara ayrılır; gerçek bakiye değişmez (planlama overlay'i).
  - Dashboard `SafeToSpendCard` rezerve kovaları "bu ay harcanabilir"den düşer.
- ~~Add a concise developer-oriented architecture note for each major page.~~ DONE for DashboardPage, CardsPage, and DataHealthPage.
- ~~Keep `docs/AI_CONTEXT_INDEX.md` current so future AI sessions can route to the right files with less repo scanning.~~ DONE.
  - 2026-06-15 context index reflects current route/module splits, DataHealth guide/action modules, dashboard component modules, backup utilities, data-health summary, and verification playbooks.
- ~~Reduce repeated split-total helper logic.~~ DONE.
  - Card debt split, scheduled installment, and unclassified debt classification now share `financeSummary.ts` helpers across Dashboard and Data Health.
- ~~Clarify where dashboard calculations belong versus page-local calculations.~~ DONE.
  - `docs/DASHBOARD_ARCHITECTURE.md` now has a Page-Local vs Shared Calculations decision table.
- ~~Audit Turkish copy and encoding consistency across UI strings and docs.~~ DONE.
  - 2026-06-15 guard run passed and a manual mojibake signature scan found no hits across 305 source/doc/migration files.
  - 2026-06-21: RPC raise exception mesajları + note string'leri düzgün Türkçe karaktere (`ö`, `ü`, `ş`, `ı`, `ğ`, `ç`) çevrildi (migration `20260621200000`). `update_card_expense` regex'i hem eski (ASCII) hem yeni note formatını eşleştirir. Repo katmanı hata mesajları (`yuklenemedi` → `yüklenemedi` vb.) düzeltildi.

- ~~Add data health trust badge to dashboard.~~ DONE.
  - `utils/dataHealthSummary.ts` runs lightweight card-debt-split/scheduled-debt + loan-totals + limit checks from snapshot data.
  - `DataHealthBadge` component: green "temiz" or amber/red issue count with link to `/veri-sagligi`.

- ~~Split dashboard presentation panels into focused component modules.~~ DONE.
  - `DashboardPanels.tsx` now keeps hero/goal/metric/pulse pieces and shared panel types.
  - `DashboardCards.tsx`, `DashboardCashFlow.tsx`, and `DashboardInsights.tsx` own card/debt/history, cash-flow, and insight/action panels.
- ~~Dashboard UX/accessibility audit fixes.~~ DONE.
  - 2026-06-22: Dashboard loading/error states, optional alert wrappers, detail toggle ARIA/reduced-motion behavior, chart/progress labels, small touch targets, and semantic contrast tokens were tightened.

## P2 - UX / Maintainability (yeni fikirler)

- ~~Add monthly financial summary report ("Aylık Finansal Özet").~~ DONE.
  - `utils/monthlySummary.ts` + MonthlyReport paneli kategori dağılımı, ay-ay değişim, paylaşılabilir kart.
- ~~Add full-month financial calendar view ("Nakit Akış Takvimi — tam ay görünümü").~~ DONE.
  - `utils/fullMonthCalendar.ts` + `AnalysisPage.calendar.tsx`: 7 sütun takvim grid, renk kodlu günler, gün detayı, haftalık net akış, bakiye projeksiyonu.
- ~~Add financial milestones and achievements ("Finansal Başarımlar").~~ DONE.
  - `utils/milestones.ts` + MilestonesPanel: nakit eşikleri, sıfır borç, tamamlanan hedefler, net değer ATH, 3-ay düşüş serisi, sağlıklı kredi kullanımı.
- ~~Add weekly mini report via push ("Haftalık Mini Rapor").~~ DONE.
  - `push-notify/index.ts` haftalık özeti zenginleştirildi: harcama toplamı, hafta-hafta değişim %, en büyük kategori.
- ~~Add comparative period analysis ("Karşılaştırmalı Dönem Analizi").~~ DONE.
  - `utils/periodComparison.ts` + PeriodComparisonPanel: ay/çeyrek/yıl modları, kategori bazlı karşılaştırma grid.
- ~~Add subscription/fixed expense management ("Abonelik & Sabit Gider Yönetimi").~~ DONE.
  - `utils/subscriptions.ts` + SubscriptionsPanel: tekrarlayan harcama tespiti, aylık toplam, gelire oran.
- ~~Add shareable financial summary card ("Paylaşılabilir Finansal Özet Kartı").~~ DONE.
  - `utils/shareableCard.ts` + MonthlyReport "Kart" butonu: Canvas 2x retina dark-theme PNG indirme.
- ~~Add quiet day analysis ("Sessiz Gün Analizi").~~ DONE.
  - `utils/quietDays.ts` + QuietDaysPanel: sessiz gün sayısı, mevcut seri, en iyi seri, aktif gün ortalama harcaması.
- ~~Add year-end financial report ("Yıl Sonu Finansal Rapor").~~ DONE.
  - `utils/yearEndReport.ts` + YearEndReport paneli: yıllık harcama, aylık bar chart, en pahalı/ucuz ay, top kategoriler, net değer değişimi.

- ~~UI basitleştirme — progressive disclosure + dosya sadeleştirme.~~ DONE.
  - Dashboard 20 panel → 7 günlük + 13 detay; `localStorage` toggle ile gizle/göster, AnimatePresence animasyonu.
  - CardsPage `atoms.tsx` kaldırıldı (overview'e taşındı), `sections.tsx` re-export'ları temizlendi.
  - Analiz 4 sekme → 2 sekme: `AnalysisPage` (Genel+Trendler), `AnalysisDetailPage` (Servet+Kayıtlar). Eski route'lar redirect eder.

- ~~Aktivite akışı (audit trail) — tüm veri değişikliklerini tek akışta göster.~~ DONE.
  - `utils/activityFeed.ts`: card_ledger + account_ledger + transaction_history'yi birleşik timeline'a çevirir, filtreleme + tarih gruplama.
  - `pages/AnalysisPage.activity.tsx`: ActivityFeedPanel — kaynak filtresi, pagination, renk kodlu yön (inflow/outflow).
  - `data/repositories/financePanelsRepo.ts`: tüm ledger'ları çeken `fetchRecentCardLedgerEvents` / `fetchRecentAccountLedgerEvents`.

- ~~Veri modeli sadeleştirme — türetilmiş alan tutarlılık özeti.~~ DONE.
  - DataHealth sayfasına "Türetilmiş alan tutarlılığı" kartı eklendi: kart borcu, hesap bakiye, borç kırılımı ve kredi özeti sapma sayıları tek bakışta görünür.
  - Mevcut DataHealth kontrolleri (`checkLedgerDrift`, `checkCards` split, `checkLoans` totals) zaten kapsamlı; yeni kart bunları özetliyor.

- ~~Kart bazlı tutarlılık skoru — her kart için split/limit/taksit kontrolü.~~ DONE.
  - `utils/cardConsistency.ts`: kart başına borç kırılımı, limit aşımı, planlı taksit kontrolü → %0-100 skor.
  - `pages/CardsPage.list.tsx`: her kredi kartında skor badge'i (yeşil/sarı/kırmızı, tooltip ile detay).
  - 4 unit test.

- ~~3 katmanlı savunma — import sonrası otomatik kontrol yönlendirmesi.~~ DONE.
  - Import (ekstre/hareket) sonrası CardsPage'de "Veri tutarlılığını kontrol et" banner'ı gösterilir.
  - Banner, DataHealth sayfasına tek tıkla yönlendirir; "Güvenli düzeltmeleri uygula" ile toplu fix zaten mevcut.
  - Mevcut 3-katman: import (StatementImportModal / CurrentMovementImportModal) → detect (DataHealth 22 check) → fix (fixIssue + undo stack).

- ~~Add wishlist / shopping list ("Alışveriş Listesi").~~ DONE.
  - 2026-07-24: `wishlist_items` tablosu (RLS + own-row), `wishlistRepo.ts` CRUD, `WishlistPage.tsx`. PlanningHub'a "Liste" tab'ı eklendi (`/odemeler/liste`). Alınanlar ayrı bölümde üstü çizili + tarihli, geri alınabilir.

## 6-Geçiş Denetim Sentezi (2026-06-23)

6 geçişlik sistematik denetim tamamlandı. Aşağıda tüm bulgular, tekrar eden
pattern'ler ve açık düzeltme planı yer alıyor.

### Tüm bulgular

| # | Geçiş | Seviye | Bulgu | Durum |
|---|--------|--------|-------|-------|
| 1 | UX (P1) | Orta | Dashboard loading/error/ARIA/reduced-motion/touch-target | ✅ `6e51418` |
| 2 | Domain (P2) | Orta | Ledger summarize boş dizi koruması, salary trend defensive hardening | ✅ `664f6d8` |
| 3 | Data (P3) | Orta | 5 repo Result\<T\> tutarsızlığı (throw/silent → Result) | ✅ `785925d` |
| 4 | Data (P3) | Orta | dataHealthRepo hata aggregation maskeleme | ✅ `785925d` |
| 5 | Data (P3) | Orta | savingsGoalsRepo — sıralı yazma, DB transaction yok | ✅ Atomik RPC |
| 6 | Data (P3) | Orta | accountMovements TOCTOU — bakiye kontrolü row-lock'suz | ✅ Server FOR UPDATE yeterli |
| 7 | Perf (P4) | Orta | HistorySection filtreleme/gruplama useMemo + debounce eksik | ✅ `aa775f3` |
| 8 | Perf (P4) | Orta | PaymentsOverview 6 filter/sort zinciri useMemo eksik | ✅ `aa775f3` |
| 9 | Perf (P4) | Düşük | UpcomingInstallments hesaplaması useMemo eksik | ✅ `aa775f3` |
| 10 | Perf (P4) | Düşük | framer-motion vendor chunk (126KB) ilk yüklemede | ✅ CSS transition |
| 11 | Perf (P4) | Düşük | Maintenance + 15 sorgu ilk açılış latency'si | ✅ Background maintenance |
| 12 | Perf (P4) | Düşük | Liste virtualization yok | ✅ Mevcut slice(40) yeterli |
| 13 | Perf (P4) | Düşük | vendor-recharts 392KB chunk | ✅ Saf SVG chart |
| 14 | Akış (P5) | Orta | Ekstre import partial failure feedback eksik | ✅ `73d535b` |
| 15 | Akış (P5) | Düşük | cancel\_card\_expense RPC Türkçe karakter | ✅ `73d535b` |
| 16 | Akış (P5) | Düşük | Import sırasında stale snapshot | ✅ Mevcut invalidation yeterli |

**Özet: 16 bulgu → 16 düzeltildi, 0 açık**

### Tekrar eden pattern'ler

| Pattern | Etkilenen alanlar | Durum |
|---------|------------------|-------|
| Result\<T\> tutarsızlığı — repo'lar throw/swallow/Result karışık | 5 repo + 6 caller | ✅ Tamamlandı |
| useMemo eksikliği — render-path'te ağır hesaplama sarılmamış | HistorySection, PaymentsOverview, UpcomingInstallments | ✅ Tamamlandı |
| Türkçe karakter tutarsızlığı — RPC hata mesajlarında ASCII | add/update/cancel\_card\_expense, carryover, repo mesajları | ✅ Tamamlandı |
| Sıralı yazma transaction gap — birden fazla DB yazma atomik değil | savingsGoalsRepo, accountMovements | ✅ Tamamlandı |
| Vendor bundle boyutu — büyük 3rd-party chunk'lar | ~~recharts (392KB)~~, ~~framer-motion (126KB)~~ | ✅ Saf SVG/CSS |

### Açık düzeltme planı (bağımlılık sıralı)

| # | Madde | Seviye | Efor | Durum |
|---|-------|--------|------|-------|
| 5 | savingsGoalsRepo: tek PL/pgSQL RPC ile atomik upsert | Orta | M | ✅ `upsert_savings_goal` RPC |
| 6 | accountMovements: server-side FOR UPDATE locks zaten yeterli | Orta | M | ✅ Kapatıldı |
| 10 | framer-motion → CSS transition, paket kaldırıldı (−126KB) | Düşük | M | ✅ CSS dashboard-item |
| 16 | Stale snapshot → mevcut invalidation + refetchOnWindowFocus yeterli | Düşük | S | ✅ Kapatıldı |
| 12 | HistorySection zaten .slice(0,40) ile sınırlı, virtualization gereksiz | Düşük | — | ✅ Kapatıldı |
| 11 | Maintenance → background: snapshot hemen döner, maintenance bitince invalidate | Düşük | S | ✅ Background fire-and-forget |
| 13 | recharts → saf SVG chart components (DonutChart, BarChart, CashFlowChart, LineChart) | Düşük | L | ✅ −392KB vendor chunk |

**Tüm 16 bulgu kapatıldı. Toplam kaldırılan vendor ağırlığı: ~518KB (recharts 392KB + framer-motion 126KB).**

## P3 - Nice to Have

- ~~Add goal-based automatic saving suggestions.~~ DONE (G3a, `src/utils/savingsSuggestion.ts`,
  tüketici `SavingsGoalsPanel` — hedef başına aylık gereken tutar + yükümlülük-farkındalıklı öneri).
- Add guided import/restore flow for personal finance data.
  - JSON export/restore exists in Data Health, including a pre-restore safety backup.
  - CSV export exists; remaining import work is a guided CSV/manual mapping flow if that becomes useful.
- Add stronger historical analytics for cash flow and debt trend.
- Add better scenario planning around next-month and multi-month obligations.

## Suggested Next Tasks for Codex

1. ~~Reduce repeated split-total helper logic.~~ DONE.
2. Keep `docs/RPC_ACTION_REFERENCE.md` aligned when Supabase RPCs or user-visible actions change.
   - 2026-06-15 card payment, reset, and card-ledger repair/correction effects were refreshed after the card debt transition review.
3. ~~Keep `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` aligned with release workflow changes.~~ DONE.
4. ~~Continue shrinking the remaining large route files.~~ DONE — all four large page files are now split into focused modules.

## Recently Cleared / No Longer First Next Task

- 2026-07-27 CI/CD performance pass: PR CI no longer duplicates feature-branch
  push runs; E2E/Lighthouse/Supabase jobs are path-aware; Chromium, ESLint, and
  TypeScript incremental state are cached; per-change Lighthouse uses one run
  with a hard timeout while the scheduled audit keeps three. Main release runs
  the quality gate once, validates a changed database with one seeded reset,
  backs up only migrations, deploys only changed edge functions, and verifies
  one production-env artifact before a prebuilt staged upload. Scoped API
  promotion runs a production smoke check and automatically rolls back on
  failure. The former Git-auto + deploy-hook double production build and second
  promotion-time CLI install are removed. Production dependency audit is now a
  release gate; React Router moved to patched v8 and direct-main branch
  protection requires the PR flow.
- 2026-08-03 Lighthouse follow-up: Playwright Chromium completed app smoke tests
  but hung inside LHCI until the 5-minute job timeout, cancelling the whole CI
  run despite `continue-on-error`. Lighthouse now uses the GitHub runner's
  preinstalled Chrome (no second browser setup). Repeated runner Chrome 150 runs
  then exhausted the former LHCI 0.14.0 / 90-second capture window even with a
  prefetched package. The wider LHCI 0.15.1 run exposed `NO_FCP`; a headful Xvfb
  run reproduced it and ruled out the headless Chrome hypothesis. The route
  wrapper's page-wide fade started at `opacity:0` and could remain frozen in an
  audit tab, so it now uses a transform-only slide that paints on frame one.
  The 180-second PR / 420-second nightly command timeout, 10-minute job ceiling,
  and TERM→KILL cleanup remain bounded safeguards.
- 2026-07-27 Dependabot PR hygiene: patch/minor version updates remain grouped
  and auto-merge after required CI, while routine major version updates are no
  longer opened and left stale. Security updates bypass the SemVer allow filter;
  a major security upgrade remains a deliberate manual review.
- 2026-07-27 empty due-statement handling: automatic statement maintenance now
  skips cards whose current-period spending belongs entirely to the next
  statement. The expected no-op no longer appears as a red error or prevents
  other due cards from being cut; the maintenance catch-up SQL test covers the
  mixed skip-and-cut case.
- 2026-07-18 full logic-accuracy audit closed 12 findings plus one discovered
  privacy gap: quantity is mandatory for stock/fund/FX account-backed trades;
  recurring analytics use only their declared windows and avoid card-funded
  payment duplication; price radar scopes payment history; shared card limits
  feed milestones/health/consistency; milestone month comparisons, FX inflation
  classification, year average, quiet streaks and zero-value bars are corrected;
  backup coverage includes newly added user tables and exports both ledgers; null
  owner SMS diagnostics are no longer readable by authenticated users. Regression
  tests cover each calculation/source-boundary change.
- 2026-07-08 paid-statement calendar fix: `utils/obligations.ts` now derives
  current-period card cash due dates from the active statement period when there
  is no pending statement. If a July 14 statement was paid early after the July 4
  cut, new current-period spending no longer appears as a July 14 cash outflow;
  it moves to the next cycle. Covered by `obligations.test.ts`.
- 2026-07-07 varlık al/sat akışı: Assets page mevcut varlıklarda Al/Sat aksiyonları
  gösterir; kullanıcı banka hesabı seçerek alışta hesabı borçlandırıp varlığı
  artırır, satışta hesabı alacaklandırıp varlığı azaltır. `trade_asset_with_account`
  RPC'si varlık, banka bakiyesi, account ledger ve transaction history kaydını tek
  transaction'da işler.
- 2026-07-06 statement-import installment offset fix: DenizBank statement rows
  keep the original purchase date for later installments, so import now derives
  the current installment due date from `installment_no` before creating rows.
- 2026-07-06 card-installment due-date fix: installment rows now preserve the
  transaction day instead of normalizing to the 1st of the month, and
  `post_due_card_installments` moves only due scheduled rows into
  `current_period_spending` before statement cutting so boundary-day billing stays
  correct.
- 2026-06-18 Lighthouse CI now maps the GitHub Actions token to `LHCI_GITHUB_TOKEN` with job-scoped status permission, so LHCI can publish GitHub status without an extra PAT while still uploading `.lighthouseci` reports as artifacts.
- 2026-06-18 Lighthouse CI target changed to `/login`; Chrome flags, throttling mode, and FCP/load waits were hardened after GitHub runner logs showed `NO_FCP` on the unauthenticated route audit.
- 2026-06-18 Lighthouse CI now serves the built app through `npm run preview` on `127.0.0.1:4173` instead of LHCI's random-port static server, aligning it with the Playwright smoke-test network pattern after repeated GitHub runner `NO_FCP` failures.
- 2026-06-18 Lighthouse CI now runs inside the Playwright Chromium container and exports `CHROME_PATH` from Playwright, avoiding drift from GitHub runner's system Chrome channel after repeated `HeadlessChrome/149` `NO_FCP` failures.
- 2026-06-18 added loan-affordability decision support under `Analiz > Servet`: `utils/loanAffordability.ts` estimates safe monthly installment, maximum principal, a balanced recommended scenario, selected-loan payment, stress balance, and a suitable/caution/not-recommended verdict from salary, current load, cash buffer, and forward cash projection.
- 2026-06-18 UX information architecture pass split the longest scroll surfaces into hubs: Analysis now has Genel/Trendler/Servet/Kayıtlar routes, Data Health separates Bulgular from Yedek & Ayarlar, and the bottom navigation labels now read Özet/Hesaplar/Birikim/Borçlar/Takvim.
- Targeted tests now exist for `cardStatement`, `budgetAlerts`, and savings goal progress.
- `financeSummary.test.ts` covers shared credit limit grouping, payable card debt excluding provision, and recurring payment month occurrence.
- A narrow Faz C pass replaced savings-goal `+0.01` comparisons and obvious TL amount rounding sites with `money.ts` helpers.
- Faz C rounding/comparison audit closed: the non-money `Math.round` helpers (`fire`, `realValue`, `marketRates`, `goldLedger`) were classified as display/rate/quantity precision and commented in place.
- Faz C integer-kuruş conversion completed: `financeSummary.ts` `sum()` now delegates to `sumTL`; all direct float TL additions/subtractions replaced with `sumTL`/`diffTL`; `clampCardBreakdown` operates in kuruş internally. Repo/service layers were already clean.
- Account-backed money RPCs now share internal bank-account debit/credit helpers while keeping public RPC contracts unchanged.
- Cash-flow forecast now derives payment/card/loan/debt buckets from the normalized `utils/obligations.ts` engine, including open statement archives when available.
- Monthly cash-flow summaries now derive payment/card/loan/debt buckets from the same normalized obligation engine; shared payment/card cash-impact helpers were extracted to `utils/financeObligationRules.ts` to avoid a circular import.
- Local DB lint/advisor cleanup redefined the affected card RPCs without unused/shadowed PL/pgSQL loop variables, fixed `net_worth_snapshots` RLS init-plan warnings, and pinned `touch_updated_at` search_path; no public function signatures changed.
- Legacy obligation cleanup pass completed: analysis month-close payment checks now consume the normalized obligation engine, and dashboard obligation mapping no longer exposes an unused public helper.
- `docs/DASHBOARD_ARCHITECTURE.md` now documents dashboard data flow, utility ownership, normalized obligation input, panel boundaries, and verification.
- Dashboard calculation ownership is now explicit: page-local glue stays in `DashboardPage`, finance/domain math moves to the documented utility owner.
- `docs/CARDS_ARCHITECTURE.md` and `docs/DATA_HEALTH_ARCHITECTURE.md` now document page module boundaries, side-effect ownership, and verification routes for the remaining high-risk pages.
- DataHealth copy polish pass completed for the older ASCII Turkish user-visible strings; encoding guard remains green.
- Turkish copy/encoding audit repeated on 2026-06-15: `encoding.guard.test.ts`, `docs.guard.test.ts`, and a manual mojibake signature scan were clean.
- Transaction-history side effects are now standardized in `docs/TRANSACTION_HISTORY.md` and linked from the RPC/action reference.
- Planning model review completed: recurring payments, loan installments, card statements, card installments, and debt due dates should share `FinanceObligation` as a read-side projection rather than a new write table.
- Migration compatibility checklist now reflects the Lighthouse CI budget added to the release workflow.
- Missing Supabase schema/RPC detection now centralizes on `utils/supabaseErrors.ts`; page-local schema-cache wrapper aliases were removed.
- Missing schema/RPC user messages now use a shared deployment-mismatch helper with Supabase code visibility.
- Legacy `add_card_expense` RPC signature fallback was removed; missing canonical RPC deployment now follows the standard missing-capability path.
- Finance maintenance now reports missing scheduled-maintenance RPC deployment instead of silently skipping those app-start jobs.
- Cards-page due statement automation now surfaces missing statement-cut RPC deployment through the shared migration-drift message.
- Ledger and live-reconciliation panels now surface missing table deployment through the shared migration-drift message instead of silently hiding.
- `docs/CARD_DEBT_TRANSITIONS.md` now documents credit-card funded planned payments, card-ledger repair/correction flows, reset behavior, and the shared debt-breakdown helpers.
- `roundMoney` alias was removed; money rounding/comparison helpers now live in `utils/money.ts`.
- Card debt split classification now shares `financeSummary.ts` helpers for Dashboard focus actions and Data Health issues.
- `CardsPage.sections.tsx` is now a thin nav/automation module; overview, statement/provision panels, and help copy live in focused `CardsPage.*` files.
- `CardsPage.tsx` data loading, account movement, statement payment, and section navigation orchestration now lives in `CardsPage.hooks.ts`.
- `CardsPage.tsx` CRUD form mapping, card metadata renderers, limit usage extra block, bank hue styling, grouping, and row action button now live in `CardsPage.crud.tsx`; the route file is mostly orchestration and modal wiring.
- `docs/SHARED_PAYMENT_DRAWER_PLAN.md` captures the shared payment drawer migration path across planned payments, card statement/manual debt payment, loan installments, and personal debt settlement.
- Shared payment drawer phase 1 is implemented: `PaymentsPage` now uses `useFinancePaymentDrawer` and `FinancePaymentDrawer`.
- Shared payment drawer phase 2 is implemented: `CardsPage` statement payment now uses the shared drawer.
- Shared payment drawer phase 3 is implemented: `LoansPage` loan installment payment now uses the shared drawer.
- Shared payment drawer phase 4 is implemented: `DebtsPage` personal debt settlement and receivable collection now use the shared drawer.
- All four large page files split into focused modules: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions). No file exceeds ~450 lines.
- `docs/BANKING_SIMPLIFICATION_AUDIT.md` now reflects the completed CardsPage module split and no longer lists it as remaining banking-simplification work.
- `docs/RPC_ACTION_REFERENCE.md` now mirrors the refreshed card debt transition source of truth for planned card-funded payments, card resets, and ledger repair/correction.
- Data Health "Tüm veriyi sil" now downloads a reset-before JSON backup before the destructive reset call and tells the user this preflight will happen.
- Data Health JSON backup restore already exists; the remaining P3 import work is narrowed to a guided CSV/manual mapping flow.
- Dashboard presentation panels were split into focused modules without changing dashboard data ownership or utility boundaries.
- P0/P2 closeout completed: card-debt source truth, banking audit, and AI context index are current as of 2026-06-15; future drift should be handled in the change that creates it.
- 2026-06-15 data-correctness audit started before P3: forward cash projections now respect non-cash card-installment obligations, Analysis forecast input carries open statement archives like Dashboard, and the Analysis 6-month chart title now says spending/load instead of true cash flow.
- The `pay_payment` shared drawer action no longer retries the retired two-argument RPC signature or updates payment amount client-side as a fallback; missing deployment now surfaces as a migration/RPC mismatch.
- 2026-06-15 follow-up data-correctness audit fixed the Analysis financial calendar day totals: calendar events now carry settlement/cash-impact metadata, and daily net totals use `cashImpactAmount` instead of raw card load. The same pass moved attention-line and planned-obligation daily totals onto `sumTL` instead of bare `reduce` additions.
- 2026-06-16 component data-correctness audit covered all page/component TSX files by risk bucket. Fixed shared search normalization for all-caps Turkish merchant/bank names, aligned card open-statement display/tone to one visible source, and moved the remaining component-facing TL totals/deltas onto `money.ts` helpers.
- 2026-06-17 all 9 known risks mitigated: card debt math (#4) documented with trigger/test safeguards, mixed loan model (#5) documented as intentional labeled fallback, DataHealth operational power (#6) documented undo/backup/test layers, test coverage (#7) closed with `cardInstallmentCalendar.test.ts` (all aggregation utils now tested), credit limit semantics (#8) code-commented and tested.
- 2026-06-16 remaining component audit notes closed: `LoansPage` undo reference was verified absent/build-green, finance snapshot maintenance is throttled/deduped, Analysis cash-flow trend uses the salary effective for each month, due statement automation has a run-key guard, and stale closure risks in quick-expense focus, toast timers, and Analysis async queries were removed.
- 2026-06-16 salary cash-flow semantics clarified: monthly summaries and forward forecasts use the salary effective for each target month, and Dashboard exposes salary as a separate income line.
- 2026-06-29 regression fix: current-period card spending is again placed on the next card cycle's due date in `utils/obligations.ts` (it had been moved into the spending month, double-loading the current month and emptying the cycle where the cash actually leaves). This restores alignment with FINANCE_RULES.md ("counted on the next card cycle") and turns the 5 red cash-flow/monthly-summary tests green. Same pass de-duplicated date helpers (`addDays`, `startOfDay`, `dateInMonth`) into `utils/date.ts` so card-statement/obligation/calendar code shares one source.
- 2026-06-30 terminology follow-up: Dashboard/Analysis cash-flow labels now say "Nakit çıkışı" / "Kart ödemesi" for bank-cash impact, while Monthly Report surfaces "Kart harcaması" separately from existing `card_expenses` data. No accounting engine change; this avoids the false "no spending" impression without double-counting statement payments.

## Veri doğruluğu denetimi (2026-07-18)

- [x] Kartla finanse edilen tek seferlik bekleyen ödemeler net değer borcuna dahil edildi.
- [x] Gelecek tarihli maaşların güncel maaş/FIRE/kredi uygunluğu hesabına sızması engellendi.
- [x] Form ve kart-import tarihleri UTC yerine ortak yerel tarih formatına geçirildi.
- [x] FIRE kart gideri varsayımı beş tamamlanmış ayı (harcamasız aylar dahil) kullanıyor.
- [x] Yıllık raporlar için snapshot penceresi cari ay + 24 tamamlanmış aya genişletildi.
- [x] Tam-ay takvimi güncel bakiyeye geçmiş maaş ve yükümlülükleri tekrar uygulamıyor.
- [x] Aktivite yönü pozitif history tutarının işaretinden değil olay semantiğinden türetiliyor.
- [x] Kredi planı düzenlemesi ödenmiş taksitleri değiştiremiyor veya silemiyor.
- [x] Kredi kartı gecikme durumu açık ekstrenin gerçek son ödeme tarihini kullanıyor.
- [x] Aylık ödenen planlı ödeme sayısı gelecek vadeden değil gerçek history kaydından geliyor.
- [x] Sessiz gün ortalaması kartla ödenen faturayı ve ekstre ödemesini ikinci kez saymıyor.

## Mantık Denetimi Bulguları (2026-06-29)

Tüm `src/utils` hesaplama katmanı + SQL trigger'lar + DataHealth tek tek okundu.
Çekirdek muhasebe sağlam (para kuruş-hassas, ledger event-sourced + trigger-korumalı,
SQL trigger↔TS ikiz 3'ü de eşleşiyor, nakit-akışı tek motorda). **Tüm bulgular
2026-06-29'da `A→B→C→D` sırasıyla düzeltildi (her biri ayrı commit + test).**

**Tema A — Kısmi "bu ay" vs tam geçmiş baz** (Orta): bugüne kadarki kısmi ay,
tam geçmiş ay/ortalama ile kıyaslanıyordu → metrik ay-içi yanıltıcı.
- [x] `monthlySummary.ts`, `periodComparison.ts`, `spendingAnomalies.ts`, `analysisView.ts`:
  ortak `utils/monthToDate.ts` (dayOfMonthCutoff + isWithinDayOfMonth) ile current ve
  prior aynı gün-penceresine clip; periodComparison etiketleri "ilk N gün" notu taşır.

**Tema B — Aynı kavram, farklı hesap** (Orta-düşük):
- [x] 3-ay ortalama: ortak `utils/spendingStats.ts → averageOverActiveMonths()` (÷aktif-ay);
  analysisView ÷3 sabitinden buna çekildi, spendingAnomalies de aynı helper'a bağlandı.
- [x] Medyan: `spendingStats.median()` (doğru tanım); subscriptions/spendingAnomalies/
  priceIncreaseRadar üçü de buna bağlandı.

**Tema C — Değerleme / modelleme:**
- [x] Zekât: `computeZakat` artık snapshot alır, altını `effectiveAssetValue` ile
  nisab ile aynı canlı kaynaktan değerler (stale flip giderildi).
- [x] Net değer: tekrarlayan aylık ödemeler net-değer borcundan çıkarıldı (yalnız
  tek-seferlik bekleyen faturalar yükümlülük).
- [x] FIRE: `estimateMonthlySavingsFromNetWorth` getiriyi çıkarıp saf katkı döndürür;
  çağıran realReturn'ü geçirir (çift sayım giderildi).
- [x] Milestone: nakit eşiği Nakit + banka bakiyesi (totalCashAssets ile tutarlı).

**Tema D — Kırılgan ama şu an doğru** (Düşük):
- [x] Parser locale: `denizBankStatementParser.parseAmount` ondalık ayıracını konumdan
  tespit eder (iki format da güvenli).
- [x] Import fallback: açıklamasız exact/loose eşleşme yalnız tek aday varken devreye girer
  (belirsiz same-day/same-amount keyfi eşleşme önlendi).
- [x] Kart taksiti gösterim günü (`obligations.ts:232`): KASITLI ve doğru teyit edildi
  (due_month ay-başı, ödeme due_day'de, `cashImpactAmount:0`); kod değişikliği gerekmedi.
