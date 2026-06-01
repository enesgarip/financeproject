import { Check, Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CategoryPicker } from './CategoryPicker'
import { MoneyInput } from './MoneyInput'
import { SimpleModal } from '../SimpleModal'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabase'
import type { Card, CardExpense, CardInstallment } from '../../types/database'
import { expenseCategoryOptions } from '../../utils/categories'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the function')
}

function historicalPaidInstallmentCount(expense: CardExpense) {
  const match = expense.note?.match(/^([0-9]+)\/([0-9]+) taksiti uygulama/i)
  if (!match) return 0

  const paid = Number(match[1] ?? 0)
  const total = Number(match[2] ?? 0)
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total !== expense.installment_count) return 0

  return Math.max(0, Math.min(expense.installment_count - 1, paid))
}

type CardInstallmentExpensesPanelProps = {
  cards: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}

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
  const [payingId, setPayingId] = useState<string | null>(null)

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const installmentsByExpense = useMemo(() => {
    const next = new Map<string, CardInstallment[]>()

    for (const item of installments) {
      if (!item.card_expense_id) continue
      next.set(item.card_expense_id, [...(next.get(item.card_expense_id) ?? []), item])
    }

    return next
  }, [installments])

  const loadInstallments = useCallback(
    async (expenseIds: string[]) => {
      if (expenseIds.length === 0) {
        setInstallments([])
        return
      }

      const { data, error } = await supabase
        .from('card_installments')
        .select('*')
        .in('card_expense_id', expenseIds)
        .order('due_month', { ascending: true })
        .order('installment_no', { ascending: true })

      if (error) {
        setInstallments([])
        setError(error.message)
        return
      }

      setInstallments((data ?? []) as CardInstallment[])
    },
    [setError],
  )

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('card_expenses')
      .select('*')
      .eq('status', 'posted')
      .gt('installment_count', 1)
      .order('spent_at', { ascending: false })
      .limit(12)

    if (error) {
      setExpenses([])
      setInstallments([])
      setError(error.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as CardExpense[]
    setExpenses(rows)
    await loadInstallments(rows.map((expense) => expense.id))
    setLoading(false)
  }, [loadInstallments, setError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadExpenses()
  }, [loadExpenses])

  function openEdit(expense: CardExpense) {
    const expenseInstallments = installmentsByExpense.get(expense.id) ?? []
    if (expenseInstallments.some((item) => item.status === 'paid')) {
      setError('Odeme alinmis taksitli harcama duzenlenemez.')
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
      setLocalError('Tutar 0 dan buyuk olmali.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Aciklama yazmalisin.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')

    const { error } = await supabase.rpc('update_card_expense', {
      p_expense_id: editing.id,
      p_amount: parsedAmount,
      p_description: trimmedDescription,
      p_spent_at: spentAt,
      p_installment_count: parsedInstallmentCount,
      p_category: category,
      p_note: note.trim() || null,
    })

    setSaving(false)

    if (error) {
      const message = isSchemaCacheError(error)
        ? 'Harcama duzenleme henuz veritabaninda yok. Migration uygulaninca bu islem acilacak.'
        : error.message
      setLocalError(message)
      return
    }

    closeEdit()
    await Promise.all([loadExpenses(), reload()])
  }

  async function handleMarkPaid(installment: CardInstallment) {
    if (installment.status === 'paid') {
      setError('Odenmis taksit geri alinamaz.')
      return
    }

    setPayingId(installment.id)
    setError('')

    const { error } = await supabase.rpc('pay_card_installment', {
      p_installment_id: installment.id,
    })

    if (error) {
      const message = isSchemaCacheError(error)
        ? 'Taksit odeme isareti henuz veritabaninda yok. Migration uygulaninca bu islem acilacak.'
        : error.message
      setError(message)
      setPayingId(null)
      return
    }

    try {
      await Promise.all([loadExpenses(), reload()])
    } finally {
      setPayingId(null)
    }
  }

  if (loading) {
    return (
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardContent className="p-4 text-sm text-muted-foreground">Taksitli harcamalar yukleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (expenses.length === 0) return null

  return (
    <>
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Taksitli harcamalar</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Taksitleri tek tek odendi isaretleyebilir, kalan borcu canli takip edebilirsin.</p>
            </div>
            <Badge variant="secondary">{expenses.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          {expenses.map((expense) => {
            const card = cardsById.get(expense.card_id)
            const expenseInstallments = installmentsByExpense.get(expense.id) ?? []
            const paidCount = Math.min(
              expense.installment_count,
              historicalPaidInstallmentCount(expense) + expenseInstallments.filter((item) => item.status === 'paid').length,
            )
            const remainingInstallments = expenseInstallments.filter((item) => item.status !== 'paid')
            const remainingAmount = remainingInstallments.reduce((sum, item) => sum + item.amount, 0)
            const hasPaidInstallment = expenseInstallments.some((item) => item.status === 'paid')

            return (
              <section key={expense.id} className="rounded-xl bg-muted/45 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{expense.description}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)} · {expense.installment_count} taksit
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                        {paidCount}/{expense.installment_count} odendi
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                        {remainingInstallments.length} kalan
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                        {formatCurrency(remainingAmount)} kalan borc
                      </span>
                    </div>
                    {hasPaidInstallment ? (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Odenmis taksit oldugu icin bu harcama duzenlemeye kapatildi.</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(expense)}
                    disabled={hasPaidInstallment}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  >
                    <Pencil size={13} />
                    Duzenle
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {expenseInstallments.length === 0 ? (
                    <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-muted-foreground dark:bg-stone-900/80">Taksit satiri bulunamadi.</p>
                  ) : (
                    expenseInstallments.map((item) => {
                      const isPaid = item.status === 'paid'
                      const statusLabel = isPaid ? 'Odendi' : item.status === 'posted' ? 'Bu donem' : 'Planli'

                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm ${
                            isPaid
                              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                              : 'border-stone-200 bg-white/90 dark:border-stone-800 dark:bg-stone-950/65'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleMarkPaid(item)}
                            disabled={isPaid || payingId !== null}
                            className={`grid size-8 shrink-0 place-items-center rounded-full border ${
                              isPaid
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-stone-300 bg-white text-transparent dark:border-stone-700 dark:bg-stone-950'
                            }`}
                            aria-label={isPaid ? 'Taksit odendi' : 'Taksiti odendi isaretle'}
                          >
                            <Check size={16} strokeWidth={3} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate font-semibold ${isPaid ? 'text-emerald-800 dark:text-emerald-200' : 'text-stone-900 dark:text-stone-100'}`}>
                              {item.installment_no}/{item.installment_count}. taksit · {formatCurrency(item.amount)}
                            </p>
                            <p className={`text-xs ${isPaid ? 'text-emerald-700/80 dark:text-emerald-300/80' : 'text-stone-500 dark:text-stone-400'}`}>
                              {formatDate(item.due_month)} · {statusLabel}
                            </p>
                          </div>
                          {payingId === item.id ? (
                            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">Isleniyor...</span>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </section>
            )
          })}
        </CardContent>
      </SurfaceCard>

      <SimpleModal title="Taksitli harcamayi duzenle" open={Boolean(editing)} onClose={closeEdit}>
        <form onSubmit={handleSave} className="space-y-4">
          <MoneyInput label="Toplam tutar" value={amount} onValueChange={setAmount} required />
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Aciklama
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              type="text"
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
              Harcama tarihi
              <input
                value={spentAt}
                onChange={(event) => setSpentAt(event.target.value)}
                type="date"
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                required
              />
            </label>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
              Taksit sayisi
              <input
                value={installmentCount}
                onChange={(event) => setInstallmentCount(event.target.value)}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                required
              />
            </label>
          </div>
          <CategoryPicker description={description} value={category} onChange={setCategory} />
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Not
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2.5 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            Duzenleme sonrasi kalan taksitler limitten duselecek sekilde kart borcu guncellenir. Odenmis taksit olan kayitlar bu ekrandan degistirilemez.
          </p>
          {localError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Kaydediliyor...' : 'Degisiklikleri kaydet'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
