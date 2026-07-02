import { Check, ChevronDown, Clock3, Pencil, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CategoryPicker } from './CategoryPicker'
import { MoneyInput } from './MoneyInput'
import { SimpleModal } from '../SimpleModal'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import {
  fetchCardInstallmentsByExpenseIds,
  fetchPostedInstallmentExpenses,
  updateCardExpense,
} from '../../data/repositories/cardsRepo'
import type { Card, CardExpense, CardInstallment } from '../../types/database'
import { expenseCategoryOptions } from '../../utils/categories'
import { formatMonth } from '../../utils/analysisView'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { sumTL } from '../../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'

function historicalPaidInstallmentCount(expense: CardExpense) {
  const match = expense.note?.match(/^([0-9]+)\/([0-9]+) taksiti uygulama/i)
  if (!match) return 0

  const paid = Number(match[1] ?? 0)
  const total = Number(match[2] ?? 0)
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total !== expense.installment_count) return 0

  return Math.max(0, Math.min(expense.installment_count - 1, paid))
}

function installmentStatusLabel(item: CardInstallment) {
  if (item.status === 'paid') return 'Ödendi'
  if (item.status === 'posted') return item.statement_archive_id ? 'Açık ekstrede' : 'Bu dönem'
  return 'Planlı'
}

type CardInstallmentExpensesPanelProps = {
  cards: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}

const installmentExpensesHelp = {
  calculation: 'Taksit sayısı 1\'den büyük olan kesinleşmiş kart harcamaları ve bağlı taksit satırları gösterilir.',
  importance: 'Kredi kartı taksitleri ayrı borç değildir; kart ekstresi ödendiğinde ilgili taksitler otomatik kapanır.',
  source: 'Kart harcamaları, kart taksit kayıtları ve ekstre arşivi.',
} satisfies HelpTooltipContent

export function CardInstallmentExpensesPanel({ cards, reload, setError }: CardInstallmentExpensesPanelProps) {
  const [expenses, setExpenses] = useState<CardExpense[]>([])
  const [installments, setInstallments] = useState<CardInstallment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CardExpense | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState('')
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diger')
  const [installmentCount, setInstallmentCount] = useState('2')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const [completedOpen, setCompletedOpen] = useState(false)

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const installmentsByExpense = useMemo(() => {
    const next = new Map<string, CardInstallment[]>()

    for (const item of installments) {
      if (!item.card_expense_id) continue
      next.set(item.card_expense_id, [...(next.get(item.card_expense_id) ?? []), item])
    }

    return next
  }, [installments])

  // Taksitleri biten plan: taksit satırları var ve hepsi ödenmiş.
  const { activeExpenses, completedExpenses } = useMemo(() => {
    const active: CardExpense[] = []
    const completed: CardExpense[] = []
    for (const expense of expenses) {
      const items = installmentsByExpense.get(expense.id) ?? []
      if (items.length > 0 && items.every((item) => item.status === 'paid')) completed.push(expense)
      else active.push(expense)
    }
    return { activeExpenses: active, completedExpenses: completed }
  }, [expenses, installmentsByExpense])

  const loadInstallments = useCallback(
    async (expenseIds: string[]) => {
      if (expenseIds.length === 0) {
        setInstallments([])
        return
      }

      const result = await fetchCardInstallmentsByExpenseIds(expenseIds)

      if (!result.ok) {
        setInstallments([])
        setError(result.error.message ?? 'Taksitler yüklenemedi.')
        return
      }

      setInstallments(result.data)
    },
    [setError],
  )

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    const result = await fetchPostedInstallmentExpenses(50)

    if (!result.ok) {
      setExpenses([])
      setInstallments([])
      setError(result.error.message ?? 'Taksitli harcamalar yüklenemedi.')
      setLoading(false)
      return
    }

    setExpenses(result.data)
    await loadInstallments(result.data.map((expense) => expense.id))
    setLoading(false)
  }, [loadInstallments, setError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadExpenses()
  }, [loadExpenses])

  function openEdit(expense: CardExpense) {
    const expenseInstallments = installmentsByExpense.get(expense.id) ?? []
    const locked = expenseInstallments.some((item) => item.status === 'paid' || item.statement_archive_id)
    if (locked) {
      setError('Ekstreye bağlanmış veya ödenmiş taksitli harcama düzenlenemez.')
      return
    }

    setEditing(expense)
    setAmount(String(expense.amount))
    setDescription(expense.description)
    setSpentAt(expense.spent_at)
    setCategory(expense.category)
    setInstallmentCount(String(expense.installment_count))
    setNote(expense.note ?? '')
    setLocalError('')
  }

  function closeEdit() {
    setEditing(null)
    setLocalError('')
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return

    const parsedAmount = parseNumber(amount)
    const parsedInstallmentCount = Math.max(2, Math.min(36, Math.trunc(Number(installmentCount) || 2)))
    const trimmedDescription = description.trim()

    if (parsedAmount <= 0) {
      setLocalError('Tutar 0\'dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')

    const result = await updateCardExpense({
      expenseId: editing.id,
      amount: parsedAmount,
      description: trimmedDescription,
      spentAt,
      installmentCount: parsedInstallmentCount,
      category,
      note: note.trim() || null,
    })

    setSaving(false)

    if (!result.ok) {
      const message = isMissingSupabaseCapabilityError(result.error)
        ? missingSupabaseCapabilityMessage('Harcama düzenleme altyapısı', result.error)
        : result.error.message ?? 'Taksitli harcama güncellenemedi.'
      setLocalError(message)
      return
    }

    closeEdit()
    await Promise.all([loadExpenses(), reload()])
  }

  if (loading) {
    return (
      <SurfaceCard className="border-border/70 shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">Taksitli harcamalar yükleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (expenses.length === 0) return null

  const renderExpenseCard = (expense: CardExpense) => {
    const card = cardsById.get(expense.card_id)
    const expenseInstallments = installmentsByExpense.get(expense.id) ?? []
    const paidCount = Math.min(
      expense.installment_count,
      historicalPaidInstallmentCount(expense) + expenseInstallments.filter((item) => item.status === 'paid').length,
    )
    const remainingInstallments = expenseInstallments.filter((item) => item.status !== 'paid')
    const remainingAmount = sumTL(remainingInstallments.map((item) => item.amount))
    const isLocked = expenseInstallments.some((item) => item.status === 'paid' || item.statement_archive_id)

    return (
      <section key={expense.id} className="rounded-xl bg-muted/45 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">{expense.description}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {card ? `${card.bank_name} - ${card.card_name}` : 'Kart'} - {formatDate(expense.spent_at)} - {expense.installment_count} taksit
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                {paidCount}/{expense.installment_count} ödendi
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                {remainingInstallments.length} taksit izleniyor
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                {formatAmount(remainingAmount)} bilgi amaçlı
              </span>
            </div>
            {isLocked ? (
              <p className="mt-2 text-xs text-warning">Ekstreye bağlandığı veya ödendiği için bu harcama düzenlemeye kapalı.</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => openEdit(expense)}
            disabled={isLocked}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil size={13} />
            Düzenle
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {expenseInstallments.length === 0 ? (
            <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Taksit satırı bulunamadı.</p>
          ) : (
            expenseInstallments.map((item) => {
              const isPaid = item.status === 'paid'
              const isStatementLinked = Boolean(item.statement_archive_id)

              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 text-sm ${
                    isPaid
                      ? 'border-success/25 bg-success/8'
                      : isStatementLinked
                        ? 'border-warning/25 bg-warning/8'
                        : 'border-border/60 bg-card'
                  }`}
                >
                  <div
                    className={`grid size-8 shrink-0 place-items-center rounded-full border ${
                      isPaid
                        ? 'border-success bg-success text-success-foreground'
                        : isStatementLinked
                          ? 'border-warning/40 bg-warning/15 text-warning'
                          : 'border-border bg-muted text-muted-foreground'
                    }`}
                    aria-label={installmentStatusLabel(item)}
                  >
                    {isPaid ? <Check size={16} strokeWidth={3} /> : isStatementLinked ? <ReceiptText size={15} /> : <Clock3 size={15} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-semibold ${isPaid ? 'text-success' : 'text-foreground'}`}>
                      {item.installment_no}/{item.installment_count}. taksit - {formatAmount(item.amount)}
                    </p>
                    <p className={`text-xs ${isPaid ? 'text-success/80' : 'text-muted-foreground'}`}>
                      {formatMonth(item.due_month)} - {installmentStatusLabel(item)}
                    </p>
                    {!isPaid ? (
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Bu taksit, bagli oldugu kredi karti ekstresi odendiginde otomatik kapanir.
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    )
  }

  return (
    <>
      <SurfaceCard className="border-border/70 shadow-[var(--shadow-card)]">
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="inline-flex items-center gap-1.5 text-base">
                Taksitli harcamalar
                <HelpTooltip title="Taksitli harcamalar" content={installmentExpensesHelp} />
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Kart taksitleri ayrı borç değildir; bağlı ekstre ödendiğinde otomatik kapanır.</p>
            </div>
            <Badge variant="secondary">{activeExpenses.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          {activeExpenses.length === 0 ? (
            <p className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Devam eden taksitli harcama yok.</p>
          ) : (
            activeExpenses.map(renderExpenseCard)
          )}

          {completedExpenses.length > 0 ? (
            <div className="rounded-xl border border-border/60 bg-card/60">
              <button
                type="button"
                onClick={() => setCompletedOpen((open) => !open)}
                aria-expanded={completedOpen}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/50"
              >
                <span className="inline-flex items-center gap-2">
                  <Check size={15} className="text-success" />
                  Tamamlananlar ({completedExpenses.length})
                </span>
                <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${completedOpen ? 'rotate-180' : ''}`} />
              </button>
              {completedOpen ? (
                <div className="space-y-3 border-t border-border/60 p-3">
                  {completedExpenses.map(renderExpenseCard)}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </SurfaceCard>

      <SimpleModal title="Taksitli harcamayı düzenle" open={Boolean(editing)} onClose={closeEdit}>
        <form onSubmit={handleSave} className="space-y-4">
          <MoneyInput label="Toplam tutar" value={amount} onValueChange={setAmount} required />
          <label className="block text-sm font-semibold text-foreground">
            Açıklama
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              type="text"
              className="mt-1 w-full rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-foreground">
              Harcama Tarihi
              <input
                value={spentAt}
                onChange={(event) => setSpentAt(event.target.value)}
                type="date"
                className="mt-1 w-full rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
              Taksit sayısı
              <input
                value={installmentCount}
                onChange={(event) => setInstallmentCount(event.target.value)}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
          </div>
          <CategoryPicker description={description} value={category} onChange={setCategory} />
          <label className="block text-sm font-semibold text-foreground">
            Not
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
            />
          </label>
          <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-xs font-medium text-warning">
            Düzenleme sonrası kalan taksit planı yeniden kurulur. Ekstreye bağlanmış veya ödemesi kapanmış kayıtlar değiştirilemez.
          </p>
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="h-12 w-full rounded-xl bg-success px-4 text-sm font-semibold text-success-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)] transition hover:bg-success/90 active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : 'Değişiklikleri kaydet'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
