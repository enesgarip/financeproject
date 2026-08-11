# Uygulama Geneli Denetim Raporu — 2026-08-12

> Kapsam: `src/` altındaki TÜM kaynak dosyalar (utils, data, services, app, hooks, pages,
> components), `supabase/` (migrationlar, edge fonksiyonları, pgTAP testleri), `docs/` ve
> canlı UI turu (yerel docker + seed verisi ile tüm rotalar gezildi, kritik bulgular canlı
> doğrulandı). Yöntem: 10 alan denetim ajanı dosyaları tek tek okudu; KRİTİK/YÜKSEK bulgular
> ana oturumda koddan ve tarayıcıdan ikinci kez doğrulandı. Bulgular tekilleştirildi.
>
> Bu rapor tespit dokümanıdır — düzeltmeler ayrı fazlarda ele alınmalı (bkz. §12).

---

## 1. En kritik bulgular (öncelik sırası)

| # | Önem | Bulgu | Yer |
|---|------|-------|-----|
| K1 | KRİTİK | "Tutarları gizle" modu string içine gömülü tutarlarda deliniyor (canlı doğrulandı: maskeliyken odak kartında "1.000,00 ₺ provizyon bekliyor" görünüyor) | `utils/attention.ts:53,63,75`, `utils/dashboardInsights.ts:130,155`, `utils/statementReminder.ts:88`, `utils/analysisView.ts:285-318`, `utils/dashboardUpcoming.ts:62` |
| K2 | YÜKSEK | İlk girişte sonsuz "Dashboard yükleniyor": oturum token'ı hazır olmadan atılan snapshot sorguları 401 alıyor; retry yok, kullanıcı elle yenilemek zorunda (canlı doğrulandı) | AuthProvider ↔ useFinanceSnapshot yarışı |
| K3 | YÜKSEK | `post_card_provision` regresyonu: 20260811100000 migration'ı 20260706130000 + 20260802130000'in davranışlarını (taksit `due_month` = işlem günü; vadesi geçmiş tüm taksitler posted) kaybetti — yeni kesinleşen provizyonlar ay-başı tarih modeliyle doğuyor | `supabase/migrations/20260811100000:13-197` |
| K4 | YÜKSEK | Açık ekstre + `pay_card_debt` → çift banka borçlandırması mümkün: kova ödenir ama arşiv açık kalır; ardından `pay_card_statement` aynı tutarı ikinci kez hesaptan düşer (DB katmanında engel yok) | `supabase/migrations/20260810140000:23-360, 370-513` |
| K5 | YÜKSEK | Altın grafiği maliyeti yanlış: satışta maliyet havuzundan **satış bedeli** düşülüyor (ağırlıklı ortalama maliyet yerine); kârlı satış maliyeti 0'ın altına itebilir. Doğru util (`buildGoldAccumulation`) aynı repoda duruyor ama kullanılmıyor | `pages/GoldPage.tsx:134-151` vs `utils/goldLedger.ts:102-128` |
| K6 | YÜKSEK | Mutabakat tutar girişinde elle parse: "1234.56" → **123.456 TL** okunur ve "Farkı düzelt" bu farkı ledger'a düzeltme olarak yazar (`parseNumber` kullanılmalı) | `components/finance/CurrentMovementImportModal.tsx:545` |
| K7 | YÜKSEK | Açık ekstre varken asgari/kısmi ödeme fiilen imkânsız (banka gerçeğine aykırı): "Borç öde" kapalı + ekstre çekmecesinde tutar düzenlenemez | `pages/CardsPage.list.tsx:315`, `services/financePaymentActions.ts:79-84` |
| K8 | YÜKSEK | Kırık sekme linki: `/kartlar?section=ekstre` (doğrusu `ekstreler`) → kullanıcı Özet'e düşer | `pages/LiabilitiesCardsPage.tsx:224` |
| K9 | YÜKSEK | CSV dışa aktarım varsayılanda yalnız 12 kayıt indiriyor (arama boşken `slice(0,12)` üzerinden export) | `pages/AnalysisPage.reports.tsx:307-323` |
| K10 | YÜKSEK | Aynı dashboard'da iki farklı "ay sonu" rakamı: hero "Ay sonuna kalan" (tampon+rezerv düşülmüş) vs odak kartı "Ay sonu" (düşülmemiş) — canlı: 26.190 ₺ vs 51.190 ₺ | `SeritOverview.tsx:124-141` vs `DashboardInsights.tsx:48-51` |
| K11 | YÜKSEK | "Harcanabilir" etiketi iki farklı formüle yapışık: Kasa paneli `likit − rezerv`, kanonik hesap `buildSafeToSpend` (yükümlülük+tampon da düşer). Aynı etiket, büyük fark | `utils/kasaMode.ts:16-21` + `KasaModuPanel.tsx:156` vs `utils/safeToSpend.ts` |
| K12 | YÜKSEK | Ortak limit grubu iki yüzeyde çift sayılıyor (kart başına `credit_limit` toplamı; `buildLimitGroupSummaries` dururken) → iki farklı "limit kullanımı" yüzdesi | `pages/CardsPage.hero.tsx:31`, `pages/LiabilitiesCardsPage.tsx:162` |
| K13 | YÜKSEK | `financeSummary.buildFinancialPosition`: "gelecek taksit borcu" kart başına değil agregada hesaplanıyor — bir karttaki split taşması diğer kartın gerçek taksit borcunu sessizce netler | `utils/financeSummary.ts:346-352` |
| K14 | YÜKSEK | Guard arşiv Result'ı yutuluyor: temiz import sonrası koruma satırı yazılamazsa sonraki bakım aynı dönemin üstüne ekstre keser (çift işleme) | `CurrentMovementImportModal.tsx:389,396` + `data/repositories/cardsRepo.ts:331` |
| K15 | YÜKSEK | Kısmi/tam borç kapama kararı çıplak float `<` ile: float tozu taşıyan borçta kullanıcının "tam" ödemesi kısmi işlenir, borç ~0,0000000002 TL açık kalır | `services/financePaymentActions.ts:172` |
| K16 | YÜKSEK | Kasa rezervi hata durumunda sessizce 0'a düşüyor → "Harcanabilir" rezerv kadar ŞİŞER (D4 düzeltmesinin hata-yolunda geri gelmesi) | `hooks/useSafeToSpend.ts:44-58` |
| K17 | YÜKSEK | LineChart `connectNulls: false` no-op: veri boşlukları her zaman düz çizgiyle birleştiriliyor — eksik ay gerçek trend gibi görünür | `components/charts/LineChart.tsx:55,124-133` |
| K18 | YÜKSEK | SMS akışında tenant sınırı zayıf: `record_sms_account_movement` `p_user_id`siz çağrılıyor; kart alias sorgusu kullanıcı filtresiz (tek kullanıcıda pratik risk düşük, yapısal olarak düzeltilmeli) | `supabase/functions/parse-sms/index.ts:410,505-518` |

## 2. Klasik bankacılığa aykırılıklar

- **Asgari ödeme yanlış taban + sabit oran:** asgari = `intent.amount × 0.2`; taban ekstre değil ekstre+dönem içi; oran limite göre %20/%40 değişmiyor (`FinancePaymentDrawer.tsx:73`, `financePaymentActions.ts:86-88`).
- **Dönem içi harcamaya "Son ödeme yaklaşıyor" rozeti:** açık ekstre yokken due_day fallback'i ile vadesi olmayan borca vade uyarısı (`CardsPage.helpers.ts:188-221`, `LiabilitiesCardsPage.tsx:253-257`).
- **Taksit yuvarlaması toplamı tutturmuyor:** `expectedInstallmentAmount(100,3)=33,33` → 99,99≠100; bankalar son taksitte düzeltir. Aynı desen `purchaseImpact.ts:58`, `cardsRepo.ts:392`, carryover kuruş kaybı `CardsPage.expense.tsx:73-75` (SQL ikizi dahil).
- **Ekstre kesimi yalnız sayfa ziyaretinde:** `/kartlar` açılmazsa kesim gecikir; kesim istemci tarafında (`CardsPage.sections.tsx:73-141`). pg_cron bakımı var ama UI kesim yolu client-side.
- **Kredi taksitlerinde sıra zorlanmıyor:** 12. taksit 7.'den önce ödenebiliyor (her satırda bağımsız "Öde"; canlı gözlem, LoansPage).
- **Alacaklar net değere dahil değil:** "Bekleyen tahsilat" ayrı gösteriliyor (bilinçliyse belgelenmeli; muhasebe açısından alacak varlıktır).

## 3. Aynı bilgiyi tekrar sunan yüzeyler

- **Kart borcu kırılımı (Ekstre/Dönem içi/Provizyon/Gelecek taksit) ≥11 yüzeyde**; üçü fiilen farklı matematik kullanıyor. "Açık ekstre" üç farklı formülle: kontrol merkezi = en yeni açık arşiv; kart listesi = tüm açık arşivlerin toplamı; vade = en erken arşiv (`cardControlCenter.ts:39-45` vs `CardsPage.helpers.ts:251-262`). Canlı çelişki: Ekstreler sekmesi "0 ₺ açık ekstre yok" derken diğer yüzeyler 9.500 ₺ ekstre borcu gösterebiliyor (kova vs arşiv kaynağı).
- **Dashboard'da yaklaşan vadeler 4-5 kez:** dikkat bandı + ay şeridi + vade tablosu + odak kartları + ekstre hatırlatıcısı — hepsi aynı kaynaktan.
- **/analiz'de net değer trendi iki kez** (hero TrendBars + NetWorthTrend kartı); Dashboard net değer paneli ↔ Analysis hero birebir; "Vadeler·30 gün" ↔ "Yaklaşan taksitler" büyük kesişim.
- **"Likit" iki farklı anlamda:** Dashboard "Likit hesaplar 55.100" (borç düşülmemiş) vs Kartlar "Likit toplam 24.750" (borç düşülmüş net).
- **Mutabakat düzeltmesi iki ayrı yoldan:** `AccountLedgerPanel` → `recomputeAccountBalance` RPC; DataHealth → `applyDataHealthSafeRepairs` (denetim fişi/idempotency yalnız ikincide).
- **Kategori düzeltmenin iki paralel akışı:** `CategoryCleanupPanel` (hafızayı besler) vs `DataHealthCardExpenseReview` (beslemez).
- **CarsPage ↔ ExpenseContextsPage:** `CardTagging`/`ManualExpenseForm` neredeyse birebir iki kopya; üstelik farklı repo fonksiyonları (provizyon bağlama atanabilir, araca atanamaz — keyfî fark).
- **İki altın modeli kopuk:** Varlıklar sekmesi `assets` kategorisinden 45.000 ₺ altın gösterirken Altın sekmesi (gold_lots) "işlem yok" diyebiliyor (canlı doğrulandı).
- **Bileşen aileleri:** rozet 4 kopya (`Badge`/`StatusBadge`/`DayBadge`/`confidence-badge`), yüzey 3 nesil (`Card`/`FinancePanel`/`LineGroup`+ölü CSS), başlık 2 (`SectionHeader`/`ScreenHeader`), kahraman rakam 3 (`HeroNumber`/`PageHero`/`AmountDisplay`), ilerleme çubuğu 3, para girişi 2 (`MoneyInput`/`CurrencyInput`), grafik "veri yok" kutusu 3 kopya, focus-trap 2 farklı davranışta.
- **CrudPage satır menüsü aynı dosyada iki kez** (`CrudPage.tsx:446-493` vs `524-571`).

## 4. Ölü kod envanteri (git grep ile tests/e2e dahil doğrulandı)

**Dosya bütünüyle ölü:** `pages/CardsPage.installment.tsx` (276 satır) + tek tüketicisi olduğu `components/finance/InstallmentPlanner.tsx`; `data/repositories/debtsRepo.ts` (eski imza — canlı akış `settle_personal_debt`'i doğrudan çağırıyor); `data/repositories/paymentsRepo.ts`; `utils/spendingAnomalies.ts` (tüm modül); `ui/animated-number.tsx`; `ui/separator.tsx`; `components/dashboard/dashboardPanelUtils.ts`.

**Sabit bayrakla ölü dallar (~500 satır):** `StatementImportModal.tsx:268` `cleanImport = true` sabit → non-clean gövde, `handleCancelAppOnly`, A2/B1 UI blokları erişilmez; `CurrentMovementImportModal.tsx:121` `cleanImport = false` sabit → `handleCleanImport` + clean UI erişilmez. İki modal birbirinin ölü yarısını taşıyor.

**Ölü export'lar:** `financeSummary.buildFinancialHealth` (motor + tip), `cardLedger.projectDebtByCard`/`groupEventsByCard`, `accountLedger.projectBalanceByAccount`/`groupEventsByAccount`, `cardInstallmentCalendar.totalScheduledInstallments`, `money.addKurus`, `budgetAlerts.buildBudgetAlerts`, `analysisView.buildCalendarEvents` zinciri, `dashboardInsights.reconciliationDriftCount`, `attention.attentionDayKey`, `dataConfidence.estimateConfidence/worstConfidence`, `cardsRepo.cutCardStatement/setStatementReconciliation`, `loansRepo.payLoanInstallment`, `CardsPage.crud.renderCardExtra`, `FinanceUI.AppPage/PageCommandHeader`, `input.InputWithIcon`, `skeleton.SkeletonMetricGrid/SkeletonTable`, `BarChart.Sparkline`, `DashboardPage.nextMonthCashFlow` (+`totalLoanMonthlyPayment`).

**DİKKAT:** `dashboardUpcoming.buildDashboardMonthlyLoad`'un tek tüketicisi `tests/e2e/finance-summary.spec.ts` — silinirse lint+unit+build yeşil kalır, yalnız Playwright kırılır (CLAUDE.md gotcha'sının canlı örneği).

**Ölü CSS (index.css ~%25):** `.finance-surface/-muted`, `.finance-hero-panel`, `.finance-glass`, `.card-interactive`, `.gradient-text`, `.progress-*` (5), `.pulse-border`, `.count-up`, `.nav-pill`, `.trend-*`, `.animate-*` (4), `.delay-*` (7), `.app-sidebar/header/icon-button`, `.safe-spend-card` bloğu (~38 satır), `.accounts-bank-tile`, `.hub-command-nav`; token'lar: `--brand-50..950` (11), gölge setinin 5'i, `--motion-spring`, `--surface-elevated`/`--border-strong` (yalnız dark'ta tanımlı — tek-tema tuzağı).

## 5. Mantık / kenar durum bulguları (ORTA)

- `DataHealthPage.tsx:190` — `card-split-` öneki iki bulgu ailesini birden sayıyor; tek kartta istatistik `−1` gösterebilir.
- `DataHealth.checks.ts:663-697` — sabit ID'li bulgular kalıcı kapatılınca gelecekteki YENİ sorunlar da sonsuza dek gizleniyor (`card-expense-missing-description` vb.).
- `DataHealth.checks.ts:333-427` — tek borç uyuşmazlığı 3-4 ayrı kart olarak gösterilebiliyor (örtüşen koşullar).
- `cardControlCenter.ts` ↔ `reconciliation.ts` — 7 günlük bayatlık eşiği + sınıflandırma mantığı kopya (biri değişirse iki panel farklı konuşur).
- `paymentHistory.ts:6-24` — ay sınırını aşan geri alma görünmez; undo tespiti serbest metne bağlı.
- `statementReminder.ts:35` — `dueDate` `from` parametresi yerine gerçek duvar saati kullanıyor (saf fonksiyon sözleşmesi bozuk).
- `financeObligationRules.ts:52-54` — `paymentUsesCreditCard` kart tipini doğrulamıyor; banka kartına talimatlı ödeme `cashImpact=0` sayılır.
- `purchaseImpact.ts:60-88` — kartlı alımda tablo "bu ay 0 yük" derken "Sonra harcanabilir" bu aydan taksit düşüyor (canlı doğrulandı); 6 aylık pencereyi aşan taksitler karara hiç girmiyor; gerekçe metni ham `toFixed(2)` "4000.00 TL" (canlı doğrulandı).
- `budgetAlerts.ts:48` — `?? UNCATEGORISED` hiç tetiklenmez (kolon non-null); boş kategori 'Diğer'e düşmüyor, diğer modüllerle ayrışıyor.
- Provizyon durumu modüller arası tutarsız: aylık özet/rapor provizyon DAHİL (`!== 'cancelled'`), abonelik/anomali/radar yalnız `posted` — canlı: Analiz "Kart harcaması 9.250" vs kart paneli "Dönem içi 8.250".
- `AnalysisPage.panels.tsx:61-72` — "Yaklaşan taksitler" sayacı slice sonrası hesaplanıyor; 12 taksit varken "8 taksit" (canlı doğrulandı).
- `DashboardCards.tsx:35-45` — rozet 120 kayıt der, liste 40 gösterir; "daha fazla" yok.
- `reports.tsx:153-155` — "Net nakit" projeksiyon gelir − gerçekleşen gider (elma-armut); ay ortasında hep şişkin.
- `useDailyNetWorthSnapshot.ts:50-54` — bayat cache'ten fotoğraf + `setQueryData` yan etkisi bakım koşusunu atlatabiliyor.
- `cardsRepo.addCardExpense` + `tagExpenseCar` atomik değil; hata "hiç kaydolmadı" gibi raporlanır → tekrar gönderim çift harcama riski (manuel kayıtta dedupe yok).
- `valuationRepo.persistEstimatedValues` — N+1 UPDATE, kısmi başarı sessiz (karışık kurla değerleme).
- PlanningPage kasa düzenlemesi sonrası rezerv bayat (mount'ta bir kez fetch; TanStack'e taşınmalı).
- `AssetsPage` — hesaplar yüklenemezse hero sessizce eksik; kur yokken otomatik varlık 0 ₺ doğuyor (+hemen DataHealth uyarısı); Hisse satırının sağ sütunu farklı metrik (K/Z yüzdesi) gösteriyor.
- GoldPage satışta eldekinden fazla miktar satılabiliyor (negatif birikim sessizce 0'a kırpılır).
- `DueStatementAutomation` hata durumunda dönemi "tamamlandı" sayar (`finally`'de runKey damgası).
- Banka hesabında "Provizyonda" harcama seçilebiliyor; QuickExpense bakiye aşımını engellemiyor (MovementModal engelliyor — aynı hesap iki kural).
- `update_card_expense` banka kartı yolunda bayat bakiye kontrolü (yanlış red mümkün); `pay_payment_from_card_import` 6-arg wrapper `xmin` karşılaştırması epoch sonrası kırılgan.
- `reset_card_import_data` 20260805120000 yeniden tanımı anlamlı ön-koşul mesajlarını düşürdü (guard yine engelliyor ama hata jenerik).
- `LoansPage.helpers.ts:133` sabit `+03:00`; `monthMeta` `useMemo([], ...)` donuk "bugün"; PWA gece açık kalırsa eskir.

## 6. UI/UX ve erişilebilirlik

- **Analiz sayfaları yüklenirken boş veriyle yanlış render** (yükleme göstergesi en altta; "Maaş eklenmedi" gibi yanlış durumlar flash'lar) — Dashboard'ın skeleton yaklaşımıyla çelişiyor.
- **Hata durumları tutarsız:** Dashboard'da `role="alert"`+retry var; Analysis/Planning/PurchaseDecision'da yok — Planning snapshot hatasında sıfırlarla "normal" görünür (sessiz sıfır).
- **"Ekstreyi ödendi işaretle" etiketi yanıltıcı:** buton gerçekten hesaptan para düşer; LoansPage "Öde"/"Ödendi say" ayrımını doğru yapmışken burada ters.
- **Import modalları:** focus-trap/Escape/`role="dialog"` yok; "PDF kapsamı" butonu işlevsiz; satır seçimi no-op ama tıklanabilir görünüyor; mobil kısıt iki modal arasında tutarsız.
- **ConfirmDialog kapanınca odak tetikleyiciye dönmüyor**; QuickActions panelinde focus-trap/Escape yok; toast'lar hep `assertive`; takvim gün butonları etiketsiz; BarChart/LineChart'ın erişilebilir adı yok (CashFlowChart doğru yapıyor).
- **`hiddenOnPaths` kök-path bazlı:** Hedefler sekmesindeyken FAB'dan planlı ödeme eklenemiyor.
- **WishlistPage:** fiyat parse'ı `parseNumber`'ı atlıyor ("12.500" → NaN → fiyatsız kayıt); hover'a gizli butonlar dokunmatikte görünmez ama tıklanabilir; PurchaseDecision ile köprü yok.
- **Üç overlay üç ayrı renk** (`bg-slate-950/45`, `/56`, `bg-black/30`) — tek token olmalı; radius ölçeği dağınık (`rounded-2xl` temada 28px!); `--motion-*` token'ları hiç kullanılmıyor; dark'ta `--success`≈`--primary` (success/default butonlar ayırt edilemez).
- **PurchaseDecisionPage:** tampon okuma yerel kopya (try/catch'siz — gizli modda çökme riski); tutar parse elle; cash+taksit kombinasyonu seçilebiliyor.
- **Masaüstü vade tablosunda ödeme aksiyonu yok** (mobilde var); "Planlı" tonu iki bileşende farklı renk.
- Dashboard "hızlı kontrollerde sapma yok · 6/6 temiz" derken Kontrol sayfası 6 uyarı gösterebiliyor (farklı kapsamlar — kullanıcıya sezgisel değil; canlı gözlem).

## 7. Türkçe metin / terminoloji

- `CardsPage.statements.tsx` yarısı ASCII'ye düşmüş: "Acik ekstreler", "yukleniyor", "Ekstreyi odendi isaretle", "icindedir/kartı/ayrica/borc" (176-226 arası) — aynı dosyanın diğer yarısı düzgün.
- Obligations "aylik" → "aylık" (canlı: vade listesindeki her tekrarlı kalemde görünüyor).
- Ek uyumu: `gelirin %${x}'i`, `Ayın %${x}'indesin` sabit ek — çoğu değerde yanlış.
- Kullanıcıya görünen iç isim + bayat bilgi: "Trend grafiği her gün AnalysisPage açıldığında güncellenir" (yanlış da: snapshot Layout'ta alınıyor).
- Terminoloji çiftleri: "banka kartı"↔"banka hesabı"; "Arabalar/Arabalarım/Araçlarım"; geçmiş üç ad ("Son güncellemeler"/"Geçmiş işlemler"/"Aktivite Akışı"); harcanabilirin üç adı ("Ay sonuna kalan"/"Sonra harcanabilir"/"Harcanabilir"); "Hareket PDF'i"↔"Mutabakat" aynı eylem.
- Kesme işareti üç stil ("0 dan"/"0'dan"/"0'dan"); sen/siz karışımı; DataHealth metinlerinde jargon ("posted_at boş kalmış", "idempotent ... geçişi"); maaş sayfasında "+%16,7" vs "+16.7%" aynı ekranda (canlı).
- `DataHealth.checks.ts:1180` "Kredi kartındaki ödeme planı" — bulgu kredi (loan) hakkında; yanlış yönlendirir.

## 8. Supabase / DB (ayrıntı)

- K3, K4, K18 yukarıda. Ek olarak:
- **Sağlam çıkanlar:** SECURITY DEFINER + `auth.uid()` + `set search_path=''` + revoke deseni tutarlı; append-only ledger 20260803120000'de insert yetkisinin alınmasıyla gerçekten zorlanmış; kuruş/TL sınırı temiz; guard trigger evrimi kapsayıcı; ölü RPC temizliği yapılmış (drop migrationları); RLS/grant denetimleri CI'da.
- `guard_current_settlement_allocation`'ın "arşivli taksit yalnız ekstre ödemesiyle paid" dalı artık ölü (banka modeli taksitlere dokunmuyor) — kafa karıştırıcı, temizlenebilir.
- Edge: Gemini API anahtarı query-string'de (header'a taşınmalı); rate limit instance-başı bellek içi (bilinçli); `parse-receipt` boyut mesajı 6/8 MB tutarsız; `cut_due_card_statements` akış kontrolü hata mesajı string eşitliğine bağlı (kırılgan bağ). push-notify implementasyonu (VAPID/aes128gcm, idempotency, tercih kapısı) sağlam.
- **pgTAP boşlukları (önem sırasıyla):** (1) `post_card_provision` geçmiş `spent_at` + çok taksit senaryosu (K3'ü yakalar); (2) `pay_card_statement` doğrudan testi yok; (3) `pay_card_debt` B1 residual yolu; (4) `pay_payment`/`pay_loan_installment`/`transfer_between_accounts`/`record_manual_account_movement`/`post_*_correction` doğrudan testsiz; (5) ledger trigger projeksiyon testleri; (6) `cancel_card_expense` 5b; (7) K4 çift ödeme negatif testi.

## 9. Parser / lib katmanı

- **Fiyatsız altın satışı maliyet tabanını şişiriyor:** `summarizeGoldType`'ta fiyatsız satış `knownQuantity`'yi düşürmüyor; UI satışta fiyatı zorunlu tutmuyor (`goldLedger.ts:55-71`, `GoldPage.tsx:329`).
- **YapıKredi parser:** satırın herhangi bir yerinde "ÖDEME" geçen işlem sessizce düşüyor ("PARAM ÖDEME KURULUŞU" gibi gerçek satıcılar dahil) ve YK yolunda checksum koruması hiç yok (`yapiKrediStatementParser.ts:96`; `checkStatementParseTotals` YK'da `checked=false`). Golden-fixture altyapısı da YK dosyası kabul etmiyor (`parserFixtures.test.ts:37-47`).
- **Edge hata gövdesi kullanıcıya hiç ulaşmıyor:** `FunctionsHttpError.context` ham `Response`'tur; `.context.error` deseni her zaman undefined → spesifik Türkçe hatalar yerine hep jenerik mesaj (`statementParseClient.ts:71-72`, `receiptParseClient.ts:43-45`).
- **marketRatesClient'ta fetch timeout yok** — asılı istek `loading:true`'yu süresiz açık bırakır, `inflight` tüm sonraki çağrıları bloklar (`marketRatesClient.ts:82-94`).
- **stockQuotesClient cache'inin yaş kavramı yok** — aylar önceki fiyat "geçerli" sayılır ve `valuationSync` bunu persist eder; D3 bayat rozeti bu yolda tetiklenmez (`stockQuotesClient.ts:61-93`).
- DÜŞÜK: DenizBank hareket parser'ında iade satırı desteği yok; bonus temizleme regex'i binlik ayraçlı bonusu kaçırıyor; `sectionCategoryFor` locale'siz `toUpperCase` (İ tuzağının aynası); `bankBranding` 'maximİles' ölü anahtarı + Enpara/QNB sıra çelişkisi; `date.daysUntil` ISO-saatli girdide NaN döner; `valuationSync` persist hatasında bile "N güncellendi" der; `supabase.ts` env eksikse üretimde sessizce example.co istemcisi kurar; yakıt özeti odometresiz ara dolumun litresini atlar (L/100km sistematik düşük); `pdfText` `destroy()` çağırmıyor (bellek sızıntısı); fiş tarama LLM kategorisini/tarihini doğrulamadan geçiriyor.
- Ölü/askıda: `marketRates.hasRate`, `RATE_SYMBOL_LABELS`, `snapshotToUpsertPayload` (Faz 2 için bekletiliyorsa not düşülmeli), `goldLedger.buildGoldAccumulation` (K5'in düzeltmesi = GoldPage'i buna bağlamak), `denizBankStatementParser.reusableStatementInstallmentParentId` (BACKLOG D2'de kayıtlı).
- Zekât: yorum "güçlü alacaklar" derken kod tüm açık alacakları katıyor; kredi borcunun tamamının düşülmesi tartışmalı (tahmin notu var); altın canlı kurla, FX/hisse stored değerle — karışık tazelik.
- Sağlam çıkanlar: `parseAmount` çift-locale çözümü, İ/I normalizasyonu, taksit notasyonu çapraz doğrulaması, importMatch eşleştirme merdiveni, SMS +03:00 sabitlemesi ve yazma kilidi, backup restore FK sırası.

## 10. Canlı tur gözlemleri (yukarıda geçmeyenler)

- Boş durumda hero "−5.000 ₺ · günde 0 ₺" gösteriyor (hiç veri yokken tamponu düşüp negatif sayı göstermek yeni kullanıcıyı korkutur; onboarding durumunda tampon satırı gizlenebilir).
- Varlıklar listesinde Gram Altın'da Al/Sat yok, Hisse ve Nakit'te var (altın işlemleri ayrı sekmede — kullanıcıya görünmez gerekçe).
- LoginPage: tek kullanıcılı üründe "Kayıt Ol" birinci sınıf sekme; kayıt başarı mesajı hata stiliyle basılıyor.
- Loan "Öde" butonları a11y ağacında taksit metninden önce geliyor; tüm gelecek taksitler bağımsız ödenebilir.

## 11. Dokümantasyon senkronu

Ayrı taramayla 22 docs dosyası + kök dokümanlar kodla karşılaştırıldı; bulunan sapmalar
(bu commit dizisinde) güncellendi: README TI-03 durumu, CLAUDE/CODEX "5→6 kural",
RPC_ACTION_REFERENCE (drop edilen RPC'ler, K1 parent reuse, kısmi borç), FINANCE_RULES
(silinen özellikler, importMatch toleransları), PROJECT_CONTEXT (rotalar/nav), UI_ARCHITECTURE
(Şerit sözleşmesi olarak yeniden yazım), DASHBOARD/CARDS_ARCHITECTURE, KNOWN_RISKS satır
sayıları, SHARED_PAYMENT_DRAWER_PLAN arşiv notu, PIPELINE db:test listesi,
EXPENSE_CONTEXTS_AND_CARS S2/S3, CARD_DEBT_TRANSITIONS/TRANSACTION_HISTORY tarih+ekler,
AI_CONTEXT_INDEX eksik satırlar. Arşiv adayları: SHARED_PAYMENT_DRAWER_PLAN,
BANKING_SIMPLIFICATION_AUDIT (closeout sonrası), APPLICATION_AUDIT_2026-08-02.

## 12. Önerilen aksiyon planı

- **Faz A — para doğruluğu (acil):** K3 (post_card_provision regresyonu + pgTAP), K4 (çift ödeme kilidi), K5 (altın grafiği → buildGoldAccumulation), K6 (parseNumber), K13 (kart başına gelecek taksit), K14 (guard Result kontrolü), K15 (greaterThanTL), K16 (kasa rezervi hata yolu).
- **Faz B — güven/UX kritikleri:** K1 (gizlilik sızıntısı — string'lere maske ya da tutarları ayrı alanda taşı), K2 (401 retry / oturum bekletme), K7+asgari ödeme modeli, K8 (link), K9 (CSV tam export), K10-K11 (tek "ay sonu"/"harcanabilir" sözleşmesi), K12 (limit grubu).
- **Faz C — temizlik:** §4 ölü kod (import modallarının bayraklı dalları dahil), index.css temizliği, bileşen ailelerinin birleştirilmesi (MoneyInput/CurrencyInput, rozetler, chart empty).
- **Faz D — tutarlılık/dil:** §3 tekrar eden yüzeylerin sadeleştirilmesi (özellikle kart kırılımı ve vade tekrarları), §7 metin düzeltmeleri, terminoloji sözlüğü.
- **Faz E — test borcu:** §8 pgTAP boşlukları, LineChart null-segment testi, e2e-only tüketici (`buildDashboardMonthlyLoad`) kararı.
