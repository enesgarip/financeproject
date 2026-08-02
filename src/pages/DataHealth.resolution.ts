import type { HealthIssue } from './DataHealth.logic'

export const HEALTH_RESOLUTION_MODES = [
  'auto_recompute',
  'guarded_one_click',
  'guided_domain_action',
  'manual_reconciliation',
  'informational',
] as const

export type HealthResolutionMode = (typeof HEALTH_RESOLUTION_MODES)[number]

export type HealthResolutionPrimaryAction = 'fix' | 'navigate' | 'payment' | 'review'

export type HealthResolutionUndoPolicy =
  | 'session_snapshot'
  | 'domain_managed'
  | 'not_available'
  | 'not_applicable'

export type HealthIssueResolution = Readonly<{
  mode: HealthResolutionMode
  title: string
  label: string
  bulkEligible: boolean
  undoPolicy: HealthResolutionUndoPolicy
  sourceOfTruth: string
  primaryAction: HealthResolutionPrimaryAction
}>

function autoRecompute(
  label: string,
  sourceOfTruth: string,
  bulkEligible = true,
): HealthIssueResolution {
  return {
    mode: 'auto_recompute',
    title: 'Kaynak veriden yeniden hesapla',
    label,
    bulkEligible,
    undoPolicy: 'not_available',
    sourceOfTruth,
    primaryAction: 'fix',
  }
}

function guardedOneClick(
  label: string,
  sourceOfTruth: string,
  options: Partial<Pick<HealthIssueResolution, 'bulkEligible' | 'undoPolicy'>> = {},
): HealthIssueResolution {
  return {
    mode: 'guarded_one_click',
    title: 'Kontrollü düzeltme',
    label,
    bulkEligible: options.bulkEligible ?? false,
    undoPolicy: options.undoPolicy ?? 'session_snapshot',
    sourceOfTruth,
    primaryAction: 'fix',
  }
}

function guidedNavigation(label: string, sourceOfTruth: string): HealthIssueResolution {
  return {
    mode: 'guided_domain_action',
    title: 'İlgili işlem akışında çöz',
    label,
    bulkEligible: false,
    undoPolicy: 'domain_managed',
    sourceOfTruth,
    primaryAction: 'navigate',
  }
}

function guidedPayment(label: string, sourceOfTruth: string): HealthIssueResolution {
  return {
    mode: 'guided_domain_action',
    title: 'Ödeme akışında çöz',
    label,
    bulkEligible: false,
    undoPolicy: 'domain_managed',
    sourceOfTruth,
    primaryAction: 'payment',
  }
}

function guidedReview(label: string, sourceOfTruth: string): HealthIssueResolution {
  return {
    ...guidedNavigation(label, sourceOfTruth),
    primaryAction: 'review',
  }
}

function manualReconciliation(sourceOfTruth: string, label = 'Kayıtları karşılaştır'): HealthIssueResolution {
  return {
    mode: 'manual_reconciliation',
    title: 'Manuel uzlaştırma gerekli',
    label,
    bulkEligible: false,
    undoPolicy: 'not_applicable',
    sourceOfTruth,
    primaryAction: 'review',
  }
}

function informational(sourceOfTruth: string, label = 'Bilgiyi incele'): HealthIssueResolution {
  return {
    mode: 'informational',
    title: 'Bilgi ve takip önerisi',
    label,
    bulkEligible: false,
    undoPolicy: 'not_applicable',
    sourceOfTruth,
    primaryAction: 'review',
  }
}

function updateTouchesAny(issue: HealthIssue, fields: readonly string[]) {
  const updates = issue.payload?.updates
  if (!updates) return false
  return fields.some((field) => Object.hasOwn(updates, field))
}

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addMonthsClamped(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null

  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate()
  return localDateValue(new Date(targetYear, normalizedMonthIndex, Math.min(day, lastDay)))
}

function containsOnlyFutureMissingInstallments(issue: HealthIssue) {
  const baseDate = issue.payload?.baseDate
  const installmentNos = issue.payload?.installmentNos
  if (!baseDate || !installmentNos || installmentNos.length === 0) return false

  const today = localDateValue(new Date())
  return installmentNos.every((installmentNo) => {
    const dueDate = addMonthsClamped(baseDate, installmentNo - 1)
    return dueDate !== null && dueDate > today
  })
}

function resolveDebtSplit(issue: HealthIssue): HealthIssueResolution {
  if (issue.id.startsWith('card-split-')) {
    return guardedOneClick(
      'Borç kırılımını sınırla',
      'Kart toplam borcu ve borç kırılımı sınırlandırma kuralının kanonik öncelik sırası.',
      { bulkEligible: true, undoPolicy: 'not_available' },
    )
  }

  if (issue.id.startsWith('card-unclassified-debt-')) {
    return manualReconciliation(
      'Banka borcu, açık ekstre ve dönem içi hareketler; açıklanamayan fark tek başına bir borç kovası seçmez.',
    )
  }

  if (issue.id.startsWith('card-orphan-statement-debt-')) {
    return manualReconciliation(
      'Ekstre arşivi, ödeme geçmişi ve banka hareketleri; açık arşivin yokluğu borcun dönem içine ait olduğunu kanıtlamaz.',
    )
  }

  return manualReconciliation(
    'Banka borcu, ekstre arşivi ve kart hareketleri; bilinmeyen kırılım kuralı otomatik yazma yetkisi vermez.',
  )
}

function resolveCardTypeFields(issue: HealthIssue): HealthIssueResolution {
  if (
    updateTouchesAny(issue, [
      'debt_amount',
      'statement_debt_amount',
      'current_period_spending',
      'provision_amount',
      'current_balance',
    ])
  ) {
    return manualReconciliation(
      'Kart türü, kart ve hesap hareket kayıtları ile geçmiş işlemler; kullanılmayan görünen parasal alanlar kanıtsız sıfırlanamaz.',
    )
  }

  return guardedOneClick(
    'Teknik kart alanlarını normalize et',
    'Kart türünün parasal olmayan alan sözleşmesi.',
  )
}

function resolveAssetShape(issue: HealthIssue): HealthIssueResolution {
  if (updateTouchesAny(issue, ['amount'])) {
    return manualReconciliation(
      'Varlık türü ve değerleme modeli; altın, hisse ve döviz varlıklarında amount kaynak miktardır.',
    )
  }

  return guardedOneClick(
    'Teknik varlık alanlarını normalize et',
    'Varlık kategorisinin parasal olmayan alan sözleşmesi.',
  )
}

function resolveDebtShape(issue: HealthIssue): HealthIssueResolution {
  if (updateTouchesAny(issue, ['amount'])) {
    return manualReconciliation(
      'Borç değer türü ve değerleme modeli; döviz ve altın kayıtlarında amount kaynak miktardır.',
    )
  }

  return guardedOneClick(
    'Teknik borç alanlarını normalize et',
    'Borç değer türünün parasal olmayan alan sözleşmesi.',
  )
}

function resolveMissingInstallments(issue: HealthIssue): HealthIssueResolution {
  if (!containsOnlyFutureMissingInstallments(issue)) {
    return manualReconciliation(
      'Banka ekstresi ve ödeme kanıtı; geçmiş eksik satırların ödendiği veya işlendiği varsayılamaz.',
      'Taksit geçmişini uzlaştır',
    )
  }

  return guidedNavigation(
    'Taksit planını düzenle',
    'Harcama ve aynı plana bağlı tüm satırlar; tamamlama kart işlem akışında kilit altında yeniden kurulmalıdır.',
  )
}

const INFORMATIONAL_MANUAL_ID_PREFIXES = [
  'budget-zero-',
  'salary-duplicate-',
  'goal-complete-active-',
  'goal-overdue-',
  'payment-ended-',
] as const

const GUIDED_MANUAL_ID_PREFIXES: ReadonlyArray<readonly [string, string, string]> = [
  ['asset-gold-amount-', 'Varlığı düzenle', 'Varlık miktarı ve değerleme kaydı.'],
  ['asset-zero-value-', 'Varlığı düzenle', 'Varlık değeri ve değerleme kaydı.'],
  ['card-missing-days-', 'Kartı düzenle', 'Kartın banka sözleşmesindeki ekstre ve son ödeme günleri.'],
  ['card-limit-missing-', 'Kartı düzenle', 'Bankanın güncel kart limiti.'],
  ['loan-no-plan-', 'Kredi planını aç', 'Kredi sözleşmesi ve taksit planı.'],
  ['loan-zero-payment-', 'Krediyi düzenle', 'Kredi sözleşmesindeki aylık ödeme.'],
  ['debt-fx-currency-', 'Borcu düzenle', 'Borç/alacağın gerçek para birimi.'],
  ['debt-zero-', 'Borcu düzenle', 'Borç/alacağın gerçek değeri.'],
  ['debt-gold-amount-', 'Borcu düzenle', 'Altın borç/alacağının gerçek miktarı.'],
  ['debt-overdue-', 'Borcu aç', 'Borç/alacağın gerçek kapanma ve tahsilat durumu.'],
  ['salary-zero-', 'Maaşı düzenle', 'Geçerlilik tarihindeki gerçek net maaş.'],
  ['goal-composite-empty-', 'Hedefi düzenle', 'Birikim hedefinin kullanıcı tanımlı bileşenleri.'],
  ['goal-composite-zero-target-', 'Hedefi düzenle', 'Birikim hedefinin kullanıcı tanımlı bileşen hedefleri.'],
  ['goal-zero-target-', 'Hedefi düzenle', 'Kullanıcının gerçek birikim hedefi.'],
  ['payment-overdue-', 'Ödemeyi aç', 'Ödemenin gerçek durumu ve ödeme geçmişi.'],
  ['payment-zero-', 'Ödemeyi düzenle', 'Ödemenin gerçek veya tahmini tutarı.'],
  ['payment-no-day-', 'Ödemeyi düzenle', 'Aylık ödemenin kullanıcı tanımlı tekrar günü.'],
]

function resolveManualIssue(issue: HealthIssue): HealthIssueResolution {
  if (issue.id.startsWith('card-scheduled-') && !issue.id.startsWith('card-scheduled-debt-')) {
    return guardedOneClick(
      'Kart bakımını çalıştır',
      'Taksit vade tarihi ve idempotent post_due_card_installments geçişi.',
      { undoPolicy: 'domain_managed' },
    )
  }

  if (INFORMATIONAL_MANUAL_ID_PREFIXES.some((prefix) => issue.id.startsWith(prefix))) {
    return informational('Kullanıcı tercihi veya takip zamanı; mevcut veri tek başına bir değişiklik gerektirmez.')
  }

  const guided = GUIDED_MANUAL_ID_PREFIXES.find(([prefix]) => issue.id.startsWith(prefix))
  if (guided) return guidedNavigation(guided[1], guided[2])

  return manualReconciliation(
    'İlgili finans kaydı, geçmiş hareketler ve gerektiğinde banka veya kullanıcı doğrulaması.',
  )
}

function assertNeverKind(kind: never): never {
  throw new Error(`Bilinmeyen veri sağlığı çözüm türü: ${String(kind)}`)
}

export function resolveHealthIssue(issue: HealthIssue): HealthIssueResolution {
  switch (issue.kind) {
    case 'cardLedgerDrift':
      return autoRecompute('Borcu hareketlerden hesapla', 'Değişmez kart borç hareketlerinin kuruş toplamı.')
    case 'cardSplitDrift':
      return autoRecompute(
        'Borç kırılımını ledger’dan hesapla',
        'Eksiksiz kart hareketlerinin ekstre, dönem içi ve provizyon kırılımı.',
      )
    case 'accountLedgerDrift':
      return autoRecompute('Bakiyeyi hareketlerden hesapla', 'Değişmez hesap hareketlerinin kuruş toplamı.')
    case 'loanTotals':
      return autoRecompute(
        'Kredi özetini plandan hesapla',
        'Ödenmemiş loan_installments satırlarının transaction içindeki kilitli projeksiyonu.',
        false,
      )
    case 'cardDebtSplit':
      return resolveDebtSplit(issue)
    case 'cardTypeFields':
      return resolveCardTypeFields(issue)
    case 'assetShape':
      return resolveAssetShape(issue)
    case 'debtShape':
      return resolveDebtShape(issue)
    case 'budgetMonth':
      return guardedOneClick(
        'Bütçe ayını hizala',
        'Aylık bütçe anahtarı ve aynı ay/kategori çakışma önkoşulu.',
      )
    case 'cardExpenseAmount':
      return guidedNavigation(
        'Taksit planını düzenle',
        'Harcama toplamı ve aynı plana bağlı tüm satırlar; değişiklik kart işlem akışında atomik uygulanmalıdır.',
      )
    case 'cardSingleInstallments':
      return guidedNavigation(
        'Plan satırlarını incele',
        'Peşin harcama ve bağlı plan satırları; çok satırlı silme atomik kart işlem akışında doğrulanmalıdır.',
      )
    case 'cardMissingInstallments':
      return resolveMissingInstallments(issue)
    case 'cardInstallmentDueMonth':
      return guidedNavigation(
        'Taksit planını düzenle',
        'Harcama tarihi, ana kayıt ve aynı plana bağlı tüm satırlar; plan atomik kart düzenleme akışında yeniden kurulmalıdır.',
      )
    case 'cardInstallmentPostedAt':
      if (issue.id.startsWith('card-installment-clear-posted-at-')) {
        return guidedNavigation(
          'Taksit planını incele',
          'Ana harcama ve aynı plana bağlı tüm yaşam döngüsü kayıtları; alan tek satırlı veri yazımıyla değiştirilemez.',
        )
      }
      return manualReconciliation(
        'Gerçek işlenme zamanı veya banka hareketi; eksik tarih için “şimdi” değeri kanıt değildir.',
      )
    case 'cardInstallmentCount':
      return guidedNavigation(
        'Taksit planını düzenle',
        'Harcama ve aynı plana bağlı, ekstreye ayrılmamış tüm satırların kilitli yapısı.',
      )
    case 'cardStatementTotals':
      return manualReconciliation(
        'Immutable ekstre arşivi, bağlı hareketler ve banka ekstresi; arşiv toplamı doğrudan güncellenemez.',
      )
    case 'cardStatementStatus':
      return manualReconciliation(
        'Değişmez ekstre yaşam döngüsü, ödeme kaynağı ve banka ödeme kanıtı.',
      )
    case 'cardOverduePayment':
      return guidedPayment(
        'Ödeme çekmecesini aç',
        'Açık ekstre, gerçek kaynak banka hesabı ve pay_card_statement işlemi.',
      )
    case 'cardScheduledDebt':
    case 'cardScheduledDebtOverlap':
    case 'cardInstallmentOverflow':
      return manualReconciliation(
        'Banka borcu ve taksit planı; bileşen uyuşmazlığı hangi tarafın eski olduğunu kanıtlamaz.',
      )
    case 'duplicateTransactionCandidate':
      return manualReconciliation(
        'Banka hareketleri ve kullanıcı doğrulaması; işlem izi benzerliği tekrar kanıtı değildir.',
        'Harcamaları karşılaştır',
      )
    case 'cardExpenseDataQuality':
      return guidedReview(
        'Harcamaları düzenle',
        'Kullanıcının gerçek işlem açıklaması ve kategori tercihi.',
      )
    case 'loanInstallmentDueDay':
      return manualReconciliation(
        'Kredi sözleşmesi ve taksidin gerçek ödeme durumu; ödenmiş tarihsel satır değiştirilemez.',
      )
    case 'loanPaidAtMissing':
    case 'loanPendingPaidAt':
      return manualReconciliation(
        'Gerçek ödeme olayı, kaynak hesap ve ödeme tarihi; durum ile ödeme zamanı arasından biri kanıtsız seçilemez.',
      )
    case 'paymentRecurrenceFields':
      return guardedOneClick(
        'Tekrar alanlarını temizle',
        'Tek seferlik ödeme recurrence sözleşmesi.',
      )
    case 'paymentDueDay':
      return guardedOneClick(
        'Ödeme tarihini hizala',
        'Aylık tekrar günü ve mevcut ödeme dönemi.',
      )
    case 'manual':
      return resolveManualIssue(issue)
    default:
      return assertNeverKind(issue.kind)
  }
}
