import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CategoryPicker } from './CategoryPicker'
import { MoneyInput } from './MoneyInput'
import { SimpleModal } from '../SimpleModal'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabase'
import type { Card, CardExpense } from '../../types/database'
import { expenseCategoryOptions } from '../../utils/categories'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the function')
}

type CardInstallmentExpensesPanelProps = {
  cards: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}

export function CardInstallmentExpensesPanel({ cards, reload, setError }: CardInstallmentExpensesPanelProps) {
  const [expenses, setExpenses] = useState<CardExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CardExpense | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState('')
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [installmentCount, setInstallmentCount] = useState('2')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

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
      setError(error.message)
    } else {
      setExpenses((data ?? []) as CardExpense[])
    }
    setLoading(false)
  }, [setError])

  useEffect(() => {
    void loadExpenses()
  }, [loadExpenses])

  function openEdit(expense: CardExpense) {
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
      setLocalError('Tutar 0 dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
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
        ? 'Harcama düzenleme henüz veritabanında yok. Migration uygulanınca bu işlem açılacak.'
        : error.message
      setLocalError(message)
      return
    }

    closeEdit()
    await Promise.all([loadExpenses(), reload()])
  }

  if (loading) {
    return (
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardContent className="p-4 text-sm text-muted-foreground">Taksitli harcamalar yükleniyor...</CardContent>
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
              <p className="mt-1 text-xs text-muted-foreground">Tutar veya taksit sayısını düzenleyince kart borcu ve plan yeniden hesaplanır.</p>
            </div>
            <Badge variant="secondary">{expenses.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-2">
          {expenses.map((expense) => {
            const card = cardsById.get(expense.card_id)
            return (
              <div key={expense.id} className="flex items-start justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{expense.description}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)} · {expense.installment_count} taksit
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(expense.amount)} · aylık {formatCurrency(expense.installment_amount)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(expense)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                >
                  <Pencil size={13} />
                  Düzenle
                </button>
              </div>
            )
          })}
        </CardContent>
      </SurfaceCard>

      <SimpleModal title="Taksitli harcamayı düzenle" open={Boolean(editing)} onClose={closeEdit}>
        <form onSubmit={handleSave} className="space-y-4">
          <MoneyInput label="Toplam tutar" value={amount} onValueChange={setAmount} required />
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Açıklama
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
              Taksit sayısı
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
            Düzenleme sonrası kalan taksitler limitten düşülecek şekilde kart borcu güncellenir. Eski taksit devri kayıtlarında not alanı korunur.
          </p>
          {localError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Kaydediliyor...' : 'Değişiklikleri kaydet'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
