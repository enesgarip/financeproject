import type {
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
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
import { ledgerDrift, projectCardDebt, projectCardSplit, type CardLedgerEvent } from '../utils/cardLedger'
import { dateInputValue, formatDate } from '../utils/date'
import { normalizeSearchText } from '../utils/searchText'
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
import { diffTL, exceedsTL, moneyDiffers, roundTL, sumTL, toKurus } from '../utils/money'
import { formatComponentAmount, formatSavingsGoalAmount, savingsGoalBelowTarget, savingsGoalTargetReached, savingsGoalValueTypeLabel } from '../utils/savingsGoal'
import { buildTransactionFingerprint, descriptionSimilarity, normalizedTransactionDescription } from '../utils/transactionFingerprint'
import type { HealthIssue } from './DataHealth.logic'
import { addMonthsToDate, currentMonthStart } from './DataHealth.logic'

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

function dateInMonthValue(sourceDate: string, preferredDay: number) {
  const [year, month] = sourceDate.split('-').map(Number)
  if (!year || !month || !preferredDay) return sourceDate
  const lastDay = new Date(year, month, 0).getDate()
  return dateInputValue(new Date(year, month - 1, Math.min(preferredDay, lastDay)))
}

function dateStartIso(value: string | null | undefined) {
  if (!value) return new Date().toISOString()
  if (value.includes('T')) return value
  return `${value}T00:00:00.000Z`
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
  const match = expense.note?.match(/(\d+)\/(\d+)\s+taksiti uygulama [öo]ncesinde/)
  if (!match) return 0
  const paid = Number(match[1])
  const total = Number(match[2])
  if (!Number.isFinite(paid) || total !== expense.installment_count) return 0
  return Math.max(0, Math.min(expense.installment_count - 1, paid))
}

function inferInstallmentBaseDate(expense: CardExpense, rows: CardInstallment[]) {
  if (rows.length === 0) return expense.spent_at
  const earliest = [...rows].sort((a, b) => a.installment_no - b.installment_no)[0]
  return addMonthsToDate(earliest.due_month, 1 - earliest.installment_no)
}

function formatGoalComponentProgress(component: SavingsGoalComponent) {
  const label = component.label?.trim() || savingsGoalValueTypeLabel(component.value_type)
  return `${label}: ${formatComponentAmount(component, component.current_amount)} / ${formatComponentAmount(component, component.target_amount)}`
}

// ---------------------------------------------------------------------------
// Domain check functions — each returns HealthIssue[] for its area
// ---------------------------------------------------------------------------

export function checkAssets(assets: Asset[]): HealthIssue[] {
  const issues: HealthIssue[] = []

  for (const asset of assets) {
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

  return issues
}

export function checkBudgets(budgets: Budget[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const budgetsByMonthCategory = new Map<string, Budget[]>()

  for (const budget of budgets) {
    const normalizedMonth = monthStart(budget.month)
    const duplicateKey = `${normalizedMonth}:${normalizeSearchText(budget.category)}`
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

  return issues
}

export function checkCards(
  cards: Card[],
  cardInstallments: CardInstallment[],
  cardStatementArchives: CardStatementArchive[],
): HealthIssue[] {
  const issues: HealthIssue[] = []
  const today = todayValue()
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const scheduledInstallmentsByCard = scheduledCardInstallmentTotalsByCard(cardInstallments)

  for (const card of cards) {
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

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
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

    const scheduledTotal = scheduledInstallmentsByCard.get(card.id) ?? 0
    const debtBreakdown = cardDebtBreakdown(card, scheduledTotal)

    if (debtBreakdown.hasScheduledDebtGap) {
      issues.push({
        id: `card-scheduled-debt-${card.id}`,
        area: 'Kartlar',
        severity: 'error',
        title: `${cardLabel(card)} planlı taksitleri limitten düşmüyor`,
        description: 'Gelecek taksitler kayıtlı ama kart borcuna eklenmemiş; kalan limit yanlış yüksek görünür.',
        details: [
          `Planlı taksit: ${formatCurrency(debtBreakdown.scheduledTotal)}`,
          `Güncel borç: ${formatCurrency(card.debt_amount)}`,
          `Önerilen borç: ${formatCurrency(debtBreakdown.nextDebtAmount)}`,
        ],
        fixable: true,
        fixLabel: 'Planlı taksitleri borca ekle',
        kind: 'cardScheduledDebt',
        payload: { cardId: card.id, scheduledTotal: debtBreakdown.scheduledTotal, nextDebtAmount: debtBreakdown.nextDebtAmount },
      })
    }

    if (debtBreakdown.hasUnexplainedDebt) {
      const unexplained = debtBreakdown.unexplainedAmount
      const hasInstallmentExpenses = cardInstallments.some(
        (inst) => inst.card_id === card.id && inst.status !== 'scheduled',
      )

      issues.push({
        id: `card-unclassified-debt-${card.id}`,
        area: 'Kartlar',
        severity: debtBreakdown.scheduledTotal > 0 ? 'warning' : 'info',
        title: `${cardLabel(card)} borç kırılımında eksik pay`,
        description:
          debtBreakdown.scheduledTotal > 0
            ? 'Toplam borç gelecek taksitleri de içerir; bu farkın çoğu planlı taksitlerden gelir ve dönem içine yazılmamalıdır.'
            : 'Toplam borç, ekstre + dönem içi + provizyon toplamından yüksek. Farkı ekstre borcuna aktarmak daha güvenlidir.',
        details: [
          `Toplam borç: ${formatCurrency(card.debt_amount)}`,
          `Ekstre + dönem + provizyon: ${formatCurrency(debtBreakdown.splitTotal)}`,
          debtBreakdown.scheduledTotal > 0 ? `Planlı taksit (beklenen fark): ${formatCurrency(debtBreakdown.scheduledTotal)}` : null,
          `Düzeltilmesi gereken: ${formatCurrency(unexplained)}`,
          hasInstallmentExpenses && !exceedsTL(debtBreakdown.scheduledTotal, 0)
            ? 'Taksitli harcama var ama plan satırı eksik olabilir; eksik taksit uyarılarına da bak.'
            : null,
        ].filter((item): item is string => Boolean(item)),
        fixable: true,
        fixLabel: 'Ekstre borcuna aktar',
        kind: 'cardDebtSplit',
        payload: {
          cardId: card.id,
          statementDebt: sumTL([card.statement_debt_amount, unexplained]),
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

  for (const group of buildCreditLimitGroups(cards)) {
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

  const openArchivesByCard = new Set(
    cardStatementArchives.filter((sa) => sa.status === 'open').map((sa) => sa.card_id),
  )

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    if (card.statement_debt_amount > 0 && !openArchivesByCard.has(card.id)) {
      issues.push({
        id: `card-orphan-statement-debt-${card.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} açık ekstresi yok ama ekstre borcu var`,
        description: 'Ekstre ödendi/kapatıldı ama kartın ekstre borcu sıfırlanmamış. Fark dönem içi harcamaya aktarılacak.',
        details: [
          `Ekstre borcu: ${formatCurrency(card.statement_debt_amount)}`,
          `Dönem içi: ${formatCurrency(card.current_period_spending)} → ${formatCurrency(sumTL([card.current_period_spending, card.statement_debt_amount]))}`,
        ],
        fixable: true,
        fixLabel: 'Ekstre borcunu dönem içine aktar',
        kind: 'cardDebtSplit',
        payload: {
          cardId: card.id,
          statementDebt: 0,
          currentPeriod: sumTL([card.current_period_spending, card.statement_debt_amount]),
          provisionAmount: cardProvisionAmount(card),
        },
      })
    }
  }

  for (const archive of cardStatementArchives) {
    const card = cardsById.get(archive.card_id)
    const archiveStatus = String(archive.status)
    if (archiveStatus !== 'open' && archiveStatus !== 'paid') {
      issues.push({
        id: `card-archive-status-${archive.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} ekstre arşivi pasif/geçersiz statüde`,
        description: 'Ekstre arşiv statüsü beklenen open/paid değerlerinden farklı. Geçmiş kayıt korunur, hızlı düzeltme bunu ödenmiş arşive alır.',
        details: [
          `Statü: ${archiveStatus || '-'}`,
          `Ekstre: ${formatDate(archive.statement_date)}`,
          `Ekstre tutarı: ${formatCurrency(archive.statement_debt_amount)}`,
        ],
        fixable: true,
        fixLabel: 'Ödenmiş arşive al',
        kind: 'cardStatementStatus',
        payload: {
          cardId: archive.card_id,
          statementArchiveId: archive.id,
          updates: {
            status: 'paid',
            paid_at: archive.paid_at ?? dateStartIso(archive.due_date ?? archive.statement_date),
          },
        },
      })
    }
    if (archive.status === 'open' && archive.due_date && archive.due_date < today) {
      issues.push({
        id: `card-overdue-statement-${archive.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} vadesi geçmiş açık ekstre`,
        description: 'Ekstre son ödeme tarihi geçmiş ama uygulamada hâlâ açık görünüyor. Bankada ödendiyse uygulamada da kapatılmalı.',
        details: [
          `Son ödeme: ${formatDate(archive.due_date)}`,
          `Ekstre tutarı: ${formatCurrency(archive.statement_debt_amount)}`,
        ],
        fixable: false,
        kind: 'cardOverduePayment',
        payload: {
          cardId: archive.card_id,
          statementArchiveId: archive.id,
          amount: archive.statement_debt_amount,
          dueDate: archive.due_date,
        },
      })
    }
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

  return issues
}

function cardExpenseFingerprint(expense: CardExpense): string {
  return expense.transaction_fingerprint ?? buildTransactionFingerprint({
    accountId: expense.card_id,
    date: expense.spent_at,
    amount: expense.amount,
    description: expense.description,
    type: expense.status,
  })
}

function cardExpenseDetail(expense: CardExpense) {
  const description = expense.description?.trim() || 'Açıklama yok'
  return `${formatDate(expense.spent_at)} · ${description} · ${formatCurrency(expense.amount)} · ${expense.status}`
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return grouped
}

export function checkCardExpenseDuplicates(cards: Card[], cardExpenses: CardExpense[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const activeExpenses = cardExpenses.filter(activeCardExpense)
  const exactDuplicateIdSets = new Set<string>()

  for (const [fingerprint, rows] of groupBy(activeExpenses, cardExpenseFingerprint)) {
    if (rows.length <= 1) continue
    const ids = rows.map((row) => row.id).sort()
    exactDuplicateIdSets.add(ids.join('|'))
    const card = cardsById.get(rows[0]?.card_id ?? '')

    issues.push({
      id: `card-expense-duplicate-exact-${ids.join('-')}`,
      area: 'Kartlar',
      severity: 'warning',
      title: `${cardLabel(card)} kesin duplicate harcama adayı`,
      description: 'Aynı kart, tarih, tutar, durum ve normalize açıklamaya sahip birden fazla harcama var. Otomatik silinmez; önce kullanıcı kararı gerekir.',
      details: [
        `Güven: %98`,
        `Fingerprint: ${fingerprint}`,
        ...rows.slice(0, 5).map(cardExpenseDetail),
        rows.length > 5 ? `+${rows.length - 5} kayıt daha` : null,
      ].filter((item): item is string => Boolean(item)),
      fixable: false,
      kind: 'duplicateTransactionCandidate',
      payload: { ids, duplicateLevel: 'exact', confidence: 0.98, transactionFingerprint: fingerprint },
    })
  }

  for (const [looseKey, rows] of groupBy(activeExpenses, (expense) => (
    `${expense.card_id}|${expense.spent_at}|${expense.status}|${toKurus(expense.amount)}`
  ))) {
    if (rows.length <= 1) continue
    const ids = rows.map((row) => row.id).sort()
    if (exactDuplicateIdSets.has(ids.join('|'))) continue

    let maxSimilarity = 0
    for (let left = 0; left < rows.length; left++) {
      for (let right = left + 1; right < rows.length; right++) {
        maxSimilarity = Math.max(maxSimilarity, descriptionSimilarity(rows[left].description, rows[right].description))
      }
    }

    const hasBlankDescription = rows.some((row) => !normalizedTransactionDescription(row.description))
    if (maxSimilarity < 0.3 && !hasBlankDescription) continue

    const card = cardsById.get(rows[0]?.card_id ?? '')
    issues.push({
      id: `card-expense-duplicate-possible-${ids.join('-')}`,
      area: 'Kartlar',
      severity: 'info',
      title: `${cardLabel(card)} muhtemel duplicate harcama adayı`,
      description: 'Aynı kartta aynı gün, aynı tutar ve aynı durumla birden fazla harcama var. Açıklamalar birebir aynı değil; elle karşılaştırılmalı.',
      details: [
        `Güven: %${Math.round((hasBlankDescription ? 0.55 : 0.65 + maxSimilarity * 0.25) * 100)}`,
        `Grup: ${looseKey}`,
        ...rows.slice(0, 5).map(cardExpenseDetail),
        rows.length > 5 ? `+${rows.length - 5} kayıt daha` : null,
      ].filter((item): item is string => Boolean(item)),
      fixable: false,
      kind: 'duplicateTransactionCandidate',
      payload: {
        ids,
        duplicateLevel: 'possible',
        confidence: hasBlankDescription ? 0.55 : 0.65 + maxSimilarity * 0.25,
      },
    })
  }

  const missingDescriptions = activeExpenses.filter((expense) => !normalizedTransactionDescription(expense.description))
  if (missingDescriptions.length > 0) {
    issues.push({
      id: 'card-expense-missing-description',
      area: 'Kartlar',
      severity: 'info',
      title: 'Açıklaması olmayan kart harcamaları var',
      description: 'Açıklama olmadığında import/mutabakat eşleşmesi zayıflar ve duplicate analizi daha belirsiz olur.',
      details: [
        `Kayıt sayısı: ${missingDescriptions.length}`,
        ...missingDescriptions.slice(0, 5).map(cardExpenseDetail),
      ],
      fixable: false,
      kind: 'cardExpenseDataQuality',
      payload: { ids: missingDescriptions.map((expense) => expense.id) },
    })
  }

  const missingCategories = activeExpenses.filter((expense) => !expense.category?.trim())
  if (missingCategories.length > 0) {
    issues.push({
      id: 'card-expense-missing-category',
      area: 'Kartlar',
      severity: 'info',
      title: 'Kategorisi olmayan kart harcamaları var',
      description: 'Kategori boş olduğunda bütçe ve analiz ekranları bu harcamaları doğru gruplayamaz.',
      details: [
        `Kayıt sayısı: ${missingCategories.length}`,
        ...missingCategories.slice(0, 5).map(cardExpenseDetail),
      ],
      fixable: false,
      kind: 'cardExpenseDataQuality',
      payload: { ids: missingCategories.map((expense) => expense.id) },
    })
  }

  return issues
}

export function checkLedgerDrift(
  cards: Card[],
  cardLedger: CardLedgerEvent[],
  accountLedger: AccountLedgerEvent[],
): HealthIssue[] {
  const issues: HealthIssue[] = []

  const ledgerEventsByCard = new Map<string, CardLedgerEvent[]>()
  for (const event of cardLedger) {
    ledgerEventsByCard.set(event.card_id, [...(ledgerEventsByCard.get(event.card_id) ?? []), event])
  }

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    const cardEvents = ledgerEventsByCard.get(card.id)
    if (!cardEvents || cardEvents.length === 0) continue

    const drift = ledgerDrift(cardEvents, card.debt_amount)
    if (drift !== 0) {
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

    const splitProjection = projectCardSplit(cardEvents)
    if (splitProjection.complete) {
      const clamped = clampCardBreakdown(
        card.debt_amount,
        splitProjection.statement,
        splitProjection.current,
        splitProjection.provision,
      )
      if (
        moneyDiffers(clamped.statement, card.statement_debt_amount) ||
        moneyDiffers(clamped.current, card.current_period_spending) ||
        moneyDiffers(clamped.provision, cardProvisionAmount(card))
      ) {
        issues.push({
          id: `card-split-drift-${card.id}`,
          area: 'Kartlar',
          severity: 'warning',
          title: `${cardLabel(card)} borç kırılımı hareketlerle uyuşmuyor`,
          description: 'Ekstre/dönem/provizyon dağılımı hareket geçmişinden hesaplanan projeksiyonla farklı.',
          details: [
            `Ekstre: ${formatCurrency(card.statement_debt_amount)} → ${formatCurrency(clamped.statement)}`,
            `Dönem içi: ${formatCurrency(card.current_period_spending)} → ${formatCurrency(clamped.current)}`,
            `Provizyon: ${formatCurrency(cardProvisionAmount(card))} → ${formatCurrency(clamped.provision)}`,
          ],
          fixable: true,
          fixLabel: 'Kırılımı hareketlere göre düzelt',
          kind: 'cardSplitDrift',
          payload: { cardId: card.id },
        })
      }
    }
  }

  const accountEventsByCard = new Map<string, AccountLedgerEvent[]>()
  for (const event of accountLedger) {
    accountEventsByCard.set(event.card_id, [...(accountEventsByCard.get(event.card_id) ?? []), event])
  }

  for (const card of cards.filter((item) => item.card_type === 'banka_karti')) {
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

  return issues
}

export function checkCardInstallments(
  cards: Card[],
  cardExpenses: CardExpense[],
  cardInstallments: CardInstallment[],
): HealthIssue[] {
  const issues: HealthIssue[] = []
  const today = todayValue()
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const expensesById = new Map(cardExpenses.map((expense) => [expense.id, expense]))
  const installmentsByExpense = new Map<string, CardInstallment[]>()

  for (const item of cardInstallments) {
    if (!item.card_expense_id) continue
    installmentsByExpense.set(item.card_expense_id, [...(installmentsByExpense.get(item.card_expense_id) ?? []), item])
  }

  const scheduledByCard = new Map<string, CardInstallment[]>()
  for (const item of cardInstallments.filter((row) => row.status === 'scheduled' && row.due_month <= today)) {
    scheduledByCard.set(item.card_id, [...(scheduledByCard.get(item.card_id) ?? []), item])
  }

  for (const [cardId, rows] of scheduledByCard) {
    const card = cardsById.get(cardId)
    const total = sumTL(rows.map((item) => item.amount))
    const pastCount = rows.filter((item) => item.due_month < today).length

    issues.push({
      id: `card-scheduled-${cardId}`,
      area: 'Kartlar',
      severity: pastCount > 0 ? 'warning' : 'info',
      title: `${cardLabel(card)} dönem içine alınmamış taksit`,
      description: 'Bu taksitler hâlâ planlı görünüyor; dönem/ekstre durumunu elle kontrol etmek daha güvenli.',
      details: [`Taksit sayısı: ${rows.length}`, `Toplam: ${formatCurrency(total)}`, pastCount > 0 ? `${pastCount} tanesinin tarihi geçmiş.` : 'Bugün dönem içine alınmalı.'],
      fixable: false,
      kind: 'manual',
    })
  }

  for (const expense of cardExpenses.filter(activeCardExpense)) {
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

  for (const installment of cardInstallments) {
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

    if (expense?.installment_count && expense.installment_count > 1 && !installment.current_settlement_id) {
      const expectedDueDate = addMonthsToDate(expense.spent_at, installment.installment_no - 1)
      if (installment.due_month !== expectedDueDate) {
        issues.push({
          id: `card-installment-date-${installment.id}`,
          area: 'Kartlar',
          severity: 'warning',
          title: `${installment.description} taksit tarihi uyuşmuyor`,
          description: 'Taksit tarihi, alışveriş günü ve taksit sırasından beklenen tam tarihle aynı değil.',
          details: [
            `Taksit: ${installment.installment_no}/${installment.installment_count}`,
            `Kayıtlı: ${formatDate(installment.due_month)} → Beklenen: ${formatDate(expectedDueDate)}`,
          ],
          fixable: true,
          fixLabel: 'Taksit tarihini düzelt',
          kind: 'cardInstallmentDueMonth',
          payload: { ids: [installment.id], updates: { due_month: expectedDueDate } },
        })
      }
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

  for (const expense of cardExpenses.filter((item) => item.status === 'posted' && item.installment_count > 1)) {
    const rows = installmentsByExpense.get(expense.id) ?? []
    const existingNos = new Set(rows.map((row) => row.installment_no))
    const paidBefore = parseLegacyPaidCount(expense)
    const expectedNos = range(paidBefore + 1, expense.installment_count)
    const missingNos = expectedNos.filter((installmentNo) => !existingNos.has(installmentNo))
    const extraRows = rows.filter((row) => row.installment_no <= paidBefore || row.installment_no > expense.installment_count)
    const baseDate = inferInstallmentBaseDate(expense, rows)
    const futureMissingNos = missingNos.filter((installmentNo) => addMonthsToDate(baseDate, installmentNo - 1) > today)
    const card = cardsById.get(expense.card_id)

    if (missingNos.length > 0) {
      const pastMissingNos = missingNos.filter((installmentNo) => !futureMissingNos.includes(installmentNo))
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
          pastMissingNos.length > 0 && futureMissingNos.length === 0 ? 'Geçmiş taksitler ödendi olarak eklenecek.' : null,
        ].filter((item): item is string => Boolean(item)),
        fixable: true,
        fixLabel: futureMissingNos.length > 0 ? 'Eksik taksitleri ekle' : 'Geçmiş taksitleri ödendi olarak ekle',
        kind: 'cardMissingInstallments',
        payload: {
          userId: expense.user_id,
          cardId: expense.card_id,
          cardExpenseId: expense.id,
          installmentNos: missingNos,
          installmentCount: expense.installment_count,
          baseDate,
          amount: roundTL(expense.installment_amount || expense.amount / expense.installment_count),
          totalAmount: expense.amount,
          description: expense.description,
          category: expense.category,
        },
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
      const plannedTotal = sumTL(relevantRows.map((row) => row.amount))
      const baseAmount = roundTL(expense.installment_amount || expense.amount / expense.installment_count)
      const expectedPlannedTotal = roundTL(
        expectedNos.reduce((total, installmentNo) => {
          const amount =
            installmentNo === expense.installment_count
              ? diffTL(expense.amount, baseAmount * (expense.installment_count - 1))
              : baseAmount
          return sumTL([total, amount])
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

  return issues
}

export function checkLoans(loans: Loan[], loanInstallments: LoanInstallment[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const installmentsByLoan = new Map<string, LoanInstallment[]>()
  const loansById = new Map(loans.map((loan) => [loan.id, loan]))

  for (const item of loanInstallments) {
    installmentsByLoan.set(item.loan_id, [...(installmentsByLoan.get(item.loan_id) ?? []), item])
  }

  for (const loan of loans) {
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

  for (const installment of loanInstallments) {
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

  const paidWithoutDate = loanInstallments.filter((item) => item.status === 'ödendi' && !item.paid_at)
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

  const pendingWithDate = loanInstallments.filter((item) => item.status !== 'ödendi' && item.paid_at)
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

  return issues
}

export function checkDebts(debts: Debt[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const today = todayValue()

  for (const debt of debts) {
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

  return issues
}

export function checkSalary(salaryHistory: SalaryHistory[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const salaryDates = new Map<string, SalaryHistory[]>()

  for (const salary of salaryHistory) {
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

  return issues
}

export function checkGoals(savingsGoals: SavingsGoal[], savingsGoalComponents: SavingsGoalComponent[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const today = todayValue()
  const componentsByGoal = new Map<string, SavingsGoalComponent[]>()

  for (const item of savingsGoalComponents) {
    componentsByGoal.set(item.goal_id, [...(componentsByGoal.get(item.goal_id) ?? []), item])
  }

  for (const goal of savingsGoals) {
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

  return issues
}

export function checkPayments(payments: Payment[]): HealthIssue[] {
  const issues: HealthIssue[] = []
  const today = todayValue()

  for (const payment of payments) {
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

  for (const payment of payments.filter((item) => item.recurrence === 'monthly')) {
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

  return issues
}
