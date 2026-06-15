import { CalendarClock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CategoryPicker } from '../components/finance/CategoryPicker'
import { InstallmentPlanner } from '../components/finance/InstallmentPlanner'
import { MoneyInput } from '../components/finance/MoneyInput'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invalidateCategoryMemory, useCategoryMemory } from '../hooks/useCategoryMemory'
import { recordCardInstallmentCarryover } from '../data/repositories/cardsRepo'
import type { Card } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { getLastUsed, setLastUsed } from '../utils/lastUsed'
import { addMonthsToMonth, cardOptionLabel, formatMonthLabel, isMonthValue, monthInputValue, parseInstallmentNumber } from './CardsPage.helpers'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { roundTL } from '../utils/money'

export function LegacyInstallmentPanel({
  rows,
  reload,
  setError,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}) {
  const [cardId, setCardId] = useState(() => getLastUsed('expenseCard'))
  const [installmentAmount, setInstallmentAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [totalInstallments, setTotalInstallments] = useState('9')
  const [paidInstallments, setPaidInstallments] = useState('3')
  const [nextDueMonth, setNextDueMonth] = useState(monthInputValue())
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const categoryMemory = useCategoryMemory()

  const creditCards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti'), [rows])
  const activeCardId = creditCards.some((card) => card.id === cardId) ? cardId : (creditCards[0]?.id ?? '')
  const selectedCard = creditCards.find((card) => card.id === activeCardId)
  const parsedInstallmentAmount = parseNumber(installmentAmount)
  const parsedTotalInstallments = Math.max(2, Math.min(36, parseInstallmentNumber(totalInstallments, 2)))
  const parsedPaidInstallments = Math.max(0, Math.min(parsedTotalInstallments - 1, parseInstallmentNumber(paidInstallments, 0)))
  const remainingCount = Math.max(1, parsedTotalInstallments - parsedPaidInstallments)
  const remainingAmount = roundTL(parsedInstallmentAmount * remainingCount)
  const canSubmitLegacyInstallment =
    Boolean(selectedCard) &&
    parsedInstallmentAmount > 0 &&
    description.trim().length > 0 &&
    parsedPaidInstallments < parsedTotalInstallments &&
    isMonthValue(nextDueMonth) &&
    nextDueMonth >= monthInputValue()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedDescription = description.trim()
    const currentMonth = monthInputValue()
    if (!selectedCard) {
      setLocalError('Kredi kartı seçmelisin.')
      return
    }
    if (parsedInstallmentAmount <= 0) {
      setLocalError('Taksit tutarı 0 dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }
    if (parsedPaidInstallments >= parsedTotalInstallments) {
      setLocalError('Ödenen taksit toplam taksitten küçük olmalı.')
      return
    }
    if (!isMonthValue(nextDueMonth)) {
      setLocalError('Sıradaki taksit ayını seçmelisin.')
      return
    }
    if (nextDueMonth < currentMonth) {
      setLocalError('Sıradaki taksit ayı geçmiş olamaz.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')

    const carryoverResult = await recordCardInstallmentCarryover({
      cardId: selectedCard.id,
      description: trimmedDescription,
      installmentAmount: parsedInstallmentAmount,
      totalInstallments: parsedTotalInstallments,
      paidInstallments: parsedPaidInstallments,
      nextDueMonth: addMonthsToMonth(nextDueMonth, 0),
      category,
    })

    if (!carryoverResult.ok) {
      setSaving(false)
      setLocalError(carryoverResult.error.message ?? 'Taksit devri kaydedilemedi.')
      return
    }

    invalidateCategoryMemory()
    setSaving(false)
    setLastUsed('expenseCard', selectedCard.id)
    setCardId(selectedCard.id)
    setInstallmentAmount('')
    setDescription('')
    setCategory(expenseCategoryOptions[0]?.value ?? 'Diğer')
    setTotalInstallments('9')
    setPaidInstallments('3')
    setNextDueMonth(monthInputValue())
    await reload()
  }

  if (creditCards.length === 0) return null

  return (
    <SurfaceCard className="border-warning/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Taksit devri</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Önceden başlamış taksitlerin kalan aylarını ekle.</p>
          </div>
          <Badge variant="outline">{remainingCount} kalan</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <label className="block text-sm font-semibold text-foreground">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                const nextCardId = event.target.value
                setCardId(nextCardId)
                setLastUsed('expenseCard', nextCardId)
                setLocalError('')
              }}
              className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              required
            >
              {creditCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)] gap-2.5">
            <MoneyInput
              label="Taksit tutarı"
              value={installmentAmount}
              onValueChange={(nextAmount) => {
                setInstallmentAmount(nextAmount)
                setLocalError('')
              }}
              required
            />
            <label className="block text-sm font-semibold text-foreground">
              Açıklama
              <input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setLocalError('')
                }}
                type="text"
                placeholder="Telefon, beyaz eşya..."
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-sm font-semibold text-foreground">
              Toplam
              <input
                value={totalInstallments}
                onChange={(event) => {
                  setTotalInstallments(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
              Ödenen
              <input
                value={paidInstallments}
                onChange={(event) => {
                  setPaidInstallments(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="0"
                max={Math.max(0, parsedTotalInstallments - 1)}
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Sıradaki ay
              <input
                value={nextDueMonth}
                onChange={(event) => {
                  setNextDueMonth(event.target.value)
                  setLocalError('')
                }}
                type="month"
                min={monthInputValue()}
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} memory={categoryMemory} autoApply />
          </div>
          <p className="rounded-xl border border-warning/20 bg-warning/8 px-3 py-2.5 text-xs font-medium text-warning">
            Kalan {formatCurrency(remainingAmount)} tutarı otomatik olarak kart borcuna eklenir; böylece gelecek taksitler limit hesabına yansır.
          </p>
          <InstallmentPlanner
            compact
            remainingCount={remainingCount}
            totalInstallments={parsedTotalInstallments}
            remainingAmount={remainingAmount}
            firstLabel={formatMonthLabel(nextDueMonth)}
            monthlyAmount={parsedInstallmentAmount}
          />
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving || !canSubmitLegacyInstallment}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
          >
            <CalendarClock size={16} />
            {saving ? 'Ekleniyor...' : 'Devir taksitlerini ekle'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}
