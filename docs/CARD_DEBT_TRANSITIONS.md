# Card Debt Transitions

26 Ekim kart geçmişi eki: `CardLedgerPanel.tsx` borçlanma/ödeme/net tutarlarını
ayrı alanlarda, hareketleri 10'ar kayıtlık sayfalarda sunar. Açıklama kırpılmaz;
mobilde tutar alt satıra iner. Tüm geçmişin toplamı sayfa seçiminden bağımsızdır.
`financePanelsRepo.ts` kart/hesap tam geçmişini ve tarih aralığı karşılaştırmasını
500 satırlık PK keyset sayfalarıyla tamamlar; PostgREST 1000 sınırı toplam/fark
hesabını kesemez. Son üç hareket gibi açık limitli özet tek istek olarak kalır.
Herhangi bir sayfa/anahtar hatası kısmi başarı döndürmez; panel fark/düzeltme
sunmak yerine hata gösterir. Veri revizyonu ve geciken yanıt korumaları sürer.
Ayrı istekler tek DB snapshot'ı değildir; eşzamanlı eklemeler yeni revizyonda
tekrar okunur, sabit PK imleci offset kaymalarını önler. Finans formülleri,
borç alanları ve yazma/ters kayıt RPC'leri değişmez. Regresyonlar:
`src/data/repositories/financePanelsRepo.test.ts`,
`src/components/finance/LedgerPanels.test.tsx`, `tests/e2e/simplification.spec.ts`.


26 Ekim sadeleştirme yalnız sunum ve erişimi değiştirir. Transfer kısayolu
mevcut formu, ödeme ve düzeltme eylemleri aynı servis/RPC'yi açar. Kart döngüsü
Kartlar bağlamına taşınır; dönem toplamı/son hareket kapsamı adlandırılır.
Sıfır tutarlı teknik olaylar filtreyle erişilebilir, ledger'dan çıkarılmaz.
Bu geçiş tablosunda, tutarlarda, otomatik bakımda ve SQL'de değişiklik yoktur.


25 Ekim döküm geri bildirimi: kart özetinde seçili toplam görünür biçimde
işaretlenir; kullanıcı döküm açınca/değiştirince ilgili içeriğe kaydırılır.
Bu sunum değişikliği borç alanlarını, ödeme/RPC geçişlerini veya ledger
olaylarını değiştirmez. Sözleşme: `docs/CARDS_ARCHITECTURE.md`.

24 Ekim genişletilmiş tazelik denetimi: finans mutation'ları aynı kullanıcıdaki
liste/özet/detay cache'lerini yeniler; son hesap hareketleri ve hisse/varlık
geçmişleri eski/yeni okuma sonuçlarını karıştırmaz. Borç geçişleri ve finansal
yazma yolları değişmez. Bulgular: `docs/RENDER_DATA_FRESHNESS_2026-10-24.md`.

24 Ekim ledger görünümü eki: hesap/cüzdan ve kart ayrıntısında hareketler,
satır id/zaman damgası/tutar revizyonuyla yenilenir; yükleme sırasında eski
ledger yeni bakiye/borçla karşılaştırılmaz. Geciken sorgular ve panel içi
düzeltmenin ara durumu sahte fark/düzeltme önerisi üretmez. Güncel gerçek fark
korunur. Bu değişiklik aşağıdaki borç geçişlerini, RPC'leri veya ledger olaylarını
değiştirmez. Sözleşme: `docs/CARDS_ARCHITECTURE.md`.

20 Ekim teşhis eki: `docs/CLIENT_ERROR_DIAGNOSTICS.md` hata kayıtlarının yeni
teknik bağlam ve inceleme sözleşmesidir. Kart/hesap/ödeme/ledger tabloları veya
aşağıdaki geçişler bu izleme değişikliğiyle güncellenmez.

18 Ekim tüm kartlar tahmini: mevcut kart projeksiyonları kesim ayına göre
birleştirilerek üç aylık toplam sunulur. Görünüm “Borç kırılımı ve dökümler”
katmanında toplam yükün ardından açılır. İlk dönemde abonelik çift sayılmaz;
kesilmiş ekstre/provizyon/faiz/serbest harcama dahil edilmez. Bu salt okuma
yüzeyi kart borcu alanlarını, ödeme geçişlerini veya ledger'ı değiştirmez.

18 Ekim alt menü eki: Alınacaklar, Bütçe ve hedefler, Hisseler ve Bakım
adları kullanıcı onayıyla güncellendi; Bulgular korundu. Bu dil değişikliği
kart borcu, ödeme, RPC veya ledger geçişlerini değiştirmez.

Kart ayrıntısı düzeni: döküm seçenekleri ikonlu iki sütunlu menüdedir.
Manuel kayıt etiketli Harcama ekle veya hızlı işlem menüsünden doğrudan görev ekranında açılır. Kart ayarları ve kayıt geçmişi bölümünde yinelenen borç/limit
özeti, taksit listesi ve ekstre listesi kaldırıldı; bunların tek ayrıntı kaynağı
üst özet ve ilgili döküm menüsüdür. Borç/ledger kuralları değişmedi.
Last reviewed: 2026-10-16

Abonelik görünürlüğü eki: aylık kredi kartı talimatında manuel ödeme düğmesi
sunulmaz. Eşleşme rozeti vade ayı ve banka işlem tarihçesinden okunur; kart
ekstresinin nakitle ödendiği anlamına gelmez. Yeni borç/ödeme/ledger kaydı
oluşturulmaz; SMS/PDF eşleştirmesi ve aşağıdaki geçişler değişmez.
Tarihçe kapsamı dışındaki eksik ayda eşleşme uydurulmaz veya yok sayılmaz;
bulunan kanıt gösterilir, aksi halde geçmişin tam yüklü olmadığı belirtilir.

Kalıcı kabuk eki: günlük net değer fotoğrafı yeni gün/başarısız kayıt sonrası
gezinmede yeniden kontrol edilir; çalışan kayıt gezinmeyle iptal edilmez.
Kart borcu/ledger geçişleri ve finans hesapları değişmez.

16 Ekim çalışma zamanı eki: kart okuma cache'i kullanıcıya özeldir ve para
hareketi/bakım sonrasında geçersiz kılınır. Arşiv + kısmi ödemeler birlikte
yayımlanır; başarısız sorgu sıfır borç sayılmaz. Hesaplar ekranında kesim
adayı kontrolü korunur; kesin kesim kararı gerçek arşivlerle verilir.
Kapalı yardımcı paneller ilk açılışta yüklenir. Borç geçişi, RPC, ledger,
taksit sayfalaması ve açık ekstre kapsamı değişmez. `docs/APP_PERFORMANCE.md`.

16 Ekim test hızlandırma eki: dosya guard'ları Node'a taşındı; saf veri
sağlığı fixture'ının import'u repo'dan ayrıldı. Kart borcu/ledger hesapları,
finans testlerinin kapsamı, SQL ikiz testleri ve coverage eşikleri değişmez.

16 Ekim CI/dokümantasyon eki: release kontrolleri paralelleştirildi; gerekli
DB/yedek/edge işleri tamamlanmadan frontend yayını yapılamaz. README demo
görselleri güncel tasarıma taşındı. Bu paket kart borcu alanlarını, RPC'leri,
ledger olaylarını veya aşağıdaki geçiş kurallarını değiştirmez.

Dil sözlüğü eki: kart ödeme eylemleri “Ekstre/Borç ödemesi kaydet” der;
ortak form “Ödemeyi kaydet” ile aynı kanonik RPC'yi çağırır. Bankadan para
gönderilmediği söylenir. Asgari/ekstre/tam tutar seçimi, SMS'te zaten oluşan
hareketi tekrar saymama, kısmi ödeme ve borç bölümü geçişleri değişmedi.

16 Ekim ikon/metin eki: “Mutabık kaydet” artık “Karşılaştırmayı kaydet”tir;
farklı banka tutarı kaydedildiğinde durum yine `drift` kalır. “Düzelt ve
kaydet” ayrı onaylı borç düzeltme eylemidir; delta, hedef borç bölümü ve
append-only ledger işlemi değişmedi. “Kova projeksiyonu” yalnız arayüzde
“Hareketlerden hesaplanan borç dağılımı” diye adlandırılır. Kart/taksit adı
ve tutarı dar alanda sarılır. SQL/TS projeksiyon kaynakları aynı kalır.

This file is the working source of truth for how credit-card debt moves through
the app. If an RPC, page action, or data-health fix changes one of these rules,
update this file in the same change.

16 Ekim 2026 görsel düzeni borç geçişlerini değiştirmez: kart satırındaki açık
ekstre aynı kısmi ödeme düşülmüş kaynaktan, dönem içi ayrı etiketten okunur;
ödeme eylemleri aynı RPC üzerinden sürer. Ortak limit grupları kredi kartları
listesinin altındaki yönetim ayrıntısında görünür. Grup özeti mevcut
`buildCreditLimitGroups` hesabını kullanır: limit en yüksek kart limiti, borç
bağlı kartların toplamıdır. Bu görünüm borç geçişlerini veya ledger kayıtlarını değiştirmez.

18 Ekim abonelik keşfi eki: başarılı PDF aktarımı sonrasında ayrı aday taraması
açılır. Kullanıcı onaylı yeni plan `bank_auto` + kredi kartı bağlantısı kurar;
tek seferlik plan düzeltmesi yalnız tekrar metadata'sını değiştirir. Bu
işlemler harcama, ödeme, borç veya ledger olayı oluşturmaz. Yeni keşif
adayları onaysız finansal projeksiyona girmez; eski tahmin kaynağı korunur.
Sözleşme: `docs/FINANCE_RULES.md` / Ekstrelerden abonelik keşfi.
Canlı ad eşleştirme eki: Prime/Supercell keşif adları ortaklaştırılır; yeni
planın banka eşleşme alanı özgün işyeri adını korur. Kurum/abone kimliği eksik
tekrarda ikinci plan yazılmaz. Banka matcher'ı ve borç geçişleri aynı kalır.

## Canonical Fields

For `cards.card_type = 'kredi_karti'`:

- `debt_amount`: total card debt. This includes statement debt, posted current
  period spending, provisions, and future scheduled installment debt already
  created by the app.
- `statement_debt_amount`: billed/open-statement debt that is immediately due.
- `current_period_spending`: posted spending that has not been cut into a
  statement yet.
- `provision_amount`: provisional spending that uses limit but is not payable.
- `card_installments`: planning rows for installment timing. `due_month` is a
  legacy column name but now stores the exact installment due date, preserving
  the original transaction day when monthly installment rows are generated.
  These rows are inside card debt, not a second independent debt bucket.

The visible split must never exceed total debt:

```text
statement_debt_amount + current_period_spending + provision_amount <= debt_amount
```

The database trigger `clamp_card_breakdown()` enforces this on writes. Its
priority is statement first, then provision, then current period. The TypeScript
twin is `clampCardBreakdown()` in `src/utils/financeSummary.ts`.

> **2026-08-02 düzeltme (INC-01):** 20260625 migration'ı provizyonu geçici olarak
> `debt_amount`'tan ayırmıştı (`add_card_expense` provizyonda `debt += 0`), ancak
> `clamp_card_breakdown` hâlâ `statement + current + provision <= debt` istediği için
> boş/düşük-borç kartta provizyon clamp ile 0'a düşüp kayboluyor ya da current'ı
> yiyordu. Migration `20260802130000` bunu tersine çevirir: **provizyon yine toplam
> borcu artırır** (`add_card_expense` provizyonda `debt += amount`), `post_card_provision`
> ise posting'de borç EKLEMEZ (borç create'te eklendiği için yalnız `provision → current`
> taşınır). Böylece yukarıdaki matris + clamp tutarlı olur.

> **2026-08-02 prod follow-up:** `20260802160000_repair_legacy_provision_debt.sql`,
> yukarıdaki geçiş deploy edilmeden önce yaratılmış aktif provizyonlarda yalnız üç
> bağımsız projeksiyon aynı kuruş farkını doğrularsa toplam borca auditable ledger
> adjustment ekler. Belirsiz kartlar değiştirilmez. `20260802165000`, mutabakat
> akışındaki `cancel_card_expense` fonksiyonunu da yeni modele taşır: provision
> expense iptali hem toplam borcu hem provizyon kovasını tersler.

> **2026-08-02 allocation hardening:** `20260802190000`, child satırındaki
> `current_settlement_id` veya `statement_archive_id` alanının aynı karta ait eski
> bir parent id ile mevcut satırda doğrudan değiştirilmesini engeller. Bu
> NULL→parent UPDATE geçişlerini
> yalnız kartın aggregate kovalarını aynı transaction'da taşıyan `pay_card_debt` ve
> `cut_card_statement` yapabilir. Yetki bağlamı auth.uid, row owner, card ve parent'a
> bağlanır, iki child update'inden hemen sonra temizlenir ve SQL regresyonunda hem
> expense hem installment yolu doğrulanır.

> **Archived edit invariant:** `20260802200000`, `update_card_expense` çağrısını
> expense doğrudan bir statement archive'a bağlıysa veya taksit parent'ının herhangi
> bir child'ı archive'a girdiyse reddeder. Current-period edit algoritması arşivlenmiş
> tutarı yanlış kovadan tersleyemez; banka gerçeğinde düzeltme gerekiyorsa geçmiş
> satırı yeniden yazmak yerine auditable correction/reconciliation akışı kullanılır.
> Aynı invariant trigger'da da vardır: arşivlenmiş expense/installment'ın finansal
> kimlik alanları raw REST ile değiştirilemez. Ekstre ödemesi installment
> `status/paid_at` alanlarına artık dokunmaz; yalnız archive yaşam döngüsünü kapatır. Statement import'ta
> tek child tutarını parent/card/ledger etkisinden bağımsız değiştirmek güvenli
> olmadığı için amount mismatch yalnız manuel uzlaştırma sinyalidir.
> Archive parent'ın finans/lifecycle alanları ile arşivli child DELETE/status yolları
> da DB trigger ile korunur. Yalnız exact parent'a bağlı `pay_card_statement` veya
> user/card bağlı kanonik reset context'i geçebilir; arşivli expense iptali reddedilir.
> Backup restore uyumluluğu için yeni historical archive-marker INSERT same-user/
> same-card RLS kontrolünde kalır; mevcut satırı yeniden allocation etme yolu değildir.

## Display Helpers

2026-10-12 belge eşitlemesi: hesap özetindeki “Tüm kart borcu sonrası” banka
hesapları + nakit cüzdanları toplamından tüm kartların `debt_amount` toplamı
düşülmüş farktır; provizyon ve gelecek taksitler de dahildir. Bu tanım mevcut
hesap özetiyle aynıdır; bu değişiklik borç matematiğini değiştirmez. Dashboard
likit toplamı nakit varlıklarını da kapsar ve daha geniş kaynaktır. Bu ay
harcanabilir tutar ayrıca kalan gelir/yükümlülük, tampon ve kasa rezervini
kullanır. Kullanıcının ekstresini tam ödeme döngüsüne
yönelik ayrı ürün önerisi `docs/CARD_PAYMENT_CYCLE_PROPOSAL.md` içindedir;
bu öneri mevcut borç geçişlerini veya hesaplamaları değiştirmemiştir.

Manuel harcama/taksit kaydı yalnız hızlı işlem (+ / İşlem) menüsünden açılır.
Tekrarlanan UI girişlerinin kaldırılması `add_card_expense` veya taksit devir
RPC'sinin borç/ledger etkisini değiştirmez. AI paylaşım raporu da aynı snapshot,
ekstre arşivi ve kısmi ödeme girdilerini kullanır; gelecekteki taksitleri
toplam borca ikinci kez eklemez.

Use `src/utils/financeSummary.ts` instead of reimplementing card math in pages:

- `cardProvisionAmount(card)`
- `cardSplitTotal(statementDebt, currentPeriod, provisionAmount)`
- `scheduledCardInstallmentTotalsByCard(installments)`
- `cardDebtBreakdown(card, scheduledTotal)`
- `cardPayableDebt(card)`
- `buildCreditLimitGroups(cards)`
- `clampCardBreakdown(debt, statement, current, provision)`

`buildCreditLimitGroups` is also the source for shared-limit semantics: group
limit is the max `credit_limit` in the group, while group debt is the sum of
member `debt_amount` values.

"Açık ekstre" has one formula everywhere (Faz D, 2026-08-12): the SUM of all of
the card's open statement archives (falling back to `statement_debt_amount`
when no open archive exists). The card control center
(`buildCardControlItems.openStatementAmount`) and the card list
(`visibleOpenStatementAmount`) both show this total — not just the newest open
archive — and warning tones derive from the same total.

## Transition Matrix

| Action | Owner | Card field changes | Related rows |
| --- | --- | --- | --- |
| Posted expense added | `add_card_expense` | `debt_amount += amount`; `current_period_spending += installments whose due date has passed` | Inserts `card_expenses`; multi-installment expenses create exact-date installment rows, posting only rows due on/before today. A repeated non-null `(user, source, source_event_id)` returns the existing expense and repeats no effect. |
| Provision expense added | `add_card_expense` with `status='provision'` | `debt_amount += amount`; `provision_amount += amount` | Inserts a provision `card_expenses` row; no installment rows are created until posting |
| Provision installment count marked (pre-post) | `setProvisionInstallments` (repo direct update, no RPC) | none | Bank SMS carries only the total, so SMS provisions open with `installment_count=1`. Before posting, the provisions panel lets the user set the real count; this updates only `installment_count`/`installment_amount` on the `status='provision'` row. No debt/bucket/ledger change — it is a label the later `post_card_provision` reads to split the plan. The `status='provision'` filter forbids touching posted/archived rows (that path is `update_card_expense`). |
| Installment intent applied to a provision | `private.apply_card_installment_intent` (called by `record_sms_card_expense`; manual wrapper `apply_card_installment_intent`) | none | The pre-shopping intent (`card_installment_intents`) writes the same `installment_count`/`installment_amount` label as the row above, then marks the intent `consumed`. Money model untouched: debt, buckets and ledger are identical whatever the count is. Matching is card + amount window + normalized merchant hint + `expires_at`, most specific first; SMS rows matched to a planned `bank_auto` payment are excluded. |
| Provision posted | `post_card_provision` | `provision_amount -= posted amount`; `current_period_spending += installments whose due date has passed` | Full post updates the same expense; partial post leaves the original provision with the remaining amount and inserts a posted expense; multi-installment posted provisions create exact-date installment rows |
| Post-cut provision blocked | `post_card_provision` + `ProvisionPanel` | none | An open statement whose cut date is on/after the provision's transaction date locks manual posting. The row says “Ekstre içe aktarma bekleniyor”; bulk posting skips it and the RPC rejects bypass attempts. Statement PDF import is the only safe repair because posting would move it into the next period. |
| Provision cancelled | `cancel_card_provision` | `debt_amount -= amount`; `provision_amount -= amount` | Marks the expense `cancelled`; removes related installment rows if any |
| Unstatemented expense cancelled | `cancel_card_expense` | Single/provision rows: `debt_amount -= amount` (provision also reduces `provision_amount`). Posted multi-installment plans: `debt_amount -=` the plan's child-row total — the plan's actual debt contribution — so cancelling a carried-over plan (parent amount = full plan, debt contribution = remaining only) never over-reverses. Posted rows reduce current-period spending; future scheduled installment debt is removed without double-reducing current period. | Marks the expense `cancelled`, removes related installment rows, and logs a correction with the real reversal amount. Directly/child statement-archived expenses are rejected; historical corrections require append-only reconciliation. |
| Scheduled installment due date reached | `post_due_card_installments` / finance maintenance | `current_period_spending += due scheduled installment total`; `debt_amount` unchanged | Changes due `card_installments` from `scheduled` to `posted`; maintenance runs this before statement cutting, and statement cutting keeps posted installment rows after the statement boundary in the new period |
| Statement cut | `cut_card_statement` / `cut_due_card_statements` | `statement_debt_amount += statement-period current spending`; `current_period_spending` keeps only already-posted rows after the statement boundary; `debt_amount` unchanged | Inserts or returns an open `card_statement_archives` row; links posted expenses/installments whose dates are on or before the statement boundary under the guarded allocation context. Direct child re-allocation is rejected. Automatic due maintenance skips cards whose current spending belongs entirely to the next statement instead of surfacing an error. |
| Statement paid | `pay_card_statement` | Source bank account `current_balance -= archived statement amount`; card debt reduces by that amount and `statement_debt_amount` is reprojected from remaining open archives | Marks only the statement `paid`; installment rows remain unchanged. Temporary aggregate drift does not block payment. |
| Manual card debt paid | `pay_card_debt` | Source bank account `current_balance -= amount` (skipped with `p_skip_source_debit`); card `debt_amount -= amount`; statement debt is reduced first, then current-period spending | A full current-period payment inserts a payment settlement and allocates every unallocated current movement. Exact older excess left by a legacy aggregate payment first enters a source-less `historical_repair` settlement without another cash/card aggregate movement. Any remaining bucket-vs-row difference no longer rejects the payment: it is closed as an auditable residual recorded on the settlement note plus a `correction` history row (bank model — payment reduces the aggregate; row allocation is best-effort evidence). Direct marker writes remain rejected. |
| Planned payment paid from credit card | `pay_payment` with a credit-card source | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row for the planned payment (category mapped to the card taxonomy via `private.card_category_from_payment`, `source='payment_auto'`, `source_event_id='payment:<id>:<ts>'` — UX tour B4/B5); `spent_at` and the history `occurred_at` honour the optional `p_paid_at` (B9, migration `20260908140000`); advances or closes the payment row |
| Manual planned payment reconciled from card import | `pay_payment_from_card_import` | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row using the bank movement/statement date; advances or closes the matched payment row |
| Statement import credit/refund row | `StatementImportModal` + `post_card_debt_correction` | Card `debt_amount -= amount`; negative correction reduces current-period spending first, then statement debt, then provision | DenizBank statement rows ending with `+ TL` are imported as auditable reverse entries instead of positive spending, so bank statement totals stay net of refunds/credits |
| Posted expense edited | `update_card_expense` | Reverses the previous unstatemented posted impact, then applies the new posted impact | Recreates installment rows for the edited expense. Rejects an expense already linked to a statement and an installment parent with any statement-linked child. The card-movements panel exposes this as "Taksitlendir" for a posted single-charge row (`installment_count = 1`), which is the repair path when a provision auto-posted before the installment count was marked — the installment-expense panel only lists `installment_count > 1`, so that row had no other way back. |
| Old installment plan carried over | `record_card_installment_carryover` | `debt_amount += remaining installment total`; `current_period_spending += remaining installments whose exact due date has passed` | Called when the current installment number is greater than one; inserts one parent and only the current/future open rows. Earlier installments are not recreated as synthetic paid history. |
| Card debt recomputed from ledger | `recompute_card_debt_from_ledger` | `debt_amount = sum(card_ledger.amount_kurus) / 100`; if the projection lowers total debt, visible split is reduced from current period first, then statement, then provision | Suppresses the ledger trigger for this repair write so no duplicate event is emitted |
| Card debt manual correction | `post_card_debt_correction` | `debt_amount += signed correction`; positive corrections add to current-period spending, negative reverse entries reduce current period first, then statement, then provision | Writes an auditable `card_ledger.kind='adjustment'` event with the required reason note |
| Bank total snapshot reconciled | `reconcile_card_bank_snapshot` | `debt_amount = bank total remaining card burden`; with the 4-arg overload (`p_bucket`, migration `20260908120000`, UX tour B1) a positive gap is also added to `current_period_spending` (`'current'`, UI default) or `statement_debt_amount` (`'statement'`); `'none'` and the legacy 3-arg signature leave buckets unchanged; a negative gap only lowers the total (clamp trims buckets) | Bank total must include future installments and cannot be below the visible split. A paid archive's unallocated historical children are attached only when every eligible child plus the linked total exactly equals that archive amount; ambiguous matches are untouched. The total-only change is an auditable ledger adjustment. |
| Card import reset | `reset_card_import_data` | Sets visible card debt fields to `0` before a clean import rebuilds the non-paid/open scope | Deletes unarchived/non-paid-open expenses, installments, statement archives, and their history under a user/card-bound guard. It fails before mutation if current-settlement or paid-archive installment history makes a clean historical rebuild unsafe. The product import UI remains non-destructive. |
| Statement PDF authoritative rebuild | `replace_card_statement_import` | Reprojects the rebuildable open scope, replays every validated PDF row, locks the cut amount to the bank total, then cuts/reconciles the statement in one transaction | Preserves paid archives/current-settlement evidence and movements after the PDF statement date. It never matches/reuses a historical installment parent: each PDF installment line creates a fresh current/future open plan, while old paid archives remain untouched. |
| Legacy whole-card reset | removed (`reset_card_data`) | n/a | Removed because it predated immutable statement/current-settlement evidence and had no safe append-only reversal model. Full user reset remains the supported destructive reset. |

## Calendar

The database default timezone is **Europe/Istanbul** (migration
`20260819120000`), so `current_date` inside every money RPC means the
Istanbul calendar day the user is living in. It used to be UTC, which shifted
every "has this due date passed" decision for transactions made between 00:00
and 03:00 Istanbul time — the first installment of such a purchase entered the
current period a day late. `timestamptz` is absolute, so no stored value moved;
only which calendar day counts as today. Use `private.today_ist()` in new code
when the intent matters, and keep `supabase/tests/installment_intent_and_calendar.sql`
green — it fails loudly if the setting is ever reverted.

## Statement Boundary

Statements are cut the day after the statement day, not on the statement day.
This lets spending made on the statement day itself belong to that statement.

`cut_card_statement(p_card_id, p_statement_date default null, p_due_date
default null)`: when the optional dates are provided (only the statement PDF
import passes them), the bank document is the date authority — the PDF
statement date becomes the cut boundary and the archive's dates, provided it is
within ±7 days of the card-calendar boundary (bank weekend/holiday shifts fit
easily; a wrong-month PDF does not). Date-less calls (daily maintenance, client
cut) behave exactly as before. Due-day collision (BM-8 2d, migration
`20260810190000_partial_personal_debt_and_due_collision.sql`): when
`due_day <= statement_day`, `cut_card_statement` moves the archive's due date
to the next month, matching the TS twin `getCardStatementPeriod` — otherwise a
card like statement_day=30 / due_day=31 could produce
`due_date = statement_date`. `replace_card_statement_import` also rejects a
PDF whose period already has a paid archive (or any paid archive with a newer
statement date): the rebuild scope only recognizes open archives, so replaying
a paid period would add the debt a second time and silently delete preserved
plans' open installments.

A carryover action without an explicit `existingExpenseId` reuses the ongoing
plan server-side: if exactly one preserved parent on the same card matches the
PDF's installment count and (normalized) description and carries paid/settled
history, its open children are rebuilt under that parent instead of creating a
new parent expense each month. Amount drift is deliberately not a matching
criterion (SI-07 accepts parent-total drift with a note); any ambiguity falls
back to a fresh parent.

The server-side daily maintenance job (`run_scheduled_card_maintenance`) calls
the same audited RPCs used by the client, **in this order** (migration
`20260905100000`):

1. `post_card_provision` for stale provisions (≥ `p_provision_stale_days`)
2. `post_due_card_installments`
3. `cut_due_card_statements`

The order is load-bearing: stale provisions must post BEFORE the cut so they
make it into the statement being cut. The old order (cut first, provisions
last) leaked even a cut-day stale provision into the NEXT statement while the
bank had already billed it (2026-09-05 case). `cut_due_card_statements` only
looks at cards with `current_period_spending > 0`, so posting first also lets a
card whose only movement is a provision cut correctly. No double count:
`post_card_provision` creates past-due installment rows directly as `posted`
and adds their total to the current bucket itself; `post_due_card_installments`
only flips `scheduled` rows. Real-DB regression:
`supabase/tests/provision_statement_cut_order.sql`
(`npm run db:test:provision-cut-order`).

Do not duplicate their money-moving logic in a scheduler or page component.

### Installment capture around the 7-day auto-post

`run_scheduled_card_maintenance(p_provision_stale_days default 7)` posts a
provision **exactly as it stands**. Since a bank SMS never carries the
installment count, an unmarked provision becomes a single-charge plan on day 7 —
the total debt is right either way, only the bucket/timing is wrong, but after
the statement cut the repair falls back to append-only corrections. Three
layers close that gap, cheapest first:

1. **Before the purchase** — `card_installment_intents` (Kartlar → Ekstreler →
   "Bekleyen taksit niyeti"): the count is captured at decision time and applied
   the moment the SMS provision lands.
2. **Days 2–7** — push notification `provision_installment_pending` (preference
   column `provisions_enabled`) nags for provisions ≥ 1000 TL still marked as a
   single charge. Thresholds live next to `PROVISION_AUTO_POST_DAYS` in
   `supabase/functions/push-notify/index.ts` and must track
   `p_provision_stale_days`.
3. **After posting** — "Taksitlendir" on the recent-card-movements panel
   (`update_card_expense`), valid until the row is statement-linked.

A second provision gap is the STATEMENT CUT (2026-09-05 case): a provision the
bank already approved but the user forgot to post stays in the provision bucket
and misses the statement. Two layers close it:

1. Stale provisions post before the cut (maintenance order above) — automatic.
2. Push notification `provision_statement_cut_risk` (same `provisions_enabled`
   preference): fires once per card+statement date when the cut is ≤
   `PROVISION_STATEMENT_CUT_WARN_DAYS` (2) days away and provisions exist that
   will NOT reach the stale threshold by the cut run — exactly the set layer 1
   cannot save. Deliberately NOT auto-posted: a provision the bank still holds
   must not enter the statement.

After the cut has already happened the repair is the statement PDF import
(posting now would write the amount into the NEXT statement); Data Health
flags this state (see below).

The provisions panel enforces the same boundary: a provision dated on or before
an open archive's statement date cannot be posted individually or through the
bulk action. Its installment label and cancellation remain available, while a
direct action opens statement import. `post_card_provision` repeats the guard
server-side so stale clients cannot move the amount into the next period.

The statement PDF import remains the authority of last resort: its `1/9` lines
rebuild the real plan. Principle: **SMS is a guess, the PDF is the truth.**

## Payment Semantics

Bank screens may label only the immediately payable amount as current debt and
show future installments separately. Live reconciliation therefore asks for the
bank's total remaining card burden including all future installments. The
`reconcile_card_bank_snapshot` action changes only total debt and may repair an
exactly proven historical archive allocation before a full current-period
payment. It never debits a bank account; recording the payment remains a
separate action with an explicit source account.

`cardPayableDebt(card)` is:

```text
max(0, statement_debt_amount + current_period_spending)
```

Payable debt excludes provisions and future scheduled installment debt. A
provision must be posted before it becomes payable. Future installments first
become current-period debt when their own due date passes, then become payable
through the normal statement cut; they are not added again to dashboard debt.

Installment "paidness" in the UI is derived, not stored: statement payment
intentionally never touches installment rows, so `isInstallmentSettled`
(`src/utils/cardInstallmentCalendar.ts`) treats a row as paid when its status is
`paid`, it is linked to a current settlement, or its statement archive is
`paid`. `fetchCardInstallmentsByExpenseIds` embeds the archive status for this;
progress counters ("X/9 ödendi") must use this helper instead of raw status.

### Partial / minimum statement payments (K7, `20260812110000`)

A statement can be paid in parts. The archive row stays immutable (its guard
trigger forbids amount edits); each payment is appended to
`card_statement_payments` (append-only: update/delete raise, insert is
RPC/restore only). The remaining balance is therefore DERIVED:

```text
remaining(archive) = archive.statement_debt_amount − Σ card_statement_payments.amount
cards.statement_debt_amount = Σ remaining(open archives)
```

`pay_card_statement(p_amount)` appends the payment, debits the source account
(unless `p_skip_source_debit`), and closes the archive only when the payment
equals the remaining balance. `private.statement_remaining_amount` is the SQL
side of this projection; `src/utils/cardStatementPayments.ts` is its TS twin and
every "açık ekstre" surface (cards list, control center, statements panel,
liabilities page, obligations projection) reads remaining through it — an archive
whose remainder hit zero shows up nowhere and imposes no due date. The K4
double-payment guard still applies: a zero statement bucket refuses payment.
The payment drawer's amount is editable for statements too, and the minimum-payment
hint uses the remaining statement balance as its base (never the current-period
bucket). pgTAP: `partial_statement_payment.sql`.

The canonical user flow is paying an open statement with `pay_card_statement`.
The archive's amount is bank truth; payment does not infer or mutate individual
installment lifecycle state. `pay_card_debt` is the optional manual/early payment path for posted
debt that is not represented by an open statement — including the full
current-period balance before the statement is cut (the Yapı Kredi pattern).
The cards page exposes it as a "Borç öde" button on each
credit-card row (shared payment drawer, editable amount defaulting to
`cardPayableDebt`, bank-account source). The button is disabled while the card
has an open statement archive, because `pay_card_debt` lowers
`statement_debt_amount` without closing the archive row (data health would flag
the mismatch) — the same reason the obligations calendar only emits its
`pay_card_debt` item for cards without an open statement.
The former `/borclar/kartlar` page applied the same guard; it was removed on
2026-09-08 (orphaned after UI-1 pointed the tab at the Accounts card section),
so the Accounts page is now the only pay surface and carries this guard alone.

The UI guard is now backed by a database guard as well (audit 2026-08-12 K4,
migration `20260812091000`): `pay_card_statement` refuses to pay an open archive
when the card's statement bucket is already zero, because that means the debt
was settled through another flow (`pay_card_debt`, import reconciliation) and a
second payment would debit the bank twice. Partial bucket drift (bucket > 0 but
below the archive amount) still does NOT block payment — only the
full-double-payment case is stopped. pgTAP: `statement_double_payment_guard.sql`.

The calendar's `pay_card_debt` item carries `maxPayableAmount`
(= `cardPayableDebt`) alongside its nominal `amount`
(= `statement_debt_amount`): the payment drawer validates and quick-fills
against the ceiling, while cash-flow projections keep using the nominal amount
so statement and current-period loads are not double-counted across months.

When `pay_card_debt` closes the full current-period balance, the database must
be able to allocate that amount exactly to posted, unstatemented single expenses
and posted installment rows. The allocation is recorded through
`card_current_settlements` and `current_settlement_id`; allocated single expenses
are excluded from later statement cuts and allocated installment rows become
`paid`. This prevents an early-paid movement from returning on the next
statement. Settled rows are historical evidence and cannot be edited or
deleted. A partial current-period payment remains aggregate-only and therefore
does not claim individual movement rows.

Legacy versions allowed aggregate-only payments that could leave already-paid
movements unallocated. On a later full current-period payment, the database
first tries the high-provenance repair: when `all unallocated posted - current
period` exactly equals all unallocated posted rows before the active
statement-cycle start, those rows receive a source-less `historical_repair`
settlement and no new cash or card-total movement. Any difference that remains
after that (legitimate row-less bucket moves: statement-import bank-total lock,
refund adjustments, auto-payment amount corrections, partial aggregate
payments) no longer hard-rejects the payment. All unallocated rows are attached
to the payment settlement and the bucket-vs-row difference is recorded as an
auditable residual (settlement note + `correction` history row); the bucket
reaches zero and consistency self-heals on every full payment.

Both `pay_card_debt` and `pay_card_statement` accept `p_skip_source_debit`
(default false): when the bank account balance was already reduced by the SMS
automation for the same payment, the RPC validates the source account but does
not debit it again; the history note records this. The payment drawer offers
this only when it finds an SMS-sourced outgoing movement on the selected
account with the same amount within the last 3 days.

The allocation marker is not a client-editable shortcut. Trigger authorization
requires the canonical RPC's transaction-local context plus matching user, card,
and parent rows. Current-settlement markers are removed from backup children
because their immutable parent is export-only. Historical statement markers are
restored constrained by same-user/same-card RLS; since `restore_user_finance_data_tx`
(migration `20260826090000`) replay is one server transaction whose final
cross-parent assertion re-verifies that every restored child points at the same
user's parent, so a failed restore changes nothing and foreign-parent payloads
are rejected outright.

Cash-flow/obligation projections must not reuse a paid statement's old due date
for new current-period spending. When no statement is pending, the current-period
cash due date comes from the card's active statement period; after the statement
day has passed, a paid statement due date (for example July 14) belongs to the
old statement, while new current-period spending moves to the next cycle (for
example August 14). When a statement is still pending, current-period spending
remains one cycle after that pending statement so both loads never collide.

When `pay_payment` is funded by a credit card instead of a bank account, it is
card spending, not cash outflow: the selected credit card receives a posted
expense and its `debt_amount` / `current_period_spending` increase by the paid
amount.

Card-instructed (`bank_auto` + card source) planned payments are informational
since BM-5: nothing posts them to the card proactively (the client hook and the
`post_due_card_auto_payments` maintenance RPC were removed). The real record
arrives from the SMS automation — which also advances the plan via the
`record_sms_card_expense` match — or from the monthly statement import
(`reconcile_card_payment_expenses` after recording the bank row); manual payment stays available from the
obligations calendar and the dashboard Şerit row, though not from the payment
record card itself. Estimated amounts are therefore never written to a card.

DenizBank statement/current movement imports use `pay_payment_from_card_import`
for rows that match a still-open manual planned payment. It is the same credit-card
spending semantics as `pay_payment`, but the generated `card_expenses.spent_at`
uses the bank row date and the note keeps the planned-payment due date. This
prevents a bill from staying pending after its card movement is imported.

All card-expense-producing import paths carry a stable source event identity.
Statement/current-movement PDFs use the document-text SHA-256 plus a canonical row
content hash and that content's occurrence ordinal. The occurrence is intentionally
part of the identity: two identical rows in one document are two events, but
retrying/reimporting either row is a no-op; reordering different rows does not change IDs.

`post_card_debt_correction` sets `app.ledger_kind` / `app.ledger_note` and, since
migration `20260816170000`, clears them again before returning. Without that
reset every later card write in the same transaction inherited the correction's
label and note, so a following `cancel_card_expense` landed in the ledger as
`adjustment` instead of `credit` — amounts stayed correct, the audit trail did
not. Any RPC that sets these GUCs must clear them on the way out.

A cancelled row no longer reserves its source-event identity (BM-6): the unique
index and the `add_card_expense` / `record_card_installment_carryover` /
`pay_payment_from_card_import` idempotency lookups all exclude `status =
'cancelled'`. So re-importing (or re-entering) the same row after an accidental
cancel creates a fresh active row — this is the canonical way to undo a cancel.
Genuine retries still collapse because they arrive within the same transaction
window (advisory lock) before any human cancel can intervene. `record_sms_card_expense`
is intentionally excluded: a webhook retry carries no human intent, so a cancelled
SMS row is not revived by the same text (it returns via statement import if real).

## Ledger Authority

`card_ledger` is the append-only audit trail for `cards.debt_amount`. Ordinary
RPCs continue to update `cards.debt_amount`; the trigger records each delta as
integer kuruş. Repair flows follow the same append-only rule:

- `recompute_card_debt_from_ledger` pulls `debt_amount` back to the exact ledger
  projection and suppresses the trigger for that repair write.
- `post_card_debt_correction` is the preferred manual fix. It changes
  `debt_amount` through a signed adjustment and records the reason in
  `card_ledger`.
- `reconcile_card_bank_snapshot` is the bank-truth total-only fix. It preserves
  visible buckets, records the total delta as an adjustment, and repairs only
  exact paid-archive allocation gaps.
- Data Health's `apply_data_health_safe_repairs` may invoke the recompute or
  clamp invariant only after locking every submitted card and validating the
  exact scan-time `updated_at`; the whole card/account plan rolls back on one
  stale target and records a conflict receipt. Applied/skipped targets receive
  immutable before/after step receipts.

Authenticated REST clients have no `card_ledger` INSERT grant or policy. Ledger
events are produced only by hardened trigger/correction paths; an owner-readable
append-only table is not client-writable aggregate authority.

Do not patch `debt_amount` directly from page code or data-health logic. Use the
ledger correction RPCs or fix the upstream transition that created the drift.
Scheduled-debt gaps, partial scheduled overlaps, and installment overflow do not
identify which side is stale without bank truth; Data Health reports them as
non-fixable review issues and must not derive/write a replacement debt total.
Structural installment findings never use generic Data Health REST writes.
Current, unallocated plans navigate to the canonical parent-plan editor that
owns sibling locks/rebuilds; archived, settled, or ambiguous history remains
manual reconciliation because rebuilding it would rewrite historical membership.

### Bucket Tracking

Each `card_ledger` event now carries three nullable bucket deltas:
`statement_delta_kurus`, `current_delta_kurus`, `provision_delta_kurus`. These
are computed automatically by the AFTER trigger from `OLD` vs `NEW` breakdown
fields — no RPC changes needed.

- `'reclass'` kind captures zero-debt-delta bucket shifts (e.g. statement cut
  moves current → statement without changing total debt).
- `projectCardSplit(events)` in `src/utils/cardLedger.ts` is the TS projection.
  `complete: true` means all events had bucket deltas (full-fidelity).
- `recompute_card_debt_from_ledger` uses bucket projections when all events have
  deltas, falling back to the current → statement → provision heuristic otherwise.
- Pre-migration events have null deltas and cannot be backfilled.

The `LiveReconciliationPanel` (rendered both on `/kartlar` via `CardsPage.tsx`
and on `/veri-sagligi` via `DataHealthPage.tsx`) now offers a "Farkı düzelt"
button for credit cards: user enters the bank's real debt (total remaining
burden including future installments) and the panel applies it through
`reconcile_card_bank_snapshot` — no PDF import needed. (`post_card_debt_correction`
remains the generic signed-correction RPC used by the statement-import lock.)

## Data-Health Expectations

Successive statement snapshots may leave historical installment rows on an
older parent and the open suffix on a newer parent. Data Health does not demand
duplicate continuation rows on the older parent when user/card, description
(only `N.Tk` removed; charge component preserved), original bank count and base
date match unambiguously. Legacy manual remaining-count parents are mapped back
to the bank's sequence using the description marker and local current number;
conflicting devir notes/non-manual sources are not reinterpreted. A renumbered
paid legacy child's date after its own paid archive cut permits only the bounded
previous-month inference for matching, never a stored date change. The latest
current row needs observed lifecycle/allocation evidence; older rows must all
be historical through the latest observed sequence. Monthly kurus amounts match
exactly except one kurus at the observed final installment, or explicitly named
cash-advance principal/interest/tax components with varying monthly amounts.
The latest plan retains real missing-row checks and ambiguous matches retain
warnings. Billing progression does not assert payment and performs no writes.

Equal rows from one statement PDF may be legitimate separate bank movements.
Distinct occurrence indices under the same artifact/signature hashes, together
with the same validated own-user/card statement archive and matching transaction
fields, suppress only the duplicate candidate signal. Rows and totals remain
unchanged. Different files/sources/archives, reused occurrence IDs and legacy
unknown provenance retain review findings even if their statements are paid.

Data health may flag:

- split total greater than `debt_amount`
- scheduled installments wholly missing from debt composition
- partial overlap where visible split + scheduled installments exceed total debt
  even though the visible split alone does not
- unexplained card debt where `debt_amount` is greater than visible split plus
  scheduled installments
- cards over shared/individual limit
- statement/archive mismatches
- overdue open statement archives that likely need a `pay_card_statement` flow
- provisions older than an open archive's cut date (statement-cut leftovers,
  `card-statement-provision-leftover-*`): review-only, points to the statement
  PDF import — posting the provision now would land it in the NEXT statement,
  so no automatic fix is offered
- Card-list due-date and overdue badges use the earliest unpaid open archive's
  `due_date`. `nextMonthlyDate(due_day)` is only a fallback when no payable open
  archive exists; it cannot be used to detect an already overdue statement.
- ledger drift between `card_ledger` projection and `cards.debt_amount`

When fixing one of these, keep the field transition above intact and prefer a
single RPC/helper change over page-local compensation.

## Kart döngüsü sunumu (2026-09-06)
Dashboard utils/cardPaymentCycle.ts ile kesilmiş ekstre kalanı için ortak nakit tahsisi gösterir. Arşiv ödemeleri düşülür; dönem içi ve gelecek taksitler bugünkü ekstreye katılmaz. Tüm kart borcu sonrası fark = nakit − debt_amount toplamı; ekstre ödemesi her iki tarafı eşit azaltır, yeni harcama farkı düşürür. Bu salt okuma, ledger/RPC veya borç kovalarını değiştirmez. Senaryo ileri taksit/kart talimatını tahmini ekstre vadesinde nakde taşır; temel cashFlowForecast korunur. Ayrıntı: docs/CARD_PAYMENT_CYCLE_PROPOSAL.md.

## 2026-09-07 sunum notu
Kredi kartları ve banka hesapları ayrı listelerdedir. Toplam kart yükü debt_amount toplamıdır (provizyon ve gelecek taksitler dahil); banka hesaplarındaki para current_balance toplamıdır, kart borcu düşülmez. Açık ekstreli karttaki Ekstreyi öde bağlantısı mevcut Ekstreler akışına gider. Borç geçişleri ve RPC sözleşmesi değişmemiştir.

## 2026-09-15 — Denetim düzeltmeleri

Şerit özetinde toplam borçtan ekstre/dönem/provizyon çıkınca kalan artık “Taksit / sınıflanmamış borç” olarak gösterilir; yalnız gelecekteki taksitlerin kesin toplamı olduğu iddia edilmez. Ledger kovaları ve geçmiş olaylar değişmez. Asgari ipucu ekstre tabanında, limit ≤50.000 TL için %20, üstünde %40'tır (financeObligationRules.ts). Kart SMS alias lookup yalnız servis rolüne açık resolve_sms_card_alias RPC'sini kullanır; yazım/idempotency RPC'si korunur.

## Kart/hesap sunumu (2026-10-10)

Ana kart görünümü kesinleşmiş dönem içi toplamı, `scheduled` gelecek taksitleri,
kısmi ödemeler sonrası açık ekstre kalanını ve provizyonu ayrı gösterir.
Toplam kart yükü bu kovaların yerine geçmez. `CardsPage.summary.tsx` salt sunumdur;
kart/hesap ayrıntısına geçiş, kategori düzenleme ve gider grubu tamamlama borç
geçişi oluşturmaz. Kart ayrıntısındaki ödeme/import/iptal mevcut kanonik
RPC'lerden geçer; ekstre/taksit dökümleri seçilen kartla sınırlıdır.

12 Ekim 2026: kategori düzenleme dönem hareketleri dökümüne taşındı; yalnız
kesinleşmiş “Diğer” harcamaları kapsar ve düzenlenecek kayıt yoksa pasiftir.
Kategori yazımı mevcut metadata yolunu kullanır; tutar, taksit, borç kovaları
ve ledger geçişleri değişmez.

## Değişken banka faturası / abonelik kanıtı (2026-10-15)

Otomatik `bank_auto` planlarında SMS veya import önce gerçek banka harcamasını
oluşturur. `reconcile_card_payment_expenses()` mevcut harcamayı karta tekrar
borç yazmadan ödeme planına bağlar; ödenmiş ekstreye bağlı eski satırlar da salt
kanıt olarak okunabilir. Kart/harcama/ekstre/kova/ledger alanları bu bağlantıda
aynen kalır. Kart ekstresinin nakit ödemesi ayrı olaydır.

Kurum + kart + sıradaki vadeye ±7 gün + tekil banka satırı/plan şarttır.
Tahmini tanınan faturada tutar değişebilir; ortak Apple açıklaması ayırt edici
sabit tutarla kontrol edilir. Abone no yokken iki sözleşme arasında tahmin
edilmez. Plan ileri alınır ve gerçek tutarlı geçmiş append edilir; kanıtsız ay
atlanmaz. Ayrıntılı kaynak sözleşme `docs/FINANCE_RULES.md`, SQL kanıtı
`supabase/tests/variable_bill_matching.sql`, saf ikiz `utils/paymentMatching.ts`.

15 Ekim 2026 canlı kontrol eki: `match_amount` ile kullanıcı tarafından
doğrulanan sabit abonelik fiyatına, eski ayların medyanıyla daha düşük/yüksek
tutar önerilmez (`utils/paymentEstimate.ts` ve regresyonu). Kart/ödeme/ledger
yazması değişmez; değişken fatura önerileri korunur.
