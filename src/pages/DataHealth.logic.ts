import type {
  AccountLedger,
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardLedger,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
} from '../types/database'
import { balanceDrift, projectAccountBalance, type AccountLedgerEvent } from '../utils/accountLedger'
import { ledgerDrift, projectCardDebt, type CardLedgerEvent } from '../utils/cardLedger'
import { dateInputValue, formatDate } from '../utils/date'
import {
  buildCreditLimitGroups,
  cardDebtBreakdown,
  cardProvisionAmount,
  clampCardBreakdown,
  expectedInstallmentAmount,
  projectLoanSummary,
  scheduledCardInstallmentTotalsByCard,
} from '../utils/financeSummary'
import { formatCurrency } from '../utils/formatCurrency'
import { exceedsTL, moneyDiffers, roundTL } from '../utils/money'
import { formatComponentAmount, formatSavingsGoalAmount, savingsGoalBelowTarget, savingsGoalTargetReached, savingsGoalValueTypeLabel } from '../utils/savingsGoal'

export type HealthData = {
  assets: Asset[]
  budgets: Budget[]
  cards: Card[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardLedger: CardLedger[]
  accountLedger: AccountLedger[]
  cardStatementArchives: CardStatementArchive[]
  debts: Debt[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  savingsGoals: SavingsGoal[]
  savingsGoalComponents: SavingsGoalComponent[]
}

export type HealthIssue = {
  id: string
  area: 'Varlıklar' | 'Bütçeler' | 'Kartlar' | 'Krediler' | 'Kişiler' | 'Planlı' | 'Maaş' | 'Hedefler'
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  details: string[]
  fixable: boolean
  fixLabel?: string
  kind:
    | 'cardDebtSplit'
    | 'cardTypeFields'
    | 'cardExpenseAmount'
    | 'cardSingleInstallments'
    | 'cardMissingInstallments'
    | 'cardInstallmentDueMonth'
    | 'cardInstallmentPostedAt'
    | 'cardInstallmentCount'
    | 'cardStatementTotals'
    | 'cardScheduledDebt'
    | 'cardLedgerDrift'
    | 'accountLedgerDrift'
    | 'assetShape'
    | 'budgetMonth'
    | 'debtShape'
    | 'loanTotals'
    | 'loanInstallmentDueDay'
    | 'loanPaidAtMissing'
    | 'loanPendingPaidAt'
    | 'paymentRecurrenceFields'
    | 'paymentDueDay'
    | 'manual'
  payload?: {
    assetId?: string
    budgetId?: string
    cardId?: string
    debtId?: string
    loanId?: string
    paymentId?: string
    statementArchiveId?: string
    ids?: string[]
    updates?: Record<string, string | number | null>
    statementDebt?: number
    currentPeriod?: number
    provisionAmount?: number
    scheduledTotal?: number
    nextDebtAmount?: number
    remainingAmount?: number
    remainingInstallments?: number
    loanStatus?: Loan['status']
    dueDate?: string
    userId?: string
    expenseId?: string
    cardExpenseId?: string
    installmentNos?: number[]
    installmentCount?: number
    baseMonth?: string
    amount?: number
    totalAmount?: number
    description?: string
    category?: string
  }
}

export type UndoTable =
  | 'assets'
  | 'budgets'
  | 'cards'
  | 'card_expenses'
  | 'card_installments'
  | 'card_statement_archives'
  | 'debts'
  | 'loans'
  | 'loan_installments'
  | 'payments'

export type UndoRow = Record<string, unknown> & { id: string }

export type UndoEntry =
  | {
      action: 'restoreRows'
      table: UndoTable
      rows: UndoRow[]
    }
  | {
      action: 'deleteRows'
      table: UndoTable
      ids: string[]
    }

export type UndoBatch = {
  id: string
  label: string
  createdAt: string
  entries: UndoEntry[]
}

export function currentMonthStart() {
  const today = new Date()
  return dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1))
}

function todayValue() {
  return dateInputValue(new Date())
}

function monthStart(value: string | null | undefined) {
  if (!value) return currentMonthStart()
  return `${value.slice(0, 7)}-01`
}

function isMonthStart(value: string | null | undefined) {
  return Boolean(value) && value === monthStart(value)
}

export function addMonthsToMonthStart(value: string, months: number) {
  const [year, month] = monthStart(value).slice(0, 7).split('-').map(Number)
  if (!year || !month) return currentMonthStart()
  return dateInputValue(new Date(year, month - 1 + months, 1))
}

function dateInMonthValue(sourceDate: string, preferredDay: number) {
  const [year, month] = sourceDate.split('-').map(Number)
  if (!year || !month || !preferredDay) return sourceDate
  const lastDay = new Date(year, month, 0).getDate()
  return dateInputValue(new Date(year, month - 1, Math.min(preferredDay, lastDay)))
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)
}

function cardLabel(card: Card | undefined) {
  if (!card) return 'Kart bulunamadı'
  return `${card.bank_name} · ${card.card_name}`
}

function activeCardExpense(expense: CardExpense) {
  return expense.status !== 'cancelled'
}

function parseLegacyPaidCount(expense: CardExpense) {
  const match = expense.note?.match(/(\d+)\/(\d+)\s+taksiti uygulama öncesinde/)
  if (!match) return 0

  const paid = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(paid) || total !== expense.installment_count) return 0

  return Math.max(0, Math.min(expense.installment_count - 1, paid))
}

function inferInstallmentBaseMonth(expense: CardExpense, rows: CardInstallment[]) {
  if (rows.length === 0) return monthStart(expense.spent_at)

  const earliest = [...rows].sort((a, b) => a.installment_no - b.installment_no)[0]
  return addMonthsToMonthStart(earliest.due_month, 1 - earliest.installment_no)
}

function formatGoalComponentProgress(component: SavingsGoalComponent) {
  const label = component.label?.trim() || savingsGoalValueTypeLabel(component.value_type)
  return `${label}: ${formatComponentAmount(component, component.current_amount)} / ${formatComponentAmount(component, component.target_amount)}`
}

export function buildIssues(data: HealthData): HealthIssue[] {
  const issues: HealthIssue[] = []
  const monthStartNow = currentMonthStart()
  const today = todayValue()
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
  const expensesById = new Map(data.cardExpenses.map((expense) => [expense.id, expense]))
  const installmentsByExpense = new Map<string, CardInstallment[]>()
  const installmentsByLoan = new Map<string, LoanInstallment[]>()
  const componentsByGoal = new Map<string, SavingsGoalComponent[]>()

  for (const item of data.cardInstallments) {
    if (!item.card_expense_id) continue
    installmentsByExpense.set(item.card_expense_id, [...(installmentsByExpense.get(item.card_expense_id) ?? []), item])
  }

  for (const item of data.loanInstallments) {
    installmentsByLoan.set(item.loan_id, [...(installmentsByLoan.get(item.loan_id) ?? []), item])
  }

  for (const item of data.savingsGoalComponents) {
    componentsByGoal.set(item.goal_id, [...(componentsByGoal.get(item.goal_id) ?? []), item])
  }

  const scheduledInstallmentsByCard = scheduledCardInstallmentTotalsByCard(data.cardInstallments)

  for (const asset of data.assets) {
    const updates: Record<string, string | number | null> = {}
    const details: string[] = []

    if (asset.category === 'Nakit') {
      if (!asset.currency) {
        updates.currency = 'TRY'
        details.push('Nakit varlıkta para birimi boş → TRY')
      }
      if (asset.amount !== 1 || asset.unit !== 'TRY') {
        updates.amount = 1
        updates.unit = 'TRY'
        details.push('Nakit varlıkta miktar/birim teknik alanları normalize edilecek.')
      }
    } else {
      if (asset.currency) {
        updates.currency = null
        details.push('Nakit dışı varlıkta para birimi temizlenecek.')
      }
      if (asset.category === 'Hisse') {
        if (asset.unit !== 'TRY') {
          updates.unit = 'TRY'
          details.push('Hisse varlıkta birim teknik alanı TRY yapılacak; adet miktarı korunacak.')
        }
      } else if (asset.category !== 'Altın' && (asset.amount !== 1 || asset.unit !== 'TRY')) {
        updates.amount = 1
        updates.unit = 'TRY'
        details.push('Altın dışı varlıkta miktar/birim teknik alanları normalize edilecek.')
      }
    }

    if (asset.category === 'Altın' && asset.amount <= 0) {
      issues.push({
        id: `asset-gold-amount-${asset.id}`,
        area: 'Varlıklar',
        severity: 'warning',
        title: `${asset.name} altın miktarı eksik`,
        description: 'Altın varlığında miktar 0 görünüyor; değer girilmiş olsa bile miktar takibi eksik kalır.',
        details: [`Değer: ${formatCurrency(asset.estimated_value_try)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (asset.estimated_value_try <= 0) {
      issues.push({
        id: `asset-zero-value-${asset.id}`,
        area: 'Varlıklar',
        severity: 'info',
        title: `${asset.name} değeri 0 görünüyor`,
        description: 'Net durum ve varlık dağılımı bu kaydı etkili hesaplayamaz.',
        details: [`Kategori: ${asset.category}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (Object.keys(updates).length > 0) {
      issues.push({
        id: `asset-shape-${asset.id}`,
        area: 'Varlıklar',
        severity: 'warning',
        title: `${asset.name} alanları kategoriyle uyuşmuyor`,
        description: 'Kategori değişiminden kalmış teknik alanlar var.',
        details,
        fixable: true,
        fixLabel: 'Varlık alanlarını düzelt',
        kind: 'assetShape',
        payload: { assetId: asset.id, updates },
      })
    }
  }

  const budgetsByMonthCategory = new Map<string, Budget[]>()
  for (const budget of data.budgets) {
    const normalizedMonth = monthStart(budget.month)
    const duplicateKey = `${normalizedMonth}:${budget.category.trim().toLocaleLowerCase('tr-TR')}`
    budgetsByMonthCategory.set(duplicateKey, [...(budgetsByMonthCategory.get(duplicateKey) ?? []), budget])

    if (!isMonthStart(budget.month)) {
      issues.push({
        id: `budget-month-${budget.id}`,
        area: 'Bütçeler',
        severity: 'warning',
        title: `${budget.category} bütçe ayı hizasız`,
        description: 'Bütçe ayı ayın ilk günü olmalı; aylık analizler bu formatla çalışıyor.',
        details: [`Ay: ${formatDate(budget.month)} → ${formatDate(normalizedMonth)}`],
        fixable: true,
        fixLabel: 'Bütçe ayını hizala',
        kind: 'budgetMonth',
        payload: { budgetId: budget.id, updates: { month: normalizedMonth } },
      })
    }

    if (budget.limit_amount <= 0) {
      issues.push({
        id: `budget-zero-${budget.id}`,
        area: 'Bütçeler',
        severity: 'info',
        title: `${budget.category} bütçe limiti 0`,
        description: '0 TL bütçe limiti harcama/bütçe karşılaştırmasını kullanışsız hale getirir.',
        details: [`Ay: ${formatDate(normalizedMonth)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  for (const [key, rows] of budgetsByMonthCategory) {
    if (rows.length <= 1) continue
    const [month] = key.split(':')
    const category = rows[0]?.category ?? 'Kategori'
    issues.push({
      id: `budget-duplicate-${key}`,
      area: 'Bütçeler',
      severity: 'warning',
      title: `${category} bütçesi aynı ayda tekrarlı`,
      description: 'Aynı ay ve kategori için birden fazla bütçe kaydı analizleri çift saydırabilir.',
      details: [`Ay: ${formatDate(month)}`, `Kayıt sayısı: ${rows.length}`],
      fixable: false,
      kind: 'manual',
    })
  }

  for (const card of data.cards) {
    const updates: Record<string, string | number | null> = {}
    const details: string[] = []

    if (card.card_type === 'banka_karti') {
      if (card.credit_limit !== 0 || card.debt_amount !== 0 || card.statement_debt_amount !== 0 || card.current_period_spending !== 0 || cardProvisionAmount(card) !== 0) {
        updates.credit_limit = 0
        updates.debt_amount = 0
        updates.statement_debt_amount = 0
        updates.current_period_spending = 0
        updates.provision_amount = 0
        details.push('Banka kartında kredi/borç alanları 0 olmalı.')
      }
      if (card.statement_day !== null || card.due_day !== null) {
        updates.statement_day = null
        updates.due_day = null
        details.push('Banka kartında ekstre/son ödeme günü temizlenecek.')
      }
    } else if (card.current_balance !== 0) {
      updates.current_balance = 0
      details.push('Kredi kartında hesap bakiyesi teknik alanı 0 olmalı.')
    }

    if (Object.keys(updates).length > 0) {
      issues.push({
        id: `card-type-fields-${card.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} kart türü alanları karışmış`,
        description: 'Kart türüne ait olmayan alanlar dolu kalmış.',
        details,
        fixable: true,
        fixLabel: 'Kart alanlarını normalize et',
        kind: 'cardTypeFields',
        payload: { cardId: card.id, updates },
      })
    }
  }

  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti')) {
    const { statement: statementDebt, provision: provisionAmount, current: currentPeriod } = clampCardBreakdown(
      card.debt_amount,
      card.statement_debt_amount,
      card.current_period_spending,
      cardProvisionAmount(card),
    )

    if (
      moneyDiffers(statementDebt, card.statement_debt_amount) ||
      moneyDiffers(currentPeriod, card.current_period_spending) ||
      moneyDiffers(provisionAmount, cardProvisionAmount(card))
    ) {
      issues.push({
        id: `card-split-${card.id}`,
        area: 'Kartlar',
        severity: 'error',
        title: `${cardLabel(card)} borç kırılımı tutarsız`,
        description: 'Ekstre borcu, dönem içi kesinleşen ve provizyon toplamı güncel toplam borcu aşıyor.',
        details: [
          `Güncel borç: ${formatCurrency(card.debt_amount)}`,
          `Ekstre borcu: ${formatCurrency(card.statement_debt_amount)} → ${formatCurrency(statementDebt)}`,
          `Dönem içi: ${formatCurrency(card.current_period_spending)} → ${formatCurrency(currentPeriod)}`,
          `Provizyon: ${formatCurrency(cardProvisionAmount(card))} → ${formatCurrency(provisionAmount)}`,
        ],
        fixable: true,
        fixLabel: 'Borç kırılımını düzelt',
        kind: 'cardDebtSplit',
        payload: { cardId: card.id, statementDebt, currentPeriod, provisionAmount },
      })
    }

    const debtBreakdown = cardDebtBreakdown(card, scheduledInstallmentsByCard.get(card.id) ?? 0)
    const { splitTotal, scheduledTotal } = debtBreakdown

    if (debtBreakdown.hasScheduledDebtGap) {
      const nextDebtAmount = debtBreakdown.nextDebtAmount

      issues.push({
        id: `card-scheduled-debt-${card.id}`,
        area: 'Kartlar',
        severity: 'error',
        title: `${cardLabel(card)} planlı taksitleri limitten düşmüyor`,
        description: 'Gelecek taksitler kayıtlı ama kart borcuna eklenmemiş; kalan limit yanlış yüksek görünür.',
        details: [
          `Planlı taksit: ${formatCurrency(scheduledTotal)}`,
          `Güncel borç: ${formatCurrency(card.debt_amount)}`,
          `Önerilen borç: ${formatCurrency(nextDebtAmount)}`,
        ],
        fixable: true,
        fixLabel: 'Planlı taksitleri borca ekle',
        kind: 'cardScheduledDebt',
        payload: { cardId: card.id, scheduledTotal, nextDebtAmount },
      })
    }

    if (debtBreakdown.hasUnexplainedDebt) {
      const unexplained = debtBreakdown.unexplainedAmount
      const hasInstallmentExpenses = data.cardExpenses.some(
        (expense) => expense.card_id === card.id && expense.status === 'posted' && expense.installment_count > 1,
      )

      issues.push({
        id: `card-unclassified-debt-${card.id}`,
        area: 'Kartlar',
        severity: scheduledTotal > 0 ? 'warning' : 'info',
        title: `${cardLabel(card)} borç kırılımında eksik pay`,
        description:
          scheduledTotal > 0
            ? 'Toplam borç gelecek taksitleri de içerir; bu farkın çoğu planlı taksitlerden gelir ve dönem içine yazılmamalıdır.'
            : 'Toplam borç, ekstre + dönem içi + provizyon toplamından yüksek. Farkı ekstre borcuna aktarmak daha güvenlidir.',
        details: [
          `Toplam borç: ${formatCurrency(card.debt_amount)}`,
          `Ekstre + dönem + provizyon: ${formatCurrency(splitTotal)}`,
          scheduledTotal > 0 ? `Planlı taksit (beklenen fark): ${formatCurrency(scheduledTotal)}` : null,
          `Düzeltilmesi gereken: ${formatCurrency(unexplained)}`,
          hasInstallmentExpenses && !exceedsTL(scheduledTotal, 0)
            ? 'Taksitli harcama var ama plan satırı eksik olabilir; eksik taksit uyarılarına da bak.'
            : null,
        ].filter((item): item is string => Boolean(item)),
        fixable: true,
        fixLabel: 'Ekstre borcuna aktar',
        kind: 'cardDebtSplit',
        payload: {
          cardId: card.id,
          statementDebt: roundTL(card.statement_debt_amount + unexplained),
          currentPeriod: card.current_period_spending,
          provisionAmount: cardProvisionAmount(card),
        },
      })
    }

    if (card.debt_amount > 0 && (!card.statement_day || !card.due_day)) {
      issues.push({
        id: `card-missing-days-${card.id}`,
        area: 'Kartlar',
        severity: 'info',
        title: `${cardLabel(card)} ekstre günü eksik`,
        description: 'Ekstre ve son ödeme günü olmadan ödeme alarmı ve aylık akış daha az doğru çalışır.',
        details: [`Ekstre: ${card.statement_day ?? '-'}`, `Son ödeme: ${card.due_day ?? '-'}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (card.credit_limit <= 0 && card.debt_amount > 0) {
      issues.push({
        id: `card-limit-missing-${card.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} limit bilgisi eksik`,
        description: 'Borç var ama limit 0 görünüyor; limit kullanımı hesapları yanıltıcı olur.',
        details: [`Borç: ${formatCurrency(card.debt_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  // Ledger drift (A2.1): stored debt vs the append-only event projection. With
  // the AFTER trigger in place this is normally 0; a non-zero value means an
  // out-of-band write slipped past the ledger. Only checked when ledger events
  // exist for the card (table deployed + backfilled).
  const ledgerEventsByCard = new Map<string, CardLedgerEvent[]>()
  for (const event of data.cardLedger) {
    ledgerEventsByCard.set(event.card_id, [...(ledgerEventsByCard.get(event.card_id) ?? []), event])
  }

  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti')) {
    const cardEvents = ledgerEventsByCard.get(card.id)
    if (!cardEvents || cardEvents.length === 0) continue

    const drift = ledgerDrift(cardEvents, card.debt_amount)
    if (drift === 0) continue

    const projection = projectCardDebt(cardEvents)
    issues.push({
      id: `card-ledger-drift-${card.id}`,
      area: 'Kartlar',
      severity: 'error',
      title: `${cardLabel(card)} borcu hareket geçmişiyle uyuşmuyor`,
      description: 'Kayıtlı borç, borç hareketleri toplamından farklı; kayıt dışı bir değişiklik olmuş olabilir.',
      details: [
        `Kayıtlı borç: ${formatCurrency(card.debt_amount)}`,
        `Hareket toplamı: ${formatCurrency(projection)}`,
        `Fark: ${drift > 0 ? '+' : ''}${formatCurrency(drift)}`,
      ],
      fixable: true,
      fixLabel: 'Hareketlere göre düzelt',
      kind: 'cardLedgerDrift',
      payload: { cardId: card.id, nextDebtAmount: projection },
    })
  }

  // Bank account balance drift vs the account ledger projection (Faz 3.1).
  // Normally 0 (trigger keeps them in sync); non-zero means an out-of-band write.
  const accountEventsByCard = new Map<string, AccountLedgerEvent[]>()
  for (const event of data.accountLedger) {
    accountEventsByCard.set(event.card_id, [...(accountEventsByCard.get(event.card_id) ?? []), event])
  }

  for (const card of data.cards.filter((item) => item.card_type === 'banka_karti')) {
    const accountEvents = accountEventsByCard.get(card.id)
    if (!accountEvents || accountEvents.length === 0) continue

    const drift = balanceDrift(accountEvents, card.current_balance)
    if (drift === 0) continue

    const projection = projectAccountBalance(accountEvents)
    issues.push({
      id: `account-ledger-drift-${card.id}`,
      area: 'Kartlar',
      severity: 'error',
      title: `${cardLabel(card)} bakiyesi hareket geçmişiyle uyuşmuyor`,
      description: 'Kayıtlı bakiye, hesap hareketleri toplamından farklı; kayıt dışı bir değişiklik olmuş olabilir.',
      details: [
        `Kayıtlı bakiye: ${formatCurrency(card.current_balance)}`,
        `Hareket toplamı: ${formatCurrency(projection)}`,
        `Fark: ${drift > 0 ? '+' : ''}${formatCurrency(drift)}`,
      ],
      fixable: true,
      fixLabel: 'Hareketlere göre düzelt',
      kind: 'accountLedgerDrift',
      payload: { cardId: card.id, nextDebtAmount: projection },
    })
  }

  for (const group of buildCreditLimitGroups(data.cards)) {
    if (group.limit > 0 && exceedsTL(group.debt, group.limit)) {
      issues.push({
        id: `card-limit-over-${group.key}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${group.label} limit üstünde`,
        description: 'Ortak/tekil limit borç toplamından düşük görünüyor.',
        details: [`Limit: ${formatCurrency(group.limit)}`, `Borç: ${formatCurrency(group.debt)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  for (const archive of data.cardStatementArchives) {
    const card = cardsById.get(archive.card_id)

    // Not: Arşiv toplamı için alanlar-arası bir eşitlik kontrolü yapılmaz.
    // cut_card_statement, total_debt_amount = kartın tam borcu (taksitler dahil),
    // statement_debt_amount = current_period_spending = ekstre tutarı olarak yazar;
    // bu yüzden total == statement + current_period beklentisi her zaman yanlış alarm üretir.

    if (archive.due_date && archive.due_date < archive.statement_date) {
      issues.push({
        id: `card-archive-date-order-${archive.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} arşiv son ödeme tarihi ters`,
        description: 'Ekstre arşivinde son ödeme tarihi ekstre tarihinden önce görünüyor.',
        details: [`Ekstre: ${formatDate(archive.statement_date)}`, `Son ödeme: ${formatDate(archive.due_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  const scheduledByCard = new Map<string, CardInstallment[]>()
  for (const item of data.cardInstallments.filter((row) => row.status === 'scheduled' && row.due_month <= monthStartNow)) {
    scheduledByCard.set(item.card_id, [...(scheduledByCard.get(item.card_id) ?? []), item])
  }

  for (const [cardId, rows] of scheduledByCard) {
    const card = cardsById.get(cardId)
    const total = rows.reduce((sum, item) => sum + item.amount, 0)
    const pastCount = rows.filter((item) => item.due_month < monthStartNow).length

    issues.push({
      id: `card-scheduled-${cardId}`,
      area: 'Kartlar',
      severity: pastCount > 0 ? 'warning' : 'info',
      title: `${cardLabel(card)} dönem içine alınmamış taksit`,
      description: 'Bu taksitler hâlâ planlı görünüyor; dönem/ekstre durumunu elle kontrol etmek daha güvenli.',
      details: [`Taksit sayısı: ${rows.length}`, `Toplam: ${formatCurrency(total)}`, pastCount > 0 ? `${pastCount} tanesi geçmiş ayda.` : 'Bu ay içinde.'],
      fixable: false,
      kind: 'manual',
    })
  }

  for (const expense of data.cardExpenses.filter(activeCardExpense)) {
    const card = cardsById.get(expense.card_id)
    const rows = installmentsByExpense.get(expense.id) ?? []
    const expectedAmount = expectedInstallmentAmount(expense.amount, expense.installment_count)

    if (card && card.card_type !== 'kredi_karti' && (expense.installment_count > 1 || rows.length > 0)) {
      issues.push({
        id: `card-expense-bank-card-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} banka kartına bağlı`,
        description: 'Taksit planı kredi kartı üzerinde olmalı; banka kartına bağlı taksit kayıtları analizleri şaşırtabilir.',
        details: [`Kart: ${cardLabel(card)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (expense.amount <= 0) {
      issues.push({
        id: `card-expense-zero-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} harcama tutarı 0`,
        description: '0 tutarlı kart harcaması taksit ve dönem hesaplarını kullanışsız hale getirir.',
        details: [`Kart: ${cardLabel(card)}`, `Taksit: ${expense.installment_count}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (expense.installment_count <= 1 && rows.length > 0) {
      issues.push({
        id: `card-expense-single-has-installments-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} tek çekim ama taksit satırı var`,
        description: 'Bu işlem peşin görünüyor; harcama kaydı kalacak, sadece analizleri şişiren taksit planı satırları temizlenecek.',
        details: [`Satır sayısı: ${rows.length}`, `Kart: ${cardLabel(card)}`, `Tutar: ${formatCurrency(expense.amount)}`],
        fixable: true,
        fixLabel: 'Peşin plan satırlarını kaldır',
        kind: 'cardSingleInstallments',
        payload: { ids: rows.map((row) => row.id) },
      })
    }

    if (moneyDiffers(expense.installment_amount, expectedAmount)) {
      issues.push({
        id: `card-expense-amount-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} taksit tutarı tutarsız`,
        description: 'Harcama toplamı ve taksit sayısından beklenen taksit tutarı farklı.',
        details: [
          `Kayıtlı taksit: ${formatCurrency(expense.installment_amount)}`,
          `Beklenen: ${formatCurrency(expectedAmount)}`,
          `Toplam: ${formatCurrency(expense.amount)} · ${expense.installment_count} taksit`,
        ],
        fixable: true,
        fixLabel: 'Taksit tutarını düzelt',
        kind: 'cardExpenseAmount',
        payload: { expenseId: expense.id, updates: { installment_amount: expectedAmount } },
      })
    }
  }

  for (const installment of data.cardInstallments) {
    const expense = installment.card_expense_id ? expensesById.get(installment.card_expense_id) : null
    const card = cardsById.get(installment.card_id)
    const isSingleExpensePlan = Boolean(expense && expense.installment_count <= 1)

    if (isSingleExpensePlan) continue

    if (card && card.card_type !== 'kredi_karti') {
      issues.push({
        id: `card-installment-bank-card-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} taksiti banka kartına bağlı`,
        description: 'Kart taksitleri kredi kartı üzerinde tutulmalı; banka kartına bağlı taksit aylık akışı yanlış gösterebilir.',
        details: [`Kart: ${cardLabel(card)}`, `Taksit: ${installment.installment_no}/${installment.installment_count}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (!isMonthStart(installment.due_month)) {
      issues.push({
        id: `card-installment-month-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} taksit ayı ay başı değil`,
        description: 'Kart taksitleri ay bazlı hesaplandığı için due_month alanı ayın 1. günü olmalı.',
        details: [`Tarih: ${formatDate(installment.due_month)} → ${formatDate(monthStart(installment.due_month))}`],
        fixable: true,
        fixLabel: 'Taksit ayını düzelt',
        kind: 'cardInstallmentDueMonth',
        payload: { ids: [installment.id], updates: { due_month: monthStart(installment.due_month) } },
      })
    }

    if (installment.status === 'posted' && !installment.posted_at) {
      issues.push({
        id: `card-installment-posted-at-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} işlenme tarihi eksik`,
        description: 'Döneme alınmış taksitlerde posted_at boş kalmış.',
        details: [`Taksit: ${installment.installment_no}/${installment.installment_count}`],
        fixable: true,
        fixLabel: 'İşlenme tarihini tamamla',
        kind: 'cardInstallmentPostedAt',
        payload: { ids: [installment.id], updates: { posted_at: new Date().toISOString() } },
      })
    }

    if (installment.status === 'scheduled' && installment.posted_at) {
      issues.push({
        id: `card-installment-clear-posted-at-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} planlı taksitte işlenme tarihi var`,
        description: 'Planlı taksitlerde posted_at boş olmalı.',
        details: [`Taksit: ${installment.installment_no}/${installment.installment_count}`],
        fixable: true,
        fixLabel: 'İşlenme tarihini kaldır',
        kind: 'cardInstallmentPostedAt',
        payload: { ids: [installment.id], updates: { posted_at: null } },
      })
    }

    if (expense && installment.installment_count !== expense.installment_count) {
      issues.push({
        id: `card-installment-count-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} taksit sayısı harcamayla uyuşmuyor`,
        description: 'Taksit satırındaki toplam taksit sayısı, bağlı harcama kaydından farklı.',
        details: [`Satır: ${installment.installment_count}`, `Harcama: ${expense.installment_count}`],
        fixable: true,
        fixLabel: 'Taksit sayısını düzelt',
        kind: 'cardInstallmentCount',
        payload: { ids: [installment.id], updates: { installment_count: expense.installment_count } },
      })
    }

    if (installment.amount <= 0) {
      issues.push({
        id: `card-installment-zero-${installment.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${installment.description} taksit tutarı 0`,
        description: '0 tutarlı kart taksiti analiz ve yaklaşan taksitleri yanıltabilir.',
        details: [`Taksit: ${installment.installment_no}/${installment.installment_count}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  for (const expense of data.cardExpenses.filter((item) => item.status === 'posted' && item.installment_count > 1)) {
    const rows = installmentsByExpense.get(expense.id) ?? []
    const existingNos = new Set(rows.map((row) => row.installment_no))
    const paidBefore = parseLegacyPaidCount(expense)
    const expectedNos = range(paidBefore + 1, expense.installment_count)
    const missingNos = expectedNos.filter((installmentNo) => !existingNos.has(installmentNo))
    const extraRows = rows.filter((row) => row.installment_no <= paidBefore || row.installment_no > expense.installment_count)
    const baseMonth = inferInstallmentBaseMonth(expense, rows)
    const futureMissingNos = missingNos.filter((installmentNo) => addMonthsToMonthStart(baseMonth, installmentNo - 1) > monthStartNow)
    const card = cardsById.get(expense.card_id)

    if (missingNos.length > 0) {
      issues.push({
        id: `card-expense-missing-${expense.id}`,
        area: 'Kartlar',
        severity: futureMissingNos.length > 0 ? 'error' : 'warning',
        title: `${expense.description} eksik taksit satırı`,
        description: 'Taksitli kart harcamasının beklenen plan satırlarının bir kısmı yok.',
        details: [
          `Kart: ${cardLabel(card)}`,
          `Eksik: ${missingNos.map((item) => `${item}/${expense.installment_count}`).join(', ')}`,
          paidBefore > 0 ? `${paidBefore} taksit uygulama öncesi ödenmiş işaretli.` : `Başlangıç: ${formatDate(expense.spent_at)}`,
        ],
        fixable: futureMissingNos.length > 0,
        fixLabel: futureMissingNos.length > 0 ? 'Eksik gelecek taksitleri ekle' : undefined,
        kind: futureMissingNos.length > 0 ? 'cardMissingInstallments' : 'manual',
        payload:
          futureMissingNos.length > 0
            ? {
                userId: expense.user_id,
                cardId: expense.card_id,
                cardExpenseId: expense.id,
                installmentNos: futureMissingNos,
                installmentCount: expense.installment_count,
                baseMonth,
                amount: roundTL(expense.installment_amount || expense.amount / expense.installment_count),
                totalAmount: expense.amount,
                description: expense.description,
                category: expense.category,
              }
            : undefined,
      })
    }

    if (extraRows.length > 0) {
      issues.push({
        id: `card-expense-extra-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} fazla taksit satırı`,
        description: 'Taksit numarası beklenen aralığın dışında. Silme işlemini otomatik yapmak riskli olduğu için sadece işaretliyorum.',
        details: [`Kart: ${cardLabel(card)}`, `Fazla satırlar: ${extraRows.map((item) => `${item.installment_no}/${item.installment_count}`).join(', ')}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (missingNos.length === 0 && extraRows.length === 0 && rows.length > 0) {
      const relevantRows = rows.filter((row) => expectedNos.includes(row.installment_no))
      const plannedTotal = roundTL(relevantRows.reduce((total, row) => total + row.amount, 0))
      const baseAmount = roundTL(expense.installment_amount || expense.amount / expense.installment_count)
      const expectedPlannedTotal = roundTL(
        expectedNos.reduce((total, installmentNo) => {
          const amount =
            installmentNo === expense.installment_count
              ? roundTL(expense.amount - baseAmount * (expense.installment_count - 1))
              : baseAmount
          return total + amount
        }, 0),
      )

      if (moneyDiffers(plannedTotal, expectedPlannedTotal)) {
        issues.push({
          id: `card-expense-plan-total-${expense.id}`,
          area: 'Kartlar',
          severity: 'warning',
          title: `${expense.description} taksit planı toplamı tutarsız`,
          description: 'Bağlı taksit satırlarının toplamı harcama kaydından beklenen kalan planla eşleşmiyor.',
          details: [
            `Kart: ${cardLabel(card)}`,
            `Plan toplamı: ${formatCurrency(plannedTotal)}`,
            `Beklenen: ${formatCurrency(expectedPlannedTotal)}`,
          ],
          fixable: false,
          kind: 'manual',
        })
      }
    }
  }

  for (const loan of data.loans) {
    const rows = installmentsByLoan.get(loan.id) ?? []
    const { remainingAmount, remainingInstallments, status: loanStatus } = projectLoanSummary(rows)

    if (rows.length > 0 && (moneyDiffers(loan.remaining_amount, remainingAmount) || loan.remaining_installments !== remainingInstallments || loan.status !== loanStatus)) {
      issues.push({
        id: `loan-totals-${loan.id}`,
        area: 'Krediler',
        severity: 'error',
        title: `${loan.loan_name} kalan bilgisi tutarsız`,
        description: 'Kredi kartındaki ödeme planı ile kredi özetindeki kalan tutar/taksit aynı değil.',
        details: [
          `Kalan borç: ${formatCurrency(loan.remaining_amount)} → ${formatCurrency(remainingAmount)}`,
          `Kalan taksit: ${loan.remaining_installments} → ${remainingInstallments}`,
          `Durum: ${loan.status} → ${loanStatus}`,
        ],
        fixable: true,
        fixLabel: 'Kredi özetini düzelt',
        kind: 'loanTotals',
        payload: { loanId: loan.id, remainingAmount, remainingInstallments, loanStatus },
      })
    }

    if (rows.length === 0 && loan.status === 'active' && loan.remaining_installments > 0) {
      issues.push({
        id: `loan-no-plan-${loan.id}`,
        area: 'Krediler',
        severity: 'info',
        title: `${loan.loan_name} ödeme planı yok`,
        description: 'Kredi aktif görünüyor ama taksit planı oluşturulmamış.',
        details: ['Krediler sayfasından plan oluşturulabilir.', `Kalan taksit: ${loan.remaining_installments}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (loan.status === 'active' && loan.remaining_amount > 0 && loan.monthly_payment <= 0) {
      issues.push({
        id: `loan-zero-payment-${loan.id}`,
        area: 'Krediler',
        severity: 'warning',
        title: `${loan.loan_name} aylık ödeme tutarı 0`,
        description: 'Aktif kredide aylık ödeme 0 göründüğü için nakit akışı eksik hesaplanır.',
        details: [`Kalan borç: ${formatCurrency(loan.remaining_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (loan.start_date && loan.end_date && loan.end_date < loan.start_date) {
      issues.push({
        id: `loan-date-order-${loan.id}`,
        area: 'Krediler',
        severity: 'warning',
        title: `${loan.loan_name} tarih aralığı ters`,
        description: 'Bitiş tarihi başlangıç tarihinden önce görünüyor.',
        details: [`Başlangıç: ${formatDate(loan.start_date)}`, `Bitiş: ${formatDate(loan.end_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (exceedsTL(loan.remaining_amount, loan.total_amount)) {
      issues.push({
        id: `loan-remaining-over-total-${loan.id}`,
        area: 'Krediler',
        severity: 'warning',
        title: `${loan.loan_name} kalan borç toplamdan büyük`,
        description: 'Kalan borç toplam kredi tutarını aşıyor; kayıt değerlerini gözden geçirmek gerekir.',
        details: [`Toplam: ${formatCurrency(loan.total_amount)}`, `Kalan: ${formatCurrency(loan.remaining_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (rows.length > 0) {
      const installmentNos = rows.map((item) => item.installment_no).sort((a, b) => a - b)
      const missingNos = range(installmentNos[0] ?? 1, installmentNos.at(-1) ?? 0).filter((installmentNo) => !installmentNos.includes(installmentNo))
      if (missingNos.length > 0) {
        issues.push({
          id: `loan-installment-gap-${loan.id}`,
          area: 'Krediler',
          severity: 'info',
          title: `${loan.loan_name} taksit numaralarında boşluk var`,
          description: 'Ödeme planındaki taksit numaraları sıralı değil.',
          details: [`Eksik numaralar: ${missingNos.join(', ')}`],
          fixable: false,
          kind: 'manual',
        })
      }
    }
  }

  for (const installment of data.loanInstallments) {
    const loan = loansById.get(installment.loan_id)

    if (installment.amount <= 0) {
      issues.push({
        id: `loan-installment-zero-${installment.id}`,
        area: 'Krediler',
        severity: 'warning',
        title: `${installment.installment_no}. kredi taksiti 0 TL`,
        description: '0 tutarlı kredi taksiti kalan borç ve aylık akış hesaplarını bozar.',
        details: [`Vade: ${formatDate(installment.due_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (loan?.installment_day) {
      const expectedDueDate = dateInMonthValue(installment.due_date, loan.installment_day)
      if (installment.due_date !== expectedDueDate) {
        issues.push({
          id: `loan-installment-due-day-${installment.id}`,
          area: 'Krediler',
          severity: 'warning',
          title: `${loan.loan_name} ${installment.installment_no}. taksit günü uyuşmuyor`,
          description: 'Kredi taksit tarihi, kredide tanımlı aylık ödeme günüyle hizalı değil.',
          details: [`Tarih: ${formatDate(installment.due_date)} → ${formatDate(expectedDueDate)}`, `Ödeme günü: ${loan.installment_day}`],
          fixable: true,
          fixLabel: 'Taksit gününü hizala',
          kind: 'loanInstallmentDueDay',
          payload: { ids: [installment.id], updates: { due_date: expectedDueDate } },
        })
      }
    }

  }

  const paidWithoutDate = data.loanInstallments.filter((item) => item.status === 'ödendi' && !item.paid_at)
  if (paidWithoutDate.length > 0) {
    issues.push({
      id: 'loan-paid-at-missing',
      area: 'Krediler',
      severity: 'warning',
      title: 'Ödenmiş kredi taksitinde ödeme tarihi eksik',
      description: 'Ödenmiş görünen taksitlerde paid_at alanı boş kalmış.',
      details: [`Satır sayısı: ${paidWithoutDate.length}`],
      fixable: true,
      fixLabel: 'Ödeme tarihlerini tamamla',
      kind: 'loanPaidAtMissing',
      payload: { ids: paidWithoutDate.map((item) => item.id) },
    })
  }

  const pendingWithDate = data.loanInstallments.filter((item) => item.status !== 'ödendi' && item.paid_at)
  if (pendingWithDate.length > 0) {
    issues.push({
      id: 'loan-pending-paid-at',
      area: 'Krediler',
      severity: 'warning',
      title: 'Bekleyen kredi taksitinde ödeme tarihi var',
      description: 'Bekleyen taksitlerde paid_at dolu kalmış.',
      details: [`Satır sayısı: ${pendingWithDate.length}`],
      fixable: true,
      fixLabel: 'Bekleyenlerden ödeme tarihini kaldır',
      kind: 'loanPendingPaidAt',
      payload: { ids: pendingWithDate.map((item) => item.id) },
    })
  }

  for (const debt of data.debts) {
    const updates: Record<string, string | number | null> = {}
    const details: string[] = []
    const isGold = debt.value_type === 'gram_altin' || debt.value_type === 'ceyrek_altin'

    if (debt.value_type === 'TRY' && debt.currency !== 'TRY') {
      updates.currency = 'TRY'
      details.push('TRY borç/alacak kaydında para birimi TRY olmalı.')
    }

    if (debt.value_type !== 'TRY' && debt.value_type !== 'doviz' && debt.currency !== null) {
      updates.currency = null
      details.push('Altın borç/alacak kaydında para birimi boş olmalı.')
    }

    if (debt.value_type === 'doviz' && (!debt.currency || debt.currency === 'TRY')) {
      issues.push({
        id: `debt-fx-currency-${debt.id}`,
        area: 'Kişiler',
        severity: 'warning',
        title: `${debt.person_name} döviz kaydında para birimi eksik`,
        description: 'Döviz borç/alacak kaydında USD, EUR veya GBP gibi bir para birimi seçili olmalı.',
        details: [`Para birimi: ${debt.currency ?? '-'}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (!isGold && debt.amount !== 1) {
      updates.amount = 1
      details.push('Nakit/döviz borç kaydında miktar teknik alanı 1 olmalı.')
    }

    if (Object.keys(updates).length > 0) {
      issues.push({
        id: `debt-shape-${debt.id}`,
        area: 'Kişiler',
        severity: 'warning',
        title: `${debt.person_name} borç alanları türle uyuşmuyor`,
        description: 'Değer türü değişiminden kalmış teknik alanlar var.',
        details,
        fixable: true,
        fixLabel: 'Borç alanlarını düzelt',
        kind: 'debtShape',
        payload: { debtId: debt.id, updates },
      })
    }

    if (debt.status === 'açık' && debt.estimated_value_try <= 0) {
      issues.push({
        id: `debt-zero-${debt.id}`,
        area: 'Kişiler',
        severity: 'warning',
        title: `${debt.person_name} açık borç/alacak değeri 0`,
        description: 'Açık kayıt 0 TL göründüğü için net borç/alacak hesabını etkili takip edemez.',
        details: [`Durum: ${debt.direction === 'borç_aldım' ? 'Ben borçluyum' : 'Bana borçlu'}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (isGold && debt.amount <= 0) {
      issues.push({
        id: `debt-gold-amount-${debt.id}`,
        area: 'Kişiler',
        severity: 'warning',
        title: `${debt.person_name} altın miktarı eksik`,
        description: 'Altın türündeki borç/alacakta miktar 0 görünüyor.',
        details: [`Değer: ${formatCurrency(debt.estimated_value_try)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (debt.status === 'açık' && debt.due_date && debt.due_date < today) {
      issues.push({
        id: `debt-overdue-${debt.id}`,
        area: 'Kişiler',
        severity: 'info',
        title: `${debt.person_name} vadesi geçmiş açık kayıt`,
        description: 'Vadesi geçmiş borç/alacak hâlâ açık görünüyor.',
        details: [`Vade: ${formatDate(debt.due_date)}`, `Değer: ${formatCurrency(debt.estimated_value_try)}`],
        fixable: false,
        kind: 'manual',
      })
    }

  }

  const salaryDates = new Map<string, SalaryHistory[]>()
  for (const salary of data.salaryHistory) {
    salaryDates.set(salary.effective_date, [...(salaryDates.get(salary.effective_date) ?? []), salary])

    if (salary.amount <= 0) {
      issues.push({
        id: `salary-zero-${salary.id}`,
        area: 'Maaş',
        severity: 'warning',
        title: `${salary.title} maaş tutarı 0`,
        description: '0 TL maaş kaydı aylık nakit akışı projeksiyonunu yanıltır.',
        details: [`Tarih: ${formatDate(salary.effective_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }

  }

  for (const [effectiveDate, rows] of salaryDates) {
    if (rows.length <= 1) continue
    issues.push({
      id: `salary-duplicate-${effectiveDate}`,
      area: 'Maaş',
      severity: 'info',
      title: `${formatDate(effectiveDate)} tarihinde birden fazla maaş kaydı`,
      description: 'Aynı geçerlilik tarihindeki maaş kayıtları trend hesabını belirsizleştirebilir.',
      details: rows.map((row) => `${row.title}: ${formatCurrency(row.amount)}`),
      fixable: false,
      kind: 'manual',
    })
  }

  for (const goal of data.savingsGoals) {
    const goalComponents = componentsByGoal.get(goal.id) ?? []
    const isComponentBackedGoal = goal.value_type === 'composite' || goalComponents.length > 0

    if (isComponentBackedGoal) {
      const componentsWithMissingTarget = goalComponents.filter((component) => component.target_amount <= 0)
      const incompleteComponents = goalComponents.filter(savingsGoalBelowTarget)
      const componentDetails = goalComponents.map(formatGoalComponentProgress)
      const goalKindLabel = goal.value_type === 'composite' ? 'karma hedef' : 'bileşenli hedef'

      if (goalComponents.length === 0) {
        issues.push({
          id: `goal-composite-empty-${goal.id}`,
          area: 'Hedefler',
          severity: 'warning',
          title: `${goal.name} ${goalKindLabel}inde bileşen yok`,
          description: 'Karma hedefler ilerlemeyi bileşen satırlarından hesaplar; en az bir bileşen eklenmeli.',
          details: ['Hedefi düzenleyip gram, çeyrek veya TRY bileşeni ekle.'],
          fixable: false,
          kind: 'manual',
        })
        continue
      }

      if (componentsWithMissingTarget.length > 0) {
        issues.push({
          id: `goal-composite-zero-target-${goal.id}`,
          area: 'Hedefler',
          severity: 'warning',
          title: `${goal.name} bileşen hedefi eksik`,
          description: 'Karma hedefte her bileşenin hedef miktarı 0 dan büyük olmalı.',
          details: componentsWithMissingTarget.map(formatGoalComponentProgress),
          fixable: false,
          kind: 'manual',
        })
      }

      if (goal.status === 'active' && componentsWithMissingTarget.length === 0 && incompleteComponents.length === 0) {
        issues.push({
          id: `goal-complete-active-${goal.id}`,
          area: 'Hedefler',
          severity: 'info',
          title: `${goal.name} hedefi tamamlanmış görünüyor`,
          description: 'Karma hedefin tüm bileşenleri tamamlanmış ama hedef hâlâ aktif durumda.',
          details: componentDetails,
          fixable: false,
          kind: 'manual',
        })
      }

      if (goal.status === 'completed' && incompleteComponents.length > 0) {
        issues.push({
          id: `goal-completed-under-target-${goal.id}`,
          area: 'Hedefler',
          severity: 'warning',
          title: `${goal.name} tamamlandı ama bileşen eksiği var`,
          description: 'Tamamlandı durumundaki karma hedefin bazı bileşenleri hedefin altında kalmış.',
          details: incompleteComponents.map(formatGoalComponentProgress),
          fixable: false,
          kind: 'manual',
        })
      }

      if (goal.status === 'active' && goal.target_date && goal.target_date < today && incompleteComponents.length > 0) {
        issues.push({
          id: `goal-overdue-${goal.id}`,
          area: 'Hedefler',
          severity: 'info',
          title: `${goal.name} hedef tarihi geçmiş`,
          description: 'Hedef tarihi geçmiş ama karma hedefin bazı bileşenleri henüz tamamlanmamış.',
          details: [`Hedef tarihi: ${formatDate(goal.target_date)}`, ...incompleteComponents.map(formatGoalComponentProgress)],
          fixable: false,
          kind: 'manual',
        })
      }

      continue
    }

    if (goal.target_amount <= 0) {
      issues.push({
        id: `goal-zero-target-${goal.id}`,
        area: 'Hedefler',
        severity: 'warning',
        title: `${goal.name} hedef tutarı 0`,
        description: '0 TL hedef tutarı hedef ilerlemesini anlamlı gösteremez.',
        details: [`Birikim: ${formatSavingsGoalAmount(goal, goal.current_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (goal.status === 'active' && savingsGoalTargetReached(goal)) {
      issues.push({
        id: `goal-complete-active-${goal.id}`,
        area: 'Hedefler',
        severity: 'info',
        title: `${goal.name} hedefi tamamlanmış görünüyor`,
        description: 'Birikim hedef tutarına ulaşmış ama hedef hâlâ aktif durumda.',
        details: [`Birikim: ${formatSavingsGoalAmount(goal, goal.current_amount)}`, `Hedef: ${formatSavingsGoalAmount(goal, goal.target_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (goal.status === 'completed' && savingsGoalBelowTarget(goal)) {
      issues.push({
        id: `goal-completed-under-target-${goal.id}`,
        area: 'Hedefler',
        severity: 'warning',
        title: `${goal.name} tamamlandı ama hedef altında`,
        description: 'Tamamlandı durumundaki hedefin birikimi hedef tutarının altında kalmış.',
        details: [`Birikim: ${formatSavingsGoalAmount(goal, goal.current_amount)}`, `Hedef: ${formatSavingsGoalAmount(goal, goal.target_amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (goal.status === 'active' && goal.target_date && goal.target_date < today && savingsGoalBelowTarget(goal)) {
      issues.push({
        id: `goal-overdue-${goal.id}`,
        area: 'Hedefler',
        severity: 'info',
        title: `${goal.name} hedef tarihi geçmiş`,
        description: 'Hedef tarihi geçmiş ama hedef henüz tamamlanmamış.',
        details: [
          `Hedef tarihi: ${formatDate(goal.target_date)}`,
          `Eksik: ${formatSavingsGoalAmount(goal, Math.max(0, goal.target_amount - goal.current_amount))}`,
        ],
        fixable: false,
        kind: 'manual',
      })
    }

  }

  for (const payment of data.payments) {
    if (payment.status === 'bekliyor' && payment.due_date < today) {
      issues.push({
        id: `payment-overdue-${payment.id}`,
        area: 'Planlı',
        severity: 'info',
        title: `${payment.title} vadesi geçmiş`,
        description: 'Bekleyen ödeme tarihi geçmiş görünüyor.',
        details: [`Vade: ${formatDate(payment.due_date)}`, `Tutar: ${formatCurrency(payment.amount)}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (payment.status === 'bekliyor' && payment.amount <= 0 && !(payment.payment_method === 'bank_auto' && payment.amount_status === 'estimated')) {
      issues.push({
        id: `payment-zero-${payment.id}`,
        area: 'Planlı',
        severity: 'warning',
        title: `${payment.title} ödeme tutarı 0`,
        description: 'Bekleyen ödeme 0 TL görünüyor; ödeme akışı eksik hesaplanır.',
        details: [`Tutar durumu: ${payment.amount_status}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (payment.recurrence === 'none' && (payment.recurrence_day !== null || payment.recurrence_end_date !== null)) {
      issues.push({
        id: `payment-recurrence-fields-${payment.id}`,
        area: 'Planlı',
        severity: 'warning',
        title: `${payment.title} tekrar alanları temiz değil`,
        description: 'Tek seferlik ödeme kaydında aylık tekrar alanları dolu kalmış.',
        details: [`Gün: ${payment.recurrence_day ?? '-'}`, `Bitiş: ${formatDate(payment.recurrence_end_date)}`],
        fixable: true,
        fixLabel: 'Tekrar alanlarını temizle',
        kind: 'paymentRecurrenceFields',
        payload: { paymentId: payment.id, updates: { recurrence_day: null, recurrence_end_date: null } },
      })
    }
  }

  for (const payment of data.payments.filter((item) => item.recurrence === 'monthly')) {
    if (!payment.recurrence_day) {
      issues.push({
        id: `payment-no-day-${payment.id}`,
        area: 'Planlı',
        severity: 'warning',
        title: `${payment.title} tekrar günü eksik`,
        description: 'Aylık ödeme kaydında ay günü boş.',
        details: [`Sıradaki tarih: ${formatDate(payment.due_date)}`],
        fixable: false,
        kind: 'manual',
      })
      continue
    }

    const expectedDueDate = dateInMonthValue(payment.due_date, payment.recurrence_day)
    if (payment.due_date !== expectedDueDate) {
      issues.push({
        id: `payment-due-day-${payment.id}`,
        area: 'Planlı',
        severity: 'warning',
        title: `${payment.title} tarihi tekrar günüyle uyuşmuyor`,
        description: 'Aylık ödeme tarihi, seçili tekrar gününe göre hizalanmamış.',
        details: [`Tarih: ${formatDate(payment.due_date)} → ${formatDate(expectedDueDate)}`, `Tekrar günü: ${payment.recurrence_day}`],
        fixable: true,
        fixLabel: 'Ödeme tarihini hizala',
        kind: 'paymentDueDay',
        payload: { paymentId: payment.id, dueDate: expectedDueDate },
      })
    }

    if (payment.status === 'bekliyor' && payment.recurrence_end_date && payment.due_date > payment.recurrence_end_date) {
      issues.push({
        id: `payment-ended-${payment.id}`,
        area: 'Planlı',
        severity: 'info',
        title: `${payment.title} bitiş tarihini geçmiş`,
        description: 'Aylık ödeme hâlâ bekliyor ama tekrar bitiş tarihi geride kalmış.',
        details: [`Sıradaki tarih: ${formatDate(payment.due_date)}`, `Bitiş: ${formatDate(payment.recurrence_end_date)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  return issues.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity] || a.area.localeCompare(b.area, 'tr-TR')
  })
}
