import { Camera, ClipboardPaste, Image as ImageIcon, RotateCcw, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { CategoryPicker } from '../components/finance/CategoryPicker'
import { MoneyInput } from '../components/finance/MoneyInput'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invalidateCategoryMemory, useCategoryMemory } from '../hooks/useCategoryMemory'
import { addCardExpense, fetchRecentCardExpenses, recordCardInstallmentCarryover } from '../data/repositories/cardsRepo'
import { fetchAllCardAliases } from '../data/repositories/cardAliasesRepo'
import { fetchCars } from '../data/repositories/carsRepo'
import type { Car, Card, CardExpense, CardExpenseStatus } from '../types/database'
import { buildRepeatSuggestions, type RepeatSuggestion } from '../utils/expenseRepeat'
import { buildClipboardPrefill } from '../utils/clipboardExpense'
import { normalizeSmsWhitespace } from '../utils/smsParser'
import { buildCardTimingChoices } from '../utils/cardTimingChoice'
import { expenseCategoryOptions } from '../utils/categories'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { buildPurchaseTimingHint } from '../utils/purchaseTiming'
import { dateInputValue, formatDate } from '../utils/date'
import { cardProvisionAmount } from '../utils/financeSummary'
import { getLastUsed, setLastUsed } from '../utils/lastUsed'
import { diffTL, sumTL } from '../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { openNativePicker } from '../lib/utils'
import { cardOptionLabel, moneyShare } from './CardsPage.helpers'
import { OverviewStat } from './CardsPage.overview'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { parseReceiptImage } from '../lib/receiptParseClient'
import { sha256Hex } from '../utils/sourceEventId'

export function QuickExpensePanel({
  rows,
  reload,
  setError,
  focus,
  formatAmount,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
  focus?: { cardId: string; mode: 'cash' | 'installment'; nonce: number } | null
  formatAmount?: (value: number | null | undefined) => string
}) {
  const [cardId, setCardId] = useState(() => getLastUsed('expenseCard'))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [category, setCategory] = useState(expenseCategoryOptions[0]?.value ?? 'Diğer')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'installment'>('cash')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [paidInstallments, setPaidInstallments] = useState('0')
  const [nextDueDate, setNextDueDate] = useState(dateInputValue(new Date()))
  const [expenseStatus, setExpenseStatus] = useState<CardExpenseStatus>('posted')
  const [localError, setLocalError] = useState('')
  // Harcama yazıldı ama araç etiketi uygulanamadı: hata DEĞİL, uyarı. Kullanıcı
  // "hiç kaydolmadı" sanıp tekrar göndermesin (manuel kayıtta dedupe yok).
  const [localWarning, setLocalWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [prefilledByScan, setPrefilledByScan] = useState(false)
  const [scanEventId, setScanEventId] = useState<string | null>(null)
  // Panodan doldurulan banka SMS'i: source='sms' + webhook'la AYNI hash şeması
  // → çift yönlü DB dedupe bedava (unique index user+source+event).
  const [prefilledBySms, setPrefilledBySms] = useState(false)
  const [smsEventId, setSmsEventId] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const submissionIdentityRef = useRef<{ signature: string; eventId: string } | null>(null)
  const categoryMemory = useCategoryMemory()
  const { user } = useAuth()
  // Alias listesi ÖNCEDEN elde tutulur: paste handler'ında readText'ten önce
  // await olamaz (iOS transient activation). Anahtar CardsPage.list ile ortak.
  const aliasesQuery = useQuery({
    queryKey: ['card-aliases', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await fetchAllCardAliases()
      return result.ok ? result.data : []
    },
  })
  const [recentExpenses, setRecentExpenses] = useState<CardExpense[]>([])
  const [vehicles, setVehicles] = useState<Car[]>([])
  const [carId, setCarId] = useState('')
  const cards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti' || row.card_type === 'banka_karti'), [rows])
  const repeatSuggestions = useMemo(() => buildRepeatSuggestions(recentExpenses), [recentExpenses])
  const activeCardId = cards.some((card) => card.id === cardId) ? cardId : (cards[0]?.id ?? '')
  const selectedCard = cards.find((card) => card.id === activeCardId)
  const canUseInstallments = selectedCard?.card_type === 'kredi_karti'
  const parsedAmount = parseNumber(amount)
  const parsedInstallmentCount = canUseInstallments && paymentMode === 'installment' ? Math.max(2, Math.min(36, Number(installmentCount) || 2)) : 1
  const parsedPaidInstallments = canUseInstallments && paymentMode === 'installment'
    ? Math.max(0, Math.min(parsedInstallmentCount - 1, Math.trunc(Number(paidInstallments) || 0)))
    : 0
  const trimmedDescription = description.trim()
  const firstPeriodAmount = parsedInstallmentCount > 1 ? moneyShare(parsedAmount, parsedInstallmentCount) : parsedAmount
  const remainingInstallmentCount = Math.max(1, parsedInstallmentCount - parsedPaidInstallments)
  const carryoverAmount = sumTL(Array.from({ length: remainingInstallmentCount }, () => firstPeriodAmount))
  const isCarryover = parsedInstallmentCount > 1 && parsedPaidInstallments > 0
  const previewDate = isCarryover ? nextDueDate : spentAt
  const statementPreview = useMemo(() => getCardStatementPeriod(selectedCard, previewDate), [selectedCard, previewDate])
  /**
   * Kesim günü etkisi: kesime az kalmışken beklemek ödemeyi bir ay öteler.
   * Yalnız normal (taksit devri olmayan) harcamada anlamlı — devirde tarih
   * kullanıcının verdiği vade tarihidir, "beklemek" diye bir seçim yok.
   */
  const timingHint = useMemo(
    () => (isCarryover ? null : buildPurchaseTimingHint(selectedCard, new Date(`${previewDate}T00:00:00`))),
    [selectedCard, previewDate, isCarryover],
  )
  // Kartlar arası kıyas çipleri. Manuel useMemo YOK: React Compiler bu deseni
  // kendisi memo'lar; gün anahtarlı elle memo burada compiler'ın
  // preserve-manual-memoization kapısına takılıyor (list.tsx'teki emsalden
  // farklı olarak araya türetilmiş state giriyor). Hesap kart sayısıyla
  // doğrusal ve ucuz.
  const timingChoices = buildCardTimingChoices(cards, parsedAmount, new Date(`${dateInputValue(new Date())}T00:00:00`))
  // Banka hesabında bakiye aşımı: MovementModal aynı hesap için gönderimi
  // engelliyordu, burada 0'a kırpılıp sessizce geçiyordu → aynı hesap iki kural.
  // Artık tek kural: sunucu reddetmeden önce kullanıcı görür ve gönderemez.
  const isBankAccount = selectedCard?.card_type === 'banka_karti'
  const rawDebitPreview = diffTL(selectedCard?.current_balance, parsedAmount)
  const debitPreview = Math.max(0, rawDebitPreview)
  const exceedsAccountBalance = Boolean(isBankAccount) && parsedAmount > 0 && rawDebitPreview < 0
  // Provizyon yalnız KREDİ KARTI kavramıdır (limitten düşer, ekstreye sonra
  // girer). Banka hesabında para anında çıkar → durum her zaman kesinleşmiş.
  const canUseProvision = selectedCard?.card_type === 'kredi_karti'
  const effectiveStatus: CardExpenseStatus = isCarryover || !canUseProvision ? 'posted' : expenseStatus
  const isProvision = effectiveStatus === 'provision'
  const displayAmount = formatAmount ?? formatCurrency
  const canSubmitQuickExpense = Boolean(selectedCard) &&
    parsedAmount > 0 &&
    trimmedDescription.length > 0 &&
    !saving &&
    !exceedsAccountBalance &&
    (!isCarryover || Boolean(nextDueDate))

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

  // Son harcamalar "tekrarla" çipleri için; kaydettikten sonra da tazelenir.
  const loadRecent = useCallback(async () => {
    const result = await fetchRecentCardExpenses(40)
    if (result.ok) setRecentExpenses(result.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRecent()
  }, [loadRecent])

  // Arabalarım: harcamayı girerken bir araca etiketleme seçeneği (opsiyonel).
  useEffect(() => {
    void fetchCars().then((result) => {
      if (result.ok) setVehicles(result.data)
    })
  }, [])

  function applyRepeat(suggestion: RepeatSuggestion) {
    if (cards.some((card) => card.id === suggestion.cardId)) {
      setCardId(suggestion.cardId)
      setLastUsed('expenseCard', suggestion.cardId)
    }
    setAmount(String(suggestion.amount))
    setDescription(suggestion.description)
    setCategory(suggestion.category)
    setPaymentMode('cash')
    setPaidInstallments('0')
    setExpenseStatus('posted')
    clearPrefillOrigins()
    setLocalError('')
  }

  /**
   * Ön-doldurma kökenlerini tek yerden sıfırla. Dağınık sıfırlama en kritik
   * regresyon riskiydi: bayat sms/scan event id'si sonraki ELLE girişe yapışırsa
   * idempotens yüzünden kayıt SESSİZCE yutulur (hiç oluşmaz).
   */
  function clearPrefillOrigins() {
    setPrefilledByScan(false)
    setScanEventId(null)
    setPrefilledBySms(false)
    setSmsEventId(null)
  }

  async function handleScanFile(file: File) {
    setScanning(true)
    setLocalError('')
    try {
      const [result, artifactHash] = await Promise.all([
        parseReceiptImage(file),
        file.arrayBuffer().then(sha256Hex),
      ])
      setAmount(String(result.amount))
      if (result.merchant) setDescription(result.merchant)
      if (result.category) setCategory(result.category)
      if (result.date) setSpentAt(result.date)
      // Kaynak ölçümü: form fişten dolduruldu; kullanıcı düzeltse bile kaydın
      // kökeni taramadır (otomasyon kapsamı bunu elle giriş saymamalı).
      clearPrefillOrigins()
      setPrefilledByScan(true)
      setScanEventId(artifactHash)
    } catch (scanError) {
      setLocalError(scanError instanceof Error ? scanError.message : 'Fiş okunamadı, tekrar dene.')
    } finally {
      setScanning(false)
    }
  }

  async function handlePasteFromClipboard() {
    // iOS transient activation: readText bu handler'ın İLK await'i OLMALI —
    // öncesine başka await girerse kullanıcı jesti düşer, NotAllowedError gelir.
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setLocalError(
        'Panoya erişilemedi. Tarayıcı izin vermemiş olabilir — site ayarlarından pano iznini aç ya da alanları elle doldur.',
      )
      return
    }
    setLocalError('')
    setLocalWarning('')
    const prefill = buildClipboardPrefill(text, aliasesQuery.data ?? [])
    if (prefill.kind === 'empty') {
      setLocalError('Panoda kullanılabilir bir metin yok.')
      return
    }
    if (prefill.kind === 'sms-account-in') {
      setLocalError('Bu bir gelen para SMS’i — hızlı harcama formu gider içindir.')
      return
    }

    clearPrefillOrigins()
    setPaymentMode('cash')
    setPaidInstallments('0')

    if (prefill.kind === 'sms-card') {
      if (prefill.cardId && cards.some((card) => card.id === prefill.cardId)) {
        setCardId(prefill.cardId)
        setLastUsed('expenseCard', prefill.cardId)
      } else {
        setLocalWarning(`${prefill.lastFour} ile biten kart tanınmadı — kart seçimini kontrol et.`)
      }
      setAmount(String(prefill.amount))
      setDescription(prefill.description)
      setSpentAt(prefill.spentAt)
      // SMS otomasyonuyla tutarlı ön-seçim (webhook 'provision' yazar); alan
      // düzenlenebilir, banka hesabında effectiveStatus zaten 'posted'a düşer.
      setExpenseStatus('provision')
      setPrefilledBySms(true)
      setSmsEventId(await sha256Hex(normalizeSmsWhitespace(text)))
      return
    }
    if (prefill.kind === 'sms-account-out') {
      // Hesap SMS'ine hash verilmez (saniyesiz format iki gerçek hareketi
      // ayıramaz — smsParser.accountSmsNeedsExternalEventId gerekçesi).
      setAmount(String(prefill.amount))
      setDescription(prefill.description)
      setSpentAt(prefill.spentAt)
      return
    }
    if (prefill.amount != null) setAmount(String(prefill.amount))
    if (prefill.description) setDescription(prefill.description)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    if (!selectedCard) {
      setLocalError('Kart seçmelisin.')
      return
    }
    if (parsedAmount <= 0) {
      setLocalError('Tutar 0’dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }
    if (isCarryover && !nextDueDate) {
      setLocalError('Sıradaki taksit tarihini seçmelisin.')
      return
    }
    if (exceedsAccountBalance) {
      setLocalError('Bu tutar hesap bakiyesini aşıyor. Sunucu da reddeder; tutarı düşür ya da başka hesap seç.')
      return
    }
    const source = prefilledBySms ? 'sms' : prefilledByScan ? 'receipt_scan' : 'manual'
    const signature = JSON.stringify({
      cardId: selectedCard.id,
      amount: parsedAmount,
      description: trimmedDescription,
      spentAt,
      category,
      paymentMode,
      installmentCount: parsedInstallmentCount,
      paidInstallments: parsedPaidInstallments,
      nextDueDate,
      status: effectiveStatus,
      source,
    })
    if (!submissionIdentityRef.current || submissionIdentityRef.current.signature !== signature) {
      submissionIdentityRef.current = { signature, eventId: crypto.randomUUID() }
    }
    const sourceEventId = smsEventId ?? scanEventId ?? submissionIdentityRef.current.eventId

    submittingRef.current = true
    setSaving(true)
    setLocalError('')
    setLocalWarning('')
    setError('')
    const submitResult = isCarryover
      ? await recordCardInstallmentCarryover({
        cardId: selectedCard.id,
        description: trimmedDescription,
        installmentAmount: firstPeriodAmount,
        totalInstallments: parsedInstallmentCount,
        paidInstallments: parsedPaidInstallments,
        nextDueDate,
        category,
        sourceEventId,
        carId: carId || null,
      })
      : await addCardExpense({
        cardId: selectedCard.id,
        amount: parsedAmount,
        description: trimmedDescription,
        spentAt,
        category,
        installmentCount: parsedInstallmentCount,
        status: effectiveStatus,
        source,
        sourceEventId,
        carId: carId || null,
      })

    submittingRef.current = false
    setSaving(false)
    if (!submitResult.ok) {
      setLocalError(
        isMissingSupabaseCapabilityError(submitResult.error)
          ? missingSupabaseCapabilityMessage('Provizyon/taksit altyapısı', submitResult.error)
          : submitResult.error.message ?? (isCarryover ? 'Taksit devri kaydedilemedi.' : 'Harcama kaydedilemedi.'),
      )
      return
    }

    // Harcama yazıldı; araç etiketi düştüyse formu SIFIRLAMAYA devam ederiz —
    // tekrar gönderim çift harcama üretirdi.
    setLocalWarning(submitResult.data.carTagWarning ?? '')
    invalidateCategoryMemory()
    setLastUsed('expenseCard', selectedCard.id)
    setCardId(selectedCard.id)
    setAmount('')
    setDescription('')
    setSpentAt(dateInputValue(new Date()))
    setCategory(expenseCategoryOptions[0]?.value ?? 'Diğer')
    setPaymentMode('cash')
    setInstallmentCount('1')
    setPaidInstallments('0')
    setNextDueDate(dateInputValue(new Date()))
    setExpenseStatus('posted')
    clearPrefillOrigins()
    setCarId('')
    submissionIdentityRef.current = null
    await Promise.all([reload(), loadRecent()])
  }

  if (cards.length === 0) return null

  return (
    <SurfaceCard id="hizli-harcama" className="border-success/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Hızlı harcama</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Kart, TL tutar ve açıklama yeterli.</p>
          </div>
          {selectedCard ? (
            <Badge variant={selectedCard.card_type === 'kredi_karti' ? 'secondary' : 'outline'}>
              {selectedCard.card_type === 'kredi_karti'
                ? cardProvisionAmount(selectedCard) > 0
                  ? `Provizyon ${displayAmount(cardProvisionAmount(selectedCard))}`
                  : `Toplam ${displayAmount(selectedCard.debt_amount)}`
                : `Bakiye ${displayAmount(selectedCard.current_balance)}`}
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
              <button
                type="button"
                onClick={() => void handlePasteFromClipboard()}
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
                aria-label="Panodaki banka SMS'i ya da metinden formu doldur"
              >
                <ClipboardPaste size={16} />
                Panodan doldur
              </button>
            </div>
          )}
          {repeatSuggestions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-ink-muted">Son harcamalar · tek dokunuşla tekrarla</p>
              <div className="flex flex-wrap gap-1.5">
                {repeatSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.description}-${suggestion.amount}`}
                    type="button"
                    onClick={() => applyRepeat(suggestion)}
                    className="tap-target inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-success/40 hover:bg-success/8"
                    aria-label={`${suggestion.description} harcamasını tekrarla`}
                  >
                    <RotateCcw size={12} className="text-ink-muted" />
                    <span className="max-w-[9rem] truncate">{suggestion.description}</span>
                    <span className="tabular-nums text-ink-muted">{displayAmount(suggestion.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="block text-sm font-semibold text-ink">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                const nextCardId = event.target.value
                setCardId(nextCardId)
                setLastUsed('expenseCard', nextCardId)
                setPaymentMode('cash')
                setPaidInstallments('0')
                setLocalError('')
                setLocalWarning('')
              }}
              className="mt-1 w-full rounded-lg border border-line-strong bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
              required
            >
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          {timingChoices.length > 0 ? (
            <div role="group" aria-label="Kartlar arası son ödeme kıyası" className="flex flex-wrap gap-1.5">
              {timingChoices.map((choice) => (
                <button
                  key={choice.cardId}
                  type="button"
                  onClick={() => {
                    setCardId(choice.cardId)
                    setLastUsed('expenseCard', choice.cardId)
                    setLocalError('')
                  }}
                  aria-pressed={activeCardId === choice.cardId}
                  title={
                    choice.hasSchedule
                      ? `Bugün alırsan ilk ödeme ~${choice.daysUntilDue} gün sonra${choice.fitsLimit ? '' : ' · kullanılabilir limit bu tutara yetmiyor'}`
                      : 'Kesim/son ödeme günü kartta tanımlı değil'
                  }
                  className={[
                    'tap-target inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    activeCardId === choice.cardId
                      ? 'border-primary/50 bg-primary/10 text-ink'
                      : 'border-line-strong bg-raised text-ink hover:border-success/40',
                    choice.fitsLimit ? '' : 'opacity-45',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="max-w-[8rem] truncate">{choice.label}</span>
                  <span className="tabular-nums text-ink-muted">
                    {choice.hasSchedule ? `~${choice.daysUntilDue} gün` : 'gün eksik'}
                  </span>
                  {choice.isBest ? <span className="font-bold text-success">en geç</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2.5">
            <MoneyInput
              label={canUseInstallments && paymentMode === 'installment' ? 'Toplam tutar' : 'TL'}
              value={amount}
              onValueChange={(nextAmount) => {
                setAmount(nextAmount)
                setLocalError('')
              }}
              required
            />
            <label className="block text-sm font-semibold text-ink">
              Açıklama
              <input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setLocalError('')
                }}
                type="text"
                placeholder="Migros, benzin, yemek..."
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2.5 min-[760px]:grid-cols-4">
            <label className="block min-w-0 text-sm font-semibold text-ink">
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
                className="mt-1 block w-full min-w-0 max-w-[10.75rem] appearance-none rounded-lg border border-line-strong px-3 py-2.5 outline-none [color-scheme:light] transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 min-[480px]:max-w-full dark:bg-raised dark:text-ink dark:[color-scheme:dark]"
              />
            </label>
            <CategoryPicker description={description} value={category} onChange={setCategory} memory={categoryMemory} autoApply />
            <label className="block min-w-0 text-sm font-semibold text-ink">
              İşlem türü
              <select
                value={canUseInstallments ? paymentMode : 'cash'}
                onChange={(event) => {
                  const nextMode = event.target.value as 'cash' | 'installment'
                  setPaymentMode(nextMode)
                  if (nextMode === 'installment' && Number(installmentCount) < 2) setInstallmentCount('2')
                  if (nextMode === 'cash') setPaidInstallments('0')
                  setLocalError('')
                }}
                disabled={!canUseInstallments}
                className="mt-1 w-full min-w-0 rounded-lg border border-line-strong bg-raised px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-page disabled:text-ink-muted dark:bg-raised dark:text-ink dark:disabled:bg-page"
              >
                <option value="cash">Peşin</option>
                <option value="installment">Taksitli</option>
              </select>
            </label>
            <label className="block min-w-0 text-sm font-semibold text-ink">
              Durum
              <select
                value={effectiveStatus}
                onChange={(event) => {
                  setExpenseStatus(event.target.value as CardExpenseStatus)
                  setLocalError('')
                }}
                disabled={isCarryover || !canUseProvision}
                className="mt-1 w-full min-w-0 rounded-lg border border-line-strong bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
              >
                <option value="posted">Kesinleşmiş</option>
                {canUseProvision ? <option value="provision">Provizyonda</option> : null}
              </select>
            </label>
          </div>
          {vehicles.length > 0 ? (
            <label className="block text-sm font-semibold text-ink">
              Araç <span className="font-normal text-ink-muted">(opsiyonel · Araçlar)</span>
              <select
                value={carId}
                onChange={(event) => setCarId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-line-strong bg-white px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
              >
                <option value="">Araç yok</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                    {vehicle.plate ? ` · ${vehicle.plate}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canUseInstallments && paymentMode === 'installment' ? (
            <label className="block text-sm font-semibold text-ink">
              Taksit sayısı
              <input
                value={installmentCount}
                onChange={(event) => {
                  const nextCount = Math.max(2, Math.min(36, Math.trunc(Number(event.target.value) || 2)))
                  setInstallmentCount(event.target.value)
                  setPaidInstallments((current) => String(Math.min(Math.max(0, Number(current) || 0), nextCount - 1)))
                  setLocalError('')
                }}
                type="number"
                min="2"
                max="36"
                step="1"
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
              />
            </label>
          ) : null}
          {canUseInstallments && paymentMode === 'installment' ? (
            <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2">
              <label className="block text-sm font-semibold text-ink">
                Şu ana kadar ödenen taksit
                <input
                  value={paidInstallments}
                  onChange={(event) => {
                    setPaidInstallments(event.target.value)
                    if (Number(event.target.value) > 0) setExpenseStatus('posted')
                    setLocalError('')
                  }}
                  type="number"
                  min="0"
                  max={Math.max(0, parsedInstallmentCount - 1)}
                  step="1"
                  className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
                />
              </label>
              {isCarryover ? (
                <label className="block min-w-0 text-sm font-semibold text-ink">
                  Sıradaki taksit tarihi
                  <input
                    value={nextDueDate}
                    onChange={(event) => {
                      setNextDueDate(event.target.value)
                      setLocalError('')
                    }}
                    onClick={(event) => openNativePicker(event.currentTarget)}
                    onFocus={(event) => openNativePicker(event.currentTarget)}
                    type="date"
                    className="mt-1 block w-full min-w-0 rounded-lg border border-line-strong px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-raised dark:text-ink"
                    required
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          {isCarryover && nextDueDate && nextDueDate <= dateInputValue(new Date()) ? (
            <p className="rounded-xl border border-warning/20 bg-warning/8 px-3 py-2.5 text-xs font-medium text-warning">
              Bu tarihle sıradaki taksit bugün dönem içi borca işlenir. Taksit bir sonraki ekstrede
              görünecekse gelecek ayın tarihini seç; yoksa dönem borcu bir ay erken şişer.
            </p>
          ) : null}
          {selectedCard?.card_type === 'kredi_karti' ? (
            <div className="rounded-xl border border-success/20 bg-success/8 p-3">
              <div className="grid grid-cols-2 gap-2 min-[430px]:grid-cols-4">
                <OverviewStat label="Dönem" value={statementPreview?.periodLabel ?? 'Gün eksik'} />
                <OverviewStat label="Ekstre" value={statementPreview ? formatDate(statementPreview.statementDate) : 'Gün eksik'} />
                <OverviewStat label="Son ödeme" value={statementPreview ? formatDate(statementPreview.dueDate) : 'Gün eksik'} />
                <OverviewStat
                  label={isCarryover ? 'Kalan borç' : isProvision ? 'Durum' : parsedInstallmentCount > 1 ? 'İlk yansıma' : 'Yansıma'}
                  value={isCarryover ? displayAmount(carryoverAmount) : isProvision ? 'Provizyon' : displayAmount(firstPeriodAmount)}
                />
              </div>
              {statementPreview ? (
                <p className="mt-2 text-xs font-medium text-success">
                  {isCarryover
                    ? `${parsedPaidInstallments}/${parsedInstallmentCount} taksit ödenmiş kabul edilir; kart borcuna kalan ${remainingInstallmentCount} taksit eklenir.`
                    : isProvision
                    ? `Bu işlem şimdilik sadece limitten düşer; kesinleşince ${statementPreview.statementMonthLabel} dönemine alınır.`
                    : `Bu işlem ${statementPreview.statementMonthLabel} ekstresine girer; ödeme planı ${formatDate(statementPreview.dueDate)} tarihine bağlanır.`}
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium text-warning">
                  Kartta ekstre ve son ödeme günü eksik. Kartı güncellersen analizler daha net çalışır.
                </p>
              )}
              {/* Kesim günü etkisi: aynı harcama, bir gün farkla bir ay sonra
                  ödenir. Bilgi zaten vardı ama karar anında görünmüyordu.
                  Yalnız kesim yakınken gösterilir — 3 hafta sonrası için
                  "beklesen" demek gerçekçi değil, gürültü olur. */}
              {timingHint?.waitWorthIt ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Kesime {timingHint.daysUntilStatement === 0 ? 'bugün' : `${timingHint.daysUntilStatement} gün`} kaldı:
                  bugün alırsan <span className="font-semibold text-ink">{timingHint.daysUntilDue} gün</span> sonra
                  ({formatDate(timingHint.dueDate)}), kesimden sonraya bırakırsan{' '}
                  <span className="font-semibold text-ink">{timingHint.waitDaysUntilDue} gün</span> sonra
                  ({formatDate(timingHint.waitDueDate)}) ödersin.
                </p>
              ) : null}
            </div>
          ) : selectedCard ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-line-strong bg-page p-3">
                <OverviewStat label="Mevcut bakiye" value={displayAmount(selectedCard.current_balance)} />
                <OverviewStat label="İşlem sonrası" value={displayAmount(debitPreview)} />
              </div>
              {exceedsAccountBalance ? (
                <p className="rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-2.5 text-xs font-medium text-destructive">
                  Bu tutar hesap bakiyesini aşıyor; kayıt yapılamaz. Tutarı düşür ya da başka bir hesap seç.
                </p>
              ) : null}
            </div>
          ) : null}
          {localError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{localError}</p> : null}
          {localWarning ? <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{localWarning}</p> : null}
          <button
            type="submit"
            disabled={!canSubmitQuickExpense}
            className="rounded-xl bg-success px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 hover:bg-success/90"
          >
            {saving ? 'Ekleniyor...' : 'Harcamayı kaydet'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}
