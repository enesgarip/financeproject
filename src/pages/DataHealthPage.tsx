import { Activity, AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw, ShieldCheck, Trash2, Undo2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { supabase } from '../lib/supabase'
import type {
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  InsertFor,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  UpdateFor,
} from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { formatSavingsGoalAmount } from '../utils/savingsGoal'

type HealthData = {
  assets: Asset[]
  budgets: Budget[]
  cards: Card[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardStatementArchives: CardStatementArchive[]
  debts: Debt[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  savingsGoals: SavingsGoal[]
}

type HealthIssue = {
  id: string
  area: 'Varlıklar' | 'Bütçeler' | 'Kartlar' | 'Krediler' | 'Borçlar' | 'Ödemeler' | 'Maaş' | 'Hedefler'
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
    | 'cardUnclassifiedDebt'
    | 'cardScheduledDebt'
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

type UndoTable =
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

type UndoRow = Record<string, unknown> & { id: string }

type UndoEntry =
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

type UndoBatch = {
  id: string
  label: string
  createdAt: string
  entries: UndoEntry[]
}

const emptyData: HealthData = {
  assets: [],
  budgets: [],
  cards: [],
  cardExpenses: [],
  cardInstallments: [],
  cardStatementArchives: [],
  debts: [],
  loans: [],
  loanInstallments: [],
  payments: [],
  salaryHistory: [],
  savingsGoals: [],
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function moneyDiffers(left: number, right: number) {
  return Math.abs(roundMoney(left) - roundMoney(right)) > 0.01
}

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the function')
}

function currentMonthStart() {
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

function addMonthsToMonthStart(value: string, months: number) {
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

function cardProvisionAmount(card: Pick<Card, 'provision_amount'>) {
  return card.provision_amount ?? 0
}

function cardSplitTotal(statementDebt: number, currentPeriod: number, provisionAmount: number) {
  return roundMoney(statementDebt + currentPeriod + provisionAmount)
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

function severityClass(severity: HealthIssue['severity']) {
  if (severity === 'error') return 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
  if (severity === 'warning') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
  return 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300'
}

function newUndoId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function makeUndoBatch(label: string, entries: UndoEntry[]): UndoBatch | null {
  if (entries.length === 0) return null
  return {
    id: newUndoId(),
    label,
    createdAt: new Date().toISOString(),
    entries,
  }
}

function compactIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))]
}

async function captureUndoRows(table: UndoTable, ids: string[]): Promise<UndoEntry | null> {
  const uniqueIds = compactIds(ids)
  if (uniqueIds.length === 0) return null

  if (table === 'assets') {
    const { data, error } = await supabase.from('assets').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'budgets') {
    const { data, error } = await supabase.from('budgets').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'cards') {
    const { data, error } = await supabase.from('cards').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'card_expenses') {
    const { data, error } = await supabase.from('card_expenses').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'card_installments') {
    const { data, error } = await supabase.from('card_installments').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'card_statement_archives') {
    const { data, error } = await supabase.from('card_statement_archives').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'debts') {
    const { data, error } = await supabase.from('debts').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'loans') {
    const { data, error } = await supabase.from('loans').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'loan_installments') {
    const { data, error } = await supabase.from('loan_installments').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }
  if (table === 'payments') {
    const { data, error } = await supabase.from('payments').select('*').in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return { action: 'restoreRows', table, rows: (data ?? []) as unknown as UndoRow[] }
  }

  return null
}

async function restoreUndoRows(table: UndoTable, rows: UndoRow[]) {
  if (rows.length === 0) return

  if (table === 'assets') {
    const { error } = await supabase.from('assets').upsert(rows as unknown as InsertFor<'assets'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'budgets') {
    const { error } = await supabase.from('budgets').upsert(rows as unknown as InsertFor<'budgets'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'cards') {
    const { error } = await supabase.from('cards').upsert(rows as unknown as InsertFor<'cards'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'card_expenses') {
    const { error } = await supabase.from('card_expenses').upsert(rows as unknown as InsertFor<'card_expenses'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'card_installments') {
    const { error } = await supabase.from('card_installments').upsert(rows as unknown as InsertFor<'card_installments'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'card_statement_archives') {
    const { error } = await supabase
      .from('card_statement_archives')
      .upsert(rows as unknown as InsertFor<'card_statement_archives'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'debts') {
    const { error } = await supabase.from('debts').upsert(rows as unknown as InsertFor<'debts'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'loans') {
    const { error } = await supabase.from('loans').upsert(rows as unknown as InsertFor<'loans'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'loan_installments') {
    const { error } = await supabase.from('loan_installments').upsert(rows as unknown as InsertFor<'loan_installments'>[])
    if (error) throw new Error(error.message)
    return
  }
  if (table === 'payments') {
    const { error } = await supabase.from('payments').upsert(rows as unknown as InsertFor<'payments'>[])
    if (error) throw new Error(error.message)
  }
}

async function deleteUndoRows(table: UndoTable, ids: string[]) {
  const uniqueIds = compactIds(ids)
  if (uniqueIds.length === 0) return

  if (table === 'card_installments') {
    const { error } = await supabase.from('card_installments').delete().in('id', uniqueIds)
    if (error) throw new Error(error.message)
    return
  }

  throw new Error('Bu tablo için geri alma silme adımı tanımlı değil.')
}

async function applyUndoEntry(entry: UndoEntry) {
  if (entry.action === 'restoreRows') {
    await restoreUndoRows(entry.table, entry.rows)
    return
  }

  await deleteUndoRows(entry.table, entry.ids)
}

function previewValue(value: string | number | null) {
  if (value === null) return 'boş'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatCurrency(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value)
  return value
}

function previewUpdates(updates: Record<string, string | number | null> | undefined) {
  if (!updates) return []
  return Object.entries(updates).map(([key, value]) => `${key}: ${previewValue(value)}`)
}

function issuePreviewDetails(issue: HealthIssue) {
  const payload = issue.payload
  if (!payload || !issue.fixable) return []

  const previews: string[] = []
  const updatePreview = previewUpdates(payload.updates)
  const affectedRows = payload.ids?.length ?? 0

  if (issue.kind === 'cardSingleInstallments') {
    previews.push('Harcama kaydı korunur, sadece peşin işlem için oluşmuş taksit planı temizlenir.')
    previews.push(`${affectedRows} taksit planı satırı silinir.`)
  } else if (issue.kind === 'cardMissingInstallments') {
    previews.push(`${payload.installmentNos?.length ?? 0} eksik taksit satırı eklenecek.`)
    previews.push(`Başlangıç ayı: ${payload.baseMonth ? formatDate(payload.baseMonth) : 'hesaplanamadı'}`)
  } else if (issue.kind === 'cardDebtSplit') {
    previews.push(`Ekstre borcu: ${formatCurrency(payload.statementDebt ?? 0)}`)
    previews.push(`Dönem içi kesinleşen: ${formatCurrency(payload.currentPeriod ?? 0)}`)
    previews.push(`Provizyon: ${formatCurrency(payload.provisionAmount ?? 0)}`)
  } else if (issue.kind === 'cardUnclassifiedDebt') {
    previews.push(`Sınıflandırılacak tutar: ${formatCurrency(payload.amount ?? 0)}`)
    previews.push(`Dönem içi kesinleşen: ${formatCurrency(payload.currentPeriod ?? 0)}`)
  } else if (issue.kind === 'loanTotals') {
    previews.push(`Kalan tutar: ${formatCurrency(payload.remainingAmount ?? 0)}`)
    previews.push(`Kalan taksit: ${payload.remainingInstallments ?? 0}`)
  } else if (issue.kind === 'loanPaidAtMissing') {
    previews.push(`${affectedRows} ödenmiş kredi taksidine ödeme tarihi eklenecek.`)
  } else if (issue.kind === 'loanPendingPaidAt') {
    previews.push(`${affectedRows} bekleyen kredi taksidinden ödeme tarihi kaldırılacak.`)
  } else if (issue.kind === 'paymentDueDay') {
    previews.push(`Yeni ödeme tarihi: ${payload.dueDate ? formatDate(payload.dueDate) : 'hesaplanamadı'}`)
  } else if (updatePreview.length > 0) {
    previews.push(`Güncellenecek alanlar: ${updatePreview.join(', ')}`)
  } else if (affectedRows > 0) {
    previews.push(`${affectedRows} kayıt güncellenecek.`)
  }

  previews.push('Uygulama öncesi kayıt görüntüsü bu oturumda geri alma için saklanır.')
  return previews
}

function buildIssues(data: HealthData): HealthIssue[] {
  const issues: HealthIssue[] = []
  const monthStartNow = currentMonthStart()
  const today = todayValue()
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
  const expensesById = new Map(data.cardExpenses.map((expense) => [expense.id, expense]))
  const installmentsByExpense = new Map<string, CardInstallment[]>()
  const installmentsByLoan = new Map<string, LoanInstallment[]>()

  for (const item of data.cardInstallments) {
    if (!item.card_expense_id) continue
    installmentsByExpense.set(item.card_expense_id, [...(installmentsByExpense.get(item.card_expense_id) ?? []), item])
  }

  for (const item of data.loanInstallments) {
    installmentsByLoan.set(item.loan_id, [...(installmentsByLoan.get(item.loan_id) ?? []), item])
  }

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
      if (asset.category !== 'Altın' && (asset.amount !== 1 || asset.unit !== 'TRY')) {
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
    const statementDebt = Math.min(card.statement_debt_amount, card.debt_amount)
    const provisionAmount = Math.min(cardProvisionAmount(card), Math.max(0, card.debt_amount - statementDebt))
    const currentPeriod = Math.min(card.current_period_spending, Math.max(0, card.debt_amount - statementDebt - provisionAmount))

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

    const splitTotal = roundMoney(card.statement_debt_amount + card.current_period_spending + cardProvisionAmount(card))
    if (card.debt_amount > splitTotal + 0.01) {
      const unclassifiedAmount = roundMoney(card.debt_amount - splitTotal)
      const nextCurrentPeriod = roundMoney(card.current_period_spending + unclassifiedAmount)

      issues.push({
        id: `card-unclassified-debt-${card.id}`,
        area: 'Kartlar',
        severity: 'info',
        title: `${cardLabel(card)} borcunun bir kısmı sınıflanmamış`,
        description: 'Toplam borç, ekstre borcu, dönem içi kesinleşen ve provizyon toplamından yüksek görünüyor.',
        details: [
          `Toplam borç: ${formatCurrency(card.debt_amount)}`,
          `Sınıflanan: ${formatCurrency(splitTotal)}`,
          `Sınıflandırılacak: ${formatCurrency(unclassifiedAmount)}`,
        ],
        fixable: true,
        fixLabel: 'Dönem içine sınıflandır',
        kind: 'cardUnclassifiedDebt',
        payload: { cardId: card.id, amount: unclassifiedAmount, currentPeriod: nextCurrentPeriod },
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

  const creditGroups = new Map<string, Card[]>()
  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti')) {
    const key = card.limit_group_name?.trim() || card.id
    creditGroups.set(key, [...(creditGroups.get(key) ?? []), card])
  }

  for (const card of data.cards.filter((item) => item.card_type === 'kredi_karti')) {
    const scheduledTotal = roundMoney(
      data.cardInstallments.filter((item) => item.card_id === card.id && item.status === 'scheduled').reduce((total, item) => total + item.amount, 0),
    )

    if (scheduledTotal <= 0.01) continue

    const splitTotal = cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card))
    if (card.debt_amount <= splitTotal + 0.01) {
      const nextDebtAmount = roundMoney(card.debt_amount + scheduledTotal)

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
  }

  for (const [key, groupCards] of creditGroups) {
    const limit = Math.max(...groupCards.map((card) => card.credit_limit), 0)
    const debt = groupCards.reduce((total, card) => total + card.debt_amount, 0)
    if (limit > 0 && debt > limit + 0.01) {
      issues.push({
        id: `card-limit-over-${key}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${groupCards[0]?.limit_group_name || groupCards[0]?.card_name || 'Kart'} limit üstünde`,
        description: 'Ortak/tekil limit borç toplamından düşük görünüyor.',
        details: [`Limit: ${formatCurrency(limit)}`, `Borç: ${formatCurrency(debt)}`],
        fixable: false,
        kind: 'manual',
      })
    }
  }

  for (const archive of data.cardStatementArchives) {
    const archiveTotal = roundMoney(archive.statement_debt_amount + archive.current_period_spending)
    const card = cardsById.get(archive.card_id)

    if (moneyDiffers(archive.total_debt_amount, archiveTotal)) {
      issues.push({
        id: `card-archive-total-${archive.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${cardLabel(card)} ekstre arşiv toplamı tutarsız`,
        description: 'Arşivdeki toplam borç, dönem borcu ve dönem içi harcama toplamıyla eşleşmiyor.',
        details: [
          `Ekstre: ${formatDate(archive.statement_date)}`,
          `Toplam: ${formatCurrency(archive.total_debt_amount)} → ${formatCurrency(archiveTotal)}`,
        ],
        fixable: true,
        fixLabel: 'Arşiv toplamını düzelt',
        kind: 'cardStatementTotals',
        payload: { statementArchiveId: archive.id, updates: { total_debt_amount: archiveTotal } },
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
    const expectedInstallmentAmount =
      expense.installment_count <= 1 ? expense.amount : roundMoney(expense.amount / Math.max(1, expense.installment_count))

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

    if (moneyDiffers(expense.installment_amount, expectedInstallmentAmount)) {
      issues.push({
        id: `card-expense-amount-${expense.id}`,
        area: 'Kartlar',
        severity: 'warning',
        title: `${expense.description} taksit tutarı tutarsız`,
        description: 'Harcama toplamı ve taksit sayısından beklenen taksit tutarı farklı.',
        details: [
          `Kayıtlı taksit: ${formatCurrency(expense.installment_amount)}`,
          `Beklenen: ${formatCurrency(expectedInstallmentAmount)}`,
          `Toplam: ${formatCurrency(expense.amount)} · ${expense.installment_count} taksit`,
        ],
        fixable: true,
        fixLabel: 'Taksit tutarını düzelt',
        kind: 'cardExpenseAmount',
        payload: { expenseId: expense.id, updates: { installment_amount: expectedInstallmentAmount } },
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
                amount: roundMoney(expense.installment_amount || expense.amount / expense.installment_count),
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
      const plannedTotal = roundMoney(relevantRows.reduce((total, row) => total + row.amount, 0))
      const baseAmount = roundMoney(expense.installment_amount || expense.amount / expense.installment_count)
      const expectedPlannedTotal = roundMoney(
        expectedNos.reduce((total, installmentNo) => {
          const amount =
            installmentNo === expense.installment_count
              ? roundMoney(expense.amount - baseAmount * (expense.installment_count - 1))
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
    const pending = rows.filter((item) => item.status !== 'ödendi')
    const remainingAmount = roundMoney(pending.reduce((total, item) => total + item.amount, 0))
    const remainingInstallments = pending.length
    const loanStatus: Loan['status'] = remainingInstallments === 0 ? 'closed' : 'active'

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

    if (loan.remaining_amount > loan.total_amount + 0.01) {
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
        area: 'Borçlar',
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
        area: 'Borçlar',
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
        area: 'Borçlar',
        severity: 'warning',
        title: `${debt.person_name} açık borç/alacak değeri 0`,
        description: 'Açık kayıt 0 TL göründüğü için net borç/alacak hesabını etkili takip edemez.',
        details: [`Yön: ${debt.direction}`],
        fixable: false,
        kind: 'manual',
      })
    }

    if (isGold && debt.amount <= 0) {
      issues.push({
        id: `debt-gold-amount-${debt.id}`,
        area: 'Borçlar',
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
        area: 'Borçlar',
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

    if (goal.status === 'active' && goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
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

    if (goal.status === 'completed' && goal.current_amount + 0.01 < goal.target_amount) {
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

    if (goal.status === 'active' && goal.target_date && goal.target_date < today && goal.current_amount + 0.01 < goal.target_amount) {
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
        area: 'Ödemeler',
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
        area: 'Ödemeler',
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
        area: 'Ödemeler',
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
        area: 'Ödemeler',
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
        area: 'Ödemeler',
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
        area: 'Ödemeler',
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

export function DataHealthPage() {
  const [data, setData] = useState<HealthData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<UndoBatch[]>([])
  const [undoing, setUndoing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetting, setResetting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

    const [
      assets,
      budgets,
      cards,
      cardExpenses,
      cardInstallments,
      cardStatementArchives,
      debts,
      loans,
      loanInstallments,
      payments,
      salaryHistory,
      savingsGoals,
    ] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('budgets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('card_expenses').select('*'),
      supabase.from('card_installments').select('*'),
      supabase.from('card_statement_archives').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('salary_history').select('*'),
      supabase.from('savings_goals').select('*'),
    ])

    const firstError = [
      assets.error,
      budgets.error,
      cards.error,
      cardExpenses.error,
      cardInstallments.error,
      cardStatementArchives.error,
      debts.error,
      loans.error,
      loanInstallments.error,
      payments.error,
      salaryHistory.error,
      savingsGoals.error,
    ].find(Boolean)
    if (firstError) {
      setError(firstError.message)
    } else {
      setData({
        assets: (assets.data ?? []) as Asset[],
        budgets: (budgets.data ?? []) as Budget[],
        cards: (cards.data ?? []) as Card[],
        cardExpenses: (cardExpenses.data ?? []) as CardExpense[],
        cardInstallments: (cardInstallments.data ?? []) as CardInstallment[],
        cardStatementArchives: (cardStatementArchives.data ?? []) as CardStatementArchive[],
        debts: (debts.data ?? []) as Debt[],
        loans: (loans.data ?? []) as Loan[],
        loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
        payments: (payments.data ?? []) as Payment[],
        salaryHistory: (salaryHistory.data ?? []) as SalaryHistory[],
        savingsGoals: (savingsGoals.data ?? []) as SavingsGoal[],
      })
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  const issues = useMemo(() => buildIssues(data), [data])
  const fixableIssues = issues.filter((issue) => issue.fixable)
  const stats = {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  }

  async function fixIssue(issue: HealthIssue): Promise<UndoBatch | null> {
    const payload = issue.payload
    if (!payload) return null
    const undoEntries: UndoEntry[] = []
    const addUndo = async (table: UndoTable, ids: string[]) => {
      const entry = await captureUndoRows(table, ids)
      if (entry) undoEntries.push(entry)
    }

    if (issue.kind === 'assetShape' && payload.assetId && payload.updates) {
      await addUndo('assets', [payload.assetId])
      const { error: updateError } = await supabase
        .from('assets')
        .update({ ...(payload.updates as UpdateFor<'assets'>), updated_at: new Date().toISOString() })
        .eq('id', payload.assetId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'budgetMonth' && payload.budgetId && payload.updates) {
      await addUndo('budgets', [payload.budgetId])
      const { error: updateError } = await supabase
        .from('budgets')
        .update({ ...(payload.updates as UpdateFor<'budgets'>), updated_at: new Date().toISOString() })
        .eq('id', payload.budgetId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardDebtSplit' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          statement_debt_amount: payload.statementDebt ?? 0,
          current_period_spending: payload.currentPeriod ?? 0,
          provision_amount: payload.provisionAmount ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardUnclassifiedDebt' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          current_period_spending: payload.currentPeriod ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardScheduledDebt' && payload.cardId && payload.nextDebtAmount !== undefined) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          debt_amount: payload.nextDebtAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardTypeFields' && payload.cardId && payload.updates) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({ ...(payload.updates as UpdateFor<'cards'>), updated_at: new Date().toISOString() })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardExpenseAmount' && payload.expenseId && payload.updates) {
      await addUndo('card_expenses', [payload.expenseId])
      const { error: updateError } = await supabase
        .from('card_expenses')
        .update({ ...(payload.updates as UpdateFor<'card_expenses'>), updated_at: new Date().toISOString() })
        .eq('id', payload.expenseId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardSingleInstallments' && payload.ids?.length) {
      await addUndo('card_installments', payload.ids)
      const { error: deleteError } = await supabase.from('card_installments').delete().in('id', payload.ids)
      if (deleteError) throw new Error(deleteError.message)
    }

    if ((issue.kind === 'cardInstallmentDueMonth' || issue.kind === 'cardInstallmentPostedAt' || issue.kind === 'cardInstallmentCount') && payload.ids?.length && payload.updates) {
      await addUndo('card_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('card_installments')
        .update({ ...(payload.updates as UpdateFor<'card_installments'>), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardStatementTotals' && payload.statementArchiveId && payload.updates) {
      await addUndo('card_statement_archives', [payload.statementArchiveId])
      const { error: updateError } = await supabase
        .from('card_statement_archives')
        .update({ ...(payload.updates as UpdateFor<'card_statement_archives'>), updated_at: new Date().toISOString() })
        .eq('id', payload.statementArchiveId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardMissingInstallments' && payload.userId && payload.cardId && payload.cardExpenseId && payload.installmentNos && payload.baseMonth) {
      const rows: InsertFor<'card_installments'>[] = payload.installmentNos.map((installmentNo) => {
        const dueMonth = addMonthsToMonthStart(payload.baseMonth ?? currentMonthStart(), installmentNo - 1)
        const baseAmount = payload.amount ?? 0
        const installmentCount = payload.installmentCount ?? 1
        const amount =
          payload.totalAmount && installmentNo === installmentCount
            ? roundMoney(payload.totalAmount - baseAmount * (installmentCount - 1))
            : baseAmount

        return {
          user_id: payload.userId ?? '',
          card_id: payload.cardId ?? '',
          card_expense_id: payload.cardExpenseId ?? null,
          installment_no: installmentNo,
          installment_count: installmentCount,
          due_month: dueMonth,
          amount,
          description: payload.description ?? 'Taksit',
          category: payload.category ?? 'Diğer',
          status: 'scheduled',
          posted_at: null,
          note: 'Veri sağlığı kontrolüyle tamamlandı.',
        }
      })

      const { data: insertedRows, error: insertError } = await supabase.from('card_installments').insert(rows).select('id')
      if (insertError) throw new Error(insertError.message)
      const insertedIds = (insertedRows ?? []).map((row) => row.id).filter(Boolean)
      if (insertedIds.length > 0) {
        undoEntries.push({ action: 'deleteRows', table: 'card_installments', ids: insertedIds })
      }
    }

    if (issue.kind === 'debtShape' && payload.debtId && payload.updates) {
      await addUndo('debts', [payload.debtId])
      const { error: updateError } = await supabase
        .from('debts')
        .update({ ...(payload.updates as UpdateFor<'debts'>), updated_at: new Date().toISOString() })
        .eq('id', payload.debtId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanTotals' && payload.loanId) {
      await addUndo('loans', [payload.loanId])
      const { error: updateError } = await supabase
        .from('loans')
        .update({
          remaining_amount: payload.remainingAmount ?? 0,
          remaining_installments: payload.remainingInstallments ?? 0,
          status: payload.loanStatus ?? 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.loanId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanInstallmentDueDay' && payload.ids?.length && payload.updates) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ ...(payload.updates as UpdateFor<'loan_installments'>), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPaidAtMissing' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPendingPaidAt' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: null, updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate) {
      await addUndo('payments', [payload.paymentId])
      const { error: updateError } = await supabase
        .from('payments')
        .update({ due_date: payload.dueDate, updated_at: new Date().toISOString() })
        .eq('id', payload.paymentId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'paymentRecurrenceFields' && payload.paymentId && payload.updates) {
      await addUndo('payments', [payload.paymentId])
      const { error: updateError } = await supabase
        .from('payments')
        .update({ ...(payload.updates as UpdateFor<'payments'>), updated_at: new Date().toISOString() })
        .eq('id', payload.paymentId)
      if (updateError) throw new Error(updateError.message)
    }

    return makeUndoBatch(issue.title, undoEntries)
  }

  async function handleFix(issue: HealthIssue) {
    setFixingId(issue.id)
    setError('')
    setMessage('')

    try {
      const undoBatch = await fixIssue(issue)
      if (undoBatch) {
        setUndoStack((current) => [undoBatch, ...current].slice(0, 5))
      }
      await loadData()
      setMessage('Düzeltme uygulandı. Bu oturumda geri alabilirsin.')
    } catch (fixError) {
      setError(fixError instanceof Error ? fixError.message : 'Düzeltme uygulanamadı.')
    } finally {
      setFixingId(null)
    }
  }

  async function handleFixAll() {
    setFixingId('all')
    setError('')
    setMessage('')
    const undoEntries: UndoEntry[] = []

    try {
      for (const issue of fixableIssues) {
        const undoBatch = await fixIssue(issue)
        if (undoBatch) undoEntries.push(...undoBatch.entries)
      }
      const batch = makeUndoBatch('Toplu veri sağlığı düzeltmesi', undoEntries)
      if (batch) {
        setUndoStack((current) => [batch, ...current].slice(0, 5))
      }
      await loadData()
      setMessage(`${fixableIssues.length} güvenli düzeltme uygulandı. Toplu işlem geri alınabilir.`)
    } catch (fixError) {
      const partialBatch = makeUndoBatch('Kısmi veri sağlığı düzeltmesi', undoEntries)
      if (partialBatch) {
        setUndoStack((current) => [partialBatch, ...current].slice(0, 5))
      }
      await loadData()
      setError(
        fixError instanceof Error
          ? `${fixError.message} Önceki başarılı adımlar geri alınabilir.`
          : 'Toplu düzeltme tamamlanamadı. Önceki başarılı adımlar geri alınabilir.',
      )
    } finally {
      setFixingId(null)
    }
  }

  async function handleUndo(batch: UndoBatch) {
    setUndoing(true)
    setError('')
    setMessage('')

    try {
      for (const entry of [...batch.entries].reverse()) {
        await applyUndoEntry(entry)
      }
      setUndoStack((current) => current.filter((item) => item.id !== batch.id))
      await loadData()
      setMessage('Son veri sağlığı düzeltmesi geri alındı.')
    } catch (undoError) {
      await loadData()
      setError(undoError instanceof Error ? undoError.message : 'Geri alma tamamlanamadı.')
    } finally {
      setUndoing(false)
    }
  }

  async function handleResetAllData(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedConfirm = resetConfirm.trim().toLocaleUpperCase('tr-TR')
    if (normalizedConfirm !== 'SİL' && normalizedConfirm !== 'SIL') {
      setError('Tüm veriyi silmek için onay alanına SİL yazmalısın.')
      return
    }

    setResetting(true)
    setError('')
    setMessage('')

    const { error: resetError } = await supabase.rpc('reset_user_finance_data', {})
    if (resetError) {
      setError(
        isSchemaCacheError(resetError)
          ? 'Sıfırlama altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
          : resetError.message,
      )
      setResetting(false)
      return
    }

    setUndoStack([])
    setData(emptyData)
    setResetConfirm('')
    setResetOpen(false)
    setResetting(false)
    await loadData()
    setMessage('Tüm finans verisi silindi. Sıfırdan veri girebilirsin.')
  }

  return (
    <>
    <section className="space-y-4">
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck size={20} />
                Veri sağlığı
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Varlık, bütçe, kart, kredi, borç, ödeme ve hedef kayıtlarındaki tutarlılık kontrolleri.</p>
            </div>
            <Badge variant={issues.length > 0 ? 'secondary' : 'default'}>{loading ? 'Kontrol' : `${issues.length} bulgu`}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <HealthStat label="Kritik" value={stats.errors} />
            <HealthStat label="Uyarı" value={stats.warnings} />
            <HealthStat label="Bilgi" value={stats.info} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || Boolean(fixingId) || undoing}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm disabled:opacity-60 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200"
            >
              <RefreshCw size={15} />
              Yenile
            </button>
            <button
              type="button"
              onClick={() => void handleFixAll()}
              disabled={loading || Boolean(fixingId) || undoing || fixableIssues.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-emerald-800"
            >
              <Wrench size={15} />
              Güvenli düzeltmeleri uygula
            </button>
            {undoStack[0] ? (
              <button
                type="button"
                onClick={() => void handleUndo(undoStack[0])}
                disabled={loading || Boolean(fixingId) || undoing}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm disabled:opacity-60 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <Undo2 size={15} />
                {undoing ? 'Geri alınıyor...' : 'Son düzeltmeyi geri al'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setResetConfirm('')
                setResetOpen(true)
              }}
              disabled={loading || Boolean(fixingId) || undoing || resetting}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm disabled:opacity-60 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <DatabaseZap size={15} />
              Tüm veriyi sil
            </button>
          </div>
          {message ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p> : null}
          {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
        </CardContent>
      </SurfaceCard>

      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/60" />
      ) : issues.length === 0 ? (
        <SurfaceCard className="border-0 shadow-sm ring-1 ring-emerald-200/80 dark:ring-emerald-900/70">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Kayıtlar temiz görünüyor</h2>
              <p className="mt-1 text-sm text-muted-foreground">Otomatik kontrolün yakaladığı bir tutarsızlık yok.</p>
            </div>
          </CardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-3">
          {issues.map((issue) => (
            <SurfaceCard key={issue.id} className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${severityClass(issue.severity)}`}>
                    {issue.fixable ? <Wrench size={19} /> : issue.severity === 'info' ? <Activity size={19} /> : <AlertTriangle size={19} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{issue.area}</Badge>
                      <Badge variant={issue.fixable ? 'secondary' : 'outline'}>{issue.fixable ? 'Düzeltilebilir' : 'Kontrol gerekli'}</Badge>
                    </div>
                    <h2 className="mt-2 text-base font-bold text-foreground">{issue.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
                    <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                      {issue.details.map((detail) => (
                        <span key={detail}>{detail}</span>
                      ))}
                    </div>
                    {issuePreviewDetails(issue).length > 0 ? (
                      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100">
                        <p className="font-bold">Düzeltme önizlemesi</p>
                        <div className="mt-2 grid gap-1">
                          {issuePreviewDetails(issue).map((detail, index) => (
                            <span key={`${issue.id}-preview-${index}`}>{detail}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {issue.fixable ? (
                        <button
                          type="button"
                          onClick={() => void handleFix(issue)}
                          disabled={Boolean(fixingId) || undoing}
                          className="rounded-lg bg-stone-800 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 dark:bg-stone-700"
                        >
                          {fixingId === issue.id ? 'Düzeltiliyor...' : issue.fixLabel}
                        </button>
                      ) : null}
                      {issue.area === 'Krediler' && issue.id.includes('no-plan') ? (
                        <Link to="/krediler" className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-800 dark:text-stone-200">
                          Kredilere git
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </SurfaceCard>
          ))}
        </div>
      )}
    </section>

    <SimpleModal title="Tüm veriyi sil" open={resetOpen} onClose={() => setResetOpen(false)}>
      <form onSubmit={handleResetAllData} className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">Bu işlem geri alınamaz.</p>
              <p className="mt-1">
                Varlıklar, kartlar, harcamalar, ekstre arşivi, krediler, borç/alacaklar, ödemeler, bütçeler, hedefler,
                maaş geçmişi ve işlem geçmişi silinir.
              </p>
            </div>
          </div>
        </div>
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
          Onay için SİL yaz
          <input
            value={resetConfirm}
            onChange={(event) => setResetConfirm(event.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-rose-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          />
        </label>
        <button
          type="submit"
          disabled={resetting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-rose-800"
        >
          <DatabaseZap size={16} />
          {resetting ? 'Siliniyor...' : 'Tüm veriyi kalıcı olarak sil'}
        </button>
      </form>
    </SimpleModal>
    </>
  )
}

function HealthStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
