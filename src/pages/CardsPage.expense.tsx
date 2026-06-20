import { Camera, Image as ImageIcon, ScanLine } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CategoryPicker } from '../components/finance/CategoryPicker'
import { MoneyInput } from '../components/finance/MoneyInput'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invalidateCategoryMemory, useCategoryMemory } from '../hooks/useCategoryMemory'
import { addCardExpense } from '../data/repositories/cardsRepo'
import type { Card, CardExpenseStatus } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { dateInputValue, formatDate } from '../utils/date'
import { cardProvisionAmount } from '../utils/financeSummary'
import { getLastUsed, setLastUsed } from '../utils/lastUsed'
import { diffTL } from '../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { openNativePicker } from '../lib/utils'
import { cardOptionLabel, moneyShare } from './CardsPage.helpers'
import { OverviewStat } from './CardsPage.overview'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { parseReceiptImage } from '../lib/receiptParseClient'

export function QuickExpensePanel({
  rows,
  reload,
  setError,
  focus,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
  focus?: { cardId: string; mode: 'cash' | 'installment'; nonce: number } | null
}) {
  const [cardId, setCardId] = useState(() => getLastUsed('expenseCard'))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'installment'>('cash')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [expenseStatus, setExpenseStatus] = useState<CardExpenseStatus>('posted')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const categoryMemory = useCategoryMemory()
  const cards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti' || row.card_type === 'banka_karti'), [rows])
  const activeCardId = cards.some((card) => card.id === cardId) ? cardId : (cards[0]?.id ?? '')
  const selectedCard = cards.find((card) => card.id === activeCardId)
  const canUseInstallments = selectedCard?.card_type === 'kredi_karti'
  const parsedAmount = parseNumber(amount)
  const parsedInstallmentCount = canUseInstallments && paymentMode === 'installment' ? Math.max(2, Math.min(36, Number(installmentCount) || 2)) : 1
  const trimmedDescription = description.trim()
  const statementPreview = useMemo(() => getCardStatementPeriod(selectedCard, spentAt), [selectedCard, spentAt])
  const firstPeriodAmount = parsedInstallmentCount > 1 ? moneyShare(parsedAmount, parsedInstallmentCount) : parsedAmount
  const debitPreview = Math.max(0, diffTL(selectedCard?.current_balance, parsedAmount))
  const isProvision = expenseStatus === 'provision'
  const canSubmitQuickExpense = Boolean(selectedCard) && parsedAmount > 0 && trimmedDescription.length > 0 && !saving

  // "Harcama ekle / Taksit ekle" kısayolundan gelen kartı ve modu önceden seç.
  const focusCardId = focus?.cardId
  const focusMode = focus?.mode
  const focusNonce = focus?.nonce
  useEffect(() => {
    if (!focusCardId || !focusMode) return
    const targetCard = cards.find((card) => card.id === focusCardId)
    if (!targetCard) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCardId(targetCard.id)
    setLastUsed('expenseCard', targetCard.id)
    if (focusMode === 'installment' && targetCard.card_type === 'kredi_karti') {
      setPaymentMode('installment')
      setInstallmentCount((current) => (Number(current) < 2 ? '2' : current))
    }
  }, [cards, focusCardId, focusMode, focusNonce])

  async function handleScanFile(file: File) {
    setScanning(true)
    setLocalError('')
    try {
      const result = await parseReceiptImage(file)
      setAmount(String(result.amount))
      if (result.merchant) setDescription(result.merchant)
      if (result.category) setCategory(result.category)
      if (result.date) setSpentAt(result.date)
    } catch (scanError) {
      setLocalError(scanError instanceof Error ? scanError.message : 'Fiş okunamadı, tekrar dene.')
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedCard) {
      setLocalError('Kart seçmelisin.')
      return
    }
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
    const submitResult = await addCardExpense({
      cardId: selectedCard.id,
      amount: parsedAmount,
      description: trimmedDescription,
      spentAt,
      category,
      installmentCount: parsedInstallmentCount,
      status: expenseStatus,
    })

    setSaving(false)
    if (!submitResult.ok) {
      setLocalError(
        isMissingSupabaseCapabilityError(submitResult.error)
          ? missingSupabaseCapabilityMessage('Provizyon/taksit altyapısı', submitResult.error)
          : submitResult.error.message ?? 'Harcama kaydedilemedi.',
      )
      return
    }

    invalidateCategoryMemory()
    setLastUsed('expenseCard', selectedCard.id)
    setCardId(selectedCard.id)
    setAmount('')
    setDescription('')
    setSpentAt(dateInputValue(new Date()))
    setCategory(expenseCategoryOptions[0]?.value ?? 'Diğer')
    setPaymentMode('cash')
    setInstallmentCount('1')
    setExpenseStatus('posted')
    await reload()
  }

  if (cards.length === 0) return null

  return (
    <SurfaceCard id="hizli-harcama" className="border-success/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Hızlı harcama</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kart, TL tutar ve açıklama yeterli.</p>
          </div>
          {selectedCard ? (
            <Badge variant={selectedCard.card_type === 'kredi_karti' ? 'secondary' : 'outline'}>
              {selectedCard.card_type === 'kredi_karti'
                ? cardProvisionAmount(selectedCard) > 0
                  ? `Provizyon ${formatCurrency(cardProvisionAmount(selectedCard))}`
                  : `Toplam ${formatCurrency(selectedCard.debt_amount)}`
                : `Bakiye ${formatCurrency(selectedCard.current_balance)}`}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = '' // allow re-selecting the same file
              if (file) void handleScanFile(file)
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = '' // allow re-selecting the same file
              if (file) void handleScanFile(file)
            }}
          />
          {scanning ? (
            <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary">
              <ScanLine size={16} />
              Fiş okunuyor...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
              >
                <Camera size={16} />
                Kamerayla çek
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
              >
                <ImageIcon size={16} />
                Galeriden seç
              </button>
            </div>
          )}
          <label className="block text-sm font-semibold text-foreground">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                const nextCardId = event.target.value
                setCardId(nextCardId)
                setLastUsed('expenseCard', nextCardId)
                setPaymentMode('cash')
                setLocalError('')
              }}
              className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              required
            >
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2.5">
            <MoneyInput
              label="TL"
              value={amount}
              onValueChange={(nextAmount) => {
                setAmount(nextAmount)
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
                placeholder="Migros, benzin, yemek..."
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5 min-[760px]:grid-cols-4">
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Tarih
              <input
                value={spentAt}
                onChange={(event) => {
                  setSpentAt(event.target.value)
                  setLocalError('')
                }}
                onClick={(event) => openNativePicker(event.currentTarget)}
                onFocus={(event) => openNativePicker(event.currentTarget)}
                type="date"
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-input px-3 py-2.5 outline-none [color-scheme:light] transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-card/50 dark:text-foreground dark:[color-scheme:dark]"
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} memory={categoryMemory} autoApply />
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              İşlem türü
              <select
                value={canUseInstallments ? paymentMode : 'cash'}
                onChange={(event) => {
                  const nextMode = event.target.value as 'cash' | 'installment'
                  setPaymentMode(nextMode)
                  if (nextMode === 'installment' && Number(installmentCount) < 2) setInstallmentCount('2')
                  setLocalError('')
                }}
                disabled={!canUseInstallments}
                className="mt-1 w-full min-w-0 rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-muted disabled:text-muted-foreground dark:bg-card/50 dark:text-foreground dark:disabled:bg-muted"
              >
                <option value="cash">Peşin</option>
                <option value="installment">Taksitli</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm font-semibold text-foreground">
              Durum
              <select
                value={expenseStatus}
                onChange={(event) => {
                  setExpenseStatus(event.target.value as CardExpenseStatus)
                  setLocalError('')
                }}
                className="mt-1 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              >
                <option value="posted">Kesinleşmiş</option>
                <option value="provision">Provizyonda</option>
              </select>
            </label>
          </div>
          {canUseInstallments && paymentMode === 'installment' ? (
            <label className="block text-sm font-semibold text-foreground">
              Taksit sayısı
              <input
                value={installmentCount}
                onChange={(event) => {
                  setInstallmentCount(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-input px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              />
            </label>
          ) : null}
          {selectedCard?.card_type === 'kredi_karti' ? (
            <div className="rounded-xl border border-success/20 bg-success/8 p-3">
              <div className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-4">
                <OverviewStat label="Dönem" value={statementPreview?.periodLabel ?? 'Gün eksik'} />
                <OverviewStat label="Ekstre" value={statementPreview ? formatDate(statementPreview.statementDate) : 'Gün eksik'} />
                <OverviewStat label="Son ödeme" value={statementPreview ? formatDate(statementPreview.dueDate) : 'Gün eksik'} />
                <OverviewStat
                  label={isProvision ? 'Durum' : parsedInstallmentCount > 1 ? 'İlk yansıma' : 'Yansıma'}
                  value={isProvision ? 'Provizyon' : formatCurrency(firstPeriodAmount)}
                />
              </div>
              {statementPreview ? (
                <p className="mt-2 text-xs font-medium text-success">
                  {isProvision
                    ? `Bu işlem şimdilik sadece limitten düşer; kesinleşince ${statementPreview.statementMonthLabel} dönemine alınır.`
                    : `Bu işlem ${statementPreview.statementMonthLabel} ekstresine girer; ödeme planı ${formatDate(statementPreview.dueDate)} tarihine bağlanır.`}
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium text-warning">
                  Kartta ekstre ve son ödeme günü eksik. Kartı güncellersen analizler daha net çalışır.
                </p>
              )}
            </div>
          ) : selectedCard ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <OverviewStat label="Mevcut bakiye" value={formatCurrency(selectedCard.current_balance)} />
              <OverviewStat label="İşlem sonrası" value={formatCurrency(debitPreview)} />
            </div>
          ) : null}
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          <button
            type="submit"
            disabled={!canSubmitQuickExpense}
            className="rounded-xl bg-success px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-success/90"
          >
            {saving ? 'Ekleniyor...' : 'Harcamayı kaydet'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}
