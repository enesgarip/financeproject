import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountPaymentModal } from '../components/finance/AccountPaymentModal'
import { ObligationsCalendar } from '../components/finance/ObligationsCalendar'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { useFinanceSnapshot, useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { postDueCardAutoPayments } from '../data/repositories/financeSnapshotRepo'
import { fetchCards } from '../data/repositories/cardsRepo'
import {
  accountLabelForObligation,
  amountLabelForObligation,
  emptyAccountMessageForObligation,
  getAccountsForObligation,
  lastUsedKeyForObligation,
  modalTitleForObligation,
  obligationAmountEditable,
  sortPaymentAccounts,
  submitFinanceObligationPayment,
  submitLabelForObligation,
} from '../services/financePaymentActions'
import type {
  Card as FinanceCard,
  Payment,
  PaymentAmountStatus,
  PaymentCategory,
  PaymentMethod,
} from '../types/database'
import { daysUntil, formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import { paymentCashOutflowAmount, paymentUsesCreditCard } from '../utils/financeSummary'
import type { FinanceObligation, FinanceObligationsInput } from '../utils/obligations'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const paymentCategoryOptions: { label: PaymentCategory; value: PaymentCategory }[] = [
  { label: 'Fatura', value: 'Fatura' },
  { label: 'Dijital üyelik', value: 'Dijital üyelik' },
  { label: 'Kira / aidat', value: 'Kira / aidat' },
  { label: 'Sigorta', value: 'Sigorta' },
  { label: 'Vergi / devlet', value: 'Vergi / devlet' },
  { label: 'Eğitim', value: 'Eğitim' },
  { label: 'Sağlık', value: 'Sağlık' },
  { label: 'Diğer', value: 'Diğer' },
]

const paymentMethodOptions: { label: string; value: PaymentMethod }[] = [
  { label: 'Manuel ödeme', value: 'manual' },
  { label: 'Banka talimatı', value: 'bank_auto' },
]

const amountStatusOptions: { label: string; value: PaymentAmountStatus }[] = [
  { label: 'Kesin tutar', value: 'exact' },
  { label: 'Tahmini / beklenen', value: 'estimated' },
]

type PlanningData = Omit<FinanceObligationsInput, 'payments'>

const EMPTY_PLANNING_DATA: PlanningData = {
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  cardInstallments: [],
  cardStatements: [],
}

const baseFields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  {
    name: 'category',
    label: 'Kategori',
    type: 'select',
    options: paymentCategoryOptions,
  },
  {
    name: 'payment_method',
    label: 'Ödeme yöntemi',
    type: 'select',
    options: paymentMethodOptions,
  },
  {
    name: 'amount_status',
    label: 'Tutar durumu',
    type: 'select',
    options: amountStatusOptions,
  },
  { name: 'amount', label: 'Tutar / tahmin', type: 'number', min: '0', step: '0.01' },
  { name: 'due_date', label: 'Sıradaki tarih', type: 'date', required: true },
  {
    name: 'recurrence',
    label: 'Tekrar',
    type: 'select',
    options: [
      { label: 'Tek seferlik', value: 'none' },
      { label: 'Her ay', value: 'monthly' },
    ],
  },
  {
    name: 'recurrence_day',
    label: 'Her ayın günü',
    type: 'day',
    visibleWhen: { field: 'recurrence', value: 'monthly' },
  },
  {
    name: 'recurrence_end_date',
    label: 'Bitiş tarihi',
    type: 'date',
    visibleWhen: { field: 'recurrence', value: 'monthly' },
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function validatePaymentForm(formData: FormData) {
  const errors: Record<string, string> = {}
  const amount = parseNumber(formData.get('amount'))
  const paymentMethod = formData.get('payment_method')
  const amountStatus = formData.get('amount_status')
  const canWaitForActualAmount = paymentMethod === 'bank_auto' && amountStatus === 'estimated'
  if (amount < 0) errors.amount = 'Tutar negatif olamaz.'
  if (amount <= 0 && !canWaitForActualAmount) errors.amount = 'Tutar 0’dan büyük olmalı.'
  if (formData.get('recurrence') === 'monthly' && !formData.get('recurrence_day')) {
    errors.recurrence_day = 'Aylık ödeme için gün seç.'
  }
  if (paymentMethod === 'bank_auto' && !String(formData.get('auto_source_card_id') ?? '').trim()) {
    errors.auto_source_card_id = 'Banka talimatı için bir kredi kartı seç.'
  }
  return errors
}

async function getPaymentCards(): Promise<FinanceCard[]> {
  const result = await fetchCards()
  return sortPaymentAccounts(result.ok ? result.data : [])
}

function paymentToObligation(payment: Payment): FinanceObligation {
  const usesCreditCard = paymentUsesCreditCard(payment)
  return {
    id: `payment-${payment.id}`,
    kind: 'payment',
    action: 'pay_payment',
    sourceId: payment.id,
    relatedCardId: payment.auto_source_card_id ?? undefined,
    title: payment.title,
    subtitle: payment.category,
    date: payment.due_date,
    amount: payment.amount,
    cashImpactAmount: paymentCashOutflowAmount(payment),
    direction: 'outflow',
    settlement: usesCreditCard ? 'credit_card' : 'cash',
    isEstimate: payment.amount_status === 'estimated',
  }
}

function getPaymentScheduleLabel(payment: Payment) {
  if (payment.recurrence !== 'monthly') return 'Tek seferlik'

  const endDate = payment.recurrence_end_date ? ` · ${formatDate(payment.recurrence_end_date)} bitecek` : ''
  return `Aylık · Her ayın ${payment.recurrence_day ?? '-'}. günü${endDate}`
}

function getPaymentMethodLabel(payment: Payment) {
  return payment.payment_method === 'bank_auto' ? 'Banka talimatı' : 'Manuel ödeme'
}

// Banka talimatı + kredi kartı + bilinen tutar → vade gelince otomatik postalanır;
// bu kayıtlarda manuel "Öde" butonu gösterilmez.
function isAutoPostedPayment(payment: Payment) {
  return paymentUsesCreditCard(payment) && payment.amount > 0
}

/** Vadesi gelmiş banka talimatlarını açılışta otomatik karta borç olarak işler. */
function DueAutoPaymentsAutomation({ reload }: { reload: () => Promise<void> }) {
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    let cancelled = false
    void (async () => {
      const result = await postDueCardAutoPayments()
      if (!cancelled && result.ok && result.data > 0) await reload()
    })()

    return () => {
      cancelled = true
    }
  }, [reload])

  return null
}

function getAmountStatusLabel(payment: Payment) {
  return payment.amount_status === 'estimated' ? 'Tahmini' : 'Kesin'
}

function getPaymentAmountLabel(payment: Payment) {
  if (payment.amount <= 0 && payment.amount_status === 'estimated') return 'Tutar bekleniyor'
  const prefix = payment.amount_status === 'estimated' ? 'Yaklaşık ' : ''
  return `${prefix}${formatCurrency(payment.amount)}`
}

function PaymentsOverview({ rows }: { rows: Payment[] }) {
  const pending = rows.filter((row) => row.status === 'bekliyor')
  if (rows.length === 0) return null

  const pendingTotal = pending.reduce((sum, row) => sum + row.amount, 0)
  const recurringCount = rows.filter((row) => row.recurrence === 'monthly').length
  const paidCount = rows.filter((row) => row.status === 'ödendi').length
  const paidRate = rows.length > 0 ? Math.min(100, (paidCount / rows.length) * 100) : 0
  const overdueCount = pending.filter((row) => {
    const remaining = daysUntil(row.due_date)
    return remaining !== null && remaining < 0
  }).length
  const nextPayment = [...pending].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-warning via-primary to-success opacity-80" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Bekleyen Ödemeler</p>
            <p className="finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none text-foreground">{formatCurrency(pendingTotal)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {pending.length} bekleyen · {recurringCount} aylık tekrar
            </p>
          </div>
          <Badge variant={overdueCount > 0 ? 'destructive' : 'success'}>
            {overdueCount > 0 ? `${overdueCount} geciken` : `${paidCount}/${rows.length} ödendi`}
          </Badge>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-muted-foreground">Tamamlanma</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(paidRate)}</span>
          </div>
          <Progress value={paidRate} color="success" size="default" />
        </div>
        {nextPayment ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{nextPayment.title}</p>
              <p className="text-xs text-muted-foreground">Sıradaki tarih {formatDate(nextPayment.due_date)}</p>
            </div>
            <span className="finance-value shrink-0 text-sm font-bold text-foreground">{getPaymentAmountLabel(nextPayment)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function PaymentsPage() {
  const snapshotQuery = useFinanceSnapshot()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const [obligationToPay, setObligationToPay] = useState<FinanceObligation | null>(null)
  const [obligationAccounts, setObligationAccounts] = useState<FinanceCard[]>([])
  const [obligationAccountId, setObligationAccountId] = useState('')
  const [obligationAmount, setObligationAmount] = useState('')
  const [obligationPaymentError, setObligationPaymentError] = useState('')
  const [obligationSaving, setObligationSaving] = useState(false)
  const [reloadPayments, setReloadPayments] = useState<(() => Promise<void>) | null>(null)

  // Ortak finans snapshot'ından takvim girdisini türet: taksit/borç vadeleri
  // artan sırada, ekstrelerden yalnızca açık olanlar (eski sorgu davranışıyla bire bir).
  const planningData: PlanningData = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot) return EMPTY_PLANNING_DATA

    const byDueDate = (a: { due_date: string | null }, b: { due_date: string | null }) =>
      (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31')

    return {
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: [...snapshot.loanInstallments].sort(byDueDate),
      debts: [...snapshot.debts].sort(byDueDate),
      cardInstallments: snapshot.cardInstallments,
      cardStatements: snapshot.cardStatements.filter((statement) => statement.status === 'open').sort(byDueDate),
    }
  }, [snapshotQuery.data])

  const planningLoading = snapshotQuery.isPending
  const planningError = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : ''
  const loadPlanningData = useCallback(async () => {
    await invalidateSnapshot()
  }, [invalidateSnapshot])

  // Kredi kartı seçimi (banka talimatı için) dinamik olarak kartlardan üretilir.
  const formFields = useMemo<FormField[]>(() => {
    const creditCardOptions = [
      { value: '', label: 'Kart seç' },
      ...planningData.cards
        .filter((card) => card.card_type === 'kredi_karti')
        .map((card) => ({ value: card.id, label: `${card.bank_name} · ${card.card_name}` })),
    ]
    const cardField: FormField = {
      name: 'auto_source_card_id',
      label: 'Otomatik ödeme kartı',
      type: 'select',
      options: creditCardOptions,
      required: true,
      visibleWhen: { field: 'payment_method', value: 'bank_auto' },
    }
    const result: FormField[] = []
    for (const field of baseFields) {
      result.push(field)
      if (field.name === 'payment_method') result.push(cardField)
    }
    return result
  }, [planningData.cards])

  const cardLabelById = useCallback(
    (cardId: string | null) => {
      if (!cardId) return null
      const card = planningData.cards.find((item) => item.id === cardId)
      return card ? `${card.bank_name} · ${card.card_name}` : null
    },
    [planningData.cards],
  )

  async function openObligationPayment(obligation: FinanceObligation, reload: () => Promise<void>) {
    if (!obligation.action) return

    const cards = planningData.cards.length > 0 ? planningData.cards : await getPaymentCards()
    const accounts = getAccountsForObligation(obligation, cards)
    const lastUsedKey = lastUsedKeyForObligation(obligation)
    setObligationToPay(obligation)
    setObligationAccounts(accounts)
    setObligationAccountId(resolvePreferred(getLastUsed(lastUsedKey), accounts.map((card) => card.id)))
    setObligationAmount(obligation.amount > 0 ? String(obligation.amount) : '')
    setObligationPaymentError(accounts.length === 0 ? emptyAccountMessageForObligation(obligation) : '')
    setReloadPayments(() => reload)
  }

  function closeObligationPayment() {
    setObligationToPay(null)
    setObligationAccountId('')
    setObligationAmount('')
    setObligationPaymentError('')
  }

  async function handleObligationPaymentSubmit({ account, amount }: { account: FinanceCard; amount: number }) {
    if (!obligationToPay?.action) return

    setObligationSaving(true)
    setObligationPaymentError('')

    const { error: submitError } = await submitFinanceObligationPayment({
      obligation: obligationToPay,
      account,
      amount,
    })

    setObligationSaving(false)
    if (submitError) {
      setObligationPaymentError(submitError.message ?? 'Ödeme işlemi tamamlanamadı.')
      return
    }

    setLastUsed(lastUsedKeyForObligation(obligationToPay), account.id)
    closeObligationPayment()
    await Promise.all([reloadPayments?.(), loadPlanningData()])
  }

  return (
    <>
      <CrudPage
        table="payments"
        pageTitle="Planlı ödemeler"
        addLabel="Planlı ödeme ekle"
        fields={formFields}
        emptyTitle="Henüz planlı ödeme yok"
        emptyDescription="Yaklaşan kira, fatura veya tek seferlik ödemelerini buradan ekleyebilirsin."
        orderBy="due_date"
        validateForm={validatePaymentForm}
        afterSave={async () => {
          await invalidateSnapshot()
        }}
        afterDelete={async () => {
          await invalidateSnapshot()
        }}
        renderBeforeList={({ loading, rows, reload }) => {
          const payments = rows as Payment[]
          return (
            <div className="flex flex-col gap-3">
              <DueAutoPaymentsAutomation reload={async () => { await Promise.all([reload(), loadPlanningData()]) }} />
              {planningError ? <Alert variant="warning">{planningError}</Alert> : null}
              <ObligationsCalendar
                loading={loading || planningLoading}
                data={{ ...planningData, payments }}
                onPayObligation={(obligation) => void openObligationPayment(obligation, reload)}
              />
              {!loading ? <PaymentsOverview rows={payments} /> : null}
            </div>
          )
        }}
        getInitialValues={(row?: Payment) => ({
          title: row?.title ?? '',
          category: row?.category ?? 'Diğer',
          payment_method: row?.payment_method ?? 'manual',
          amount_status: row?.amount_status ?? (row?.category === 'Fatura' ? 'estimated' : 'exact'),
          amount: row?.amount ?? 0,
          due_date: row?.due_date ?? new Date().toISOString().slice(0, 10),
          recurrence: row?.recurrence ?? 'none',
          recurrence_day: row?.recurrence_day ?? (row?.due_date ? new Date(`${row.due_date}T00:00:00`).getDate() : new Date().getDate()),
          recurrence_end_date: row?.recurrence_end_date ?? '',
          auto_source_card_id: row?.auto_source_card_id ?? '',
          status: row?.status ?? 'bekliyor',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, editing) => {
          const recurrence = formData.get('recurrence') as Payment['recurrence']
          const paymentMethod = (formData.get('payment_method') as PaymentMethod | null) ?? 'manual'
          const autoSourceCardId = paymentMethod === 'bank_auto'
            ? (String(formData.get('auto_source_card_id') ?? '').trim() || null)
            : null

          return {
            user_id: userId,
            title: String(formData.get('title') ?? '').trim(),
            category: (formData.get('category') as PaymentCategory | null) ?? 'Diğer',
            payment_method: paymentMethod,
            amount_status: (formData.get('amount_status') as PaymentAmountStatus | null) ?? 'exact',
            amount: parseNumber(formData.get('amount')),
            due_date: String(formData.get('due_date') ?? ''),
            status: recurrence === 'monthly' ? 'bekliyor' : (editing?.status ?? 'bekliyor'),
            recurrence,
            recurrence_day: recurrence === 'monthly' ? Number(formData.get('recurrence_day')) : null,
            recurrence_end_date: recurrence === 'monthly' ? String(formData.get('recurrence_end_date') ?? '') || null : null,
            auto_source_card_id: autoSourceCardId,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.title}
        renderSubtitle={(row) => `${row.category} · ${row.status} · ${getPaymentScheduleLabel(row)}`}
        renderDetails={(row) => {
          const details = [
            `Tutar: ${getPaymentAmountLabel(row)}`,
            `Durum: ${getAmountStatusLabel(row)} · ${getPaymentMethodLabel(row)}`,
            `Sıradaki tarih: ${formatDate(row.due_date)}`,
          ]
          const autoCard = cardLabelById(row.auto_source_card_id)
          if (row.payment_method === 'bank_auto' && autoCard) {
            details.push(isAutoPostedPayment(row)
              ? `Otomatik karta işlenir: ${autoCard}`
              : `Otomatik kart: ${autoCard} (tutar girilince işlenir)`)
          }
          return details
        }}
        groupBy={(row) => row.category}
        renderRowActions={(row, helpers) =>
          row.status === 'bekliyor' && !isAutoPostedPayment(row) ? (
            <button
              type="button"
              onClick={() => void openObligationPayment(paymentToObligation(row), helpers.reload)}
              className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)] transition hover:bg-success/90 active:scale-[0.97]"
            >
              Öde
            </button>
          ) : null
        }
      />

      <AccountPaymentModal
        title={modalTitleForObligation(obligationToPay)}
        open={Boolean(obligationToPay)}
        onClose={closeObligationPayment}
        accounts={obligationAccounts}
        selectedAccountId={obligationAccountId}
        onSelectedAccountChange={setObligationAccountId}
        amountValue={obligationAmount}
        onAmountValueChange={setObligationAmount}
        amountLabel={amountLabelForObligation(obligationToPay)}
        accountLabel={accountLabelForObligation(obligationToPay)}
        emptyMessage={emptyAccountMessageForObligation(obligationToPay)}
        submitLabel={submitLabelForObligation(obligationToPay)}
        saving={obligationSaving}
        externalError={obligationPaymentError}
        amountEditable={obligationAmountEditable(obligationToPay)}
        accountPreviewAmount={(amount) => obligationToPay?.action === 'collect_debt' ? -amount : amount}
        successAction={obligationToPay?.action === 'collect_debt' || obligationToPay?.action === 'pay_card_statement'}
        info={obligationToPay?.action === 'pay_card_statement' ? 'Bu ekstre kapandığında ekstreye bağlı kredi kartı taksitleri otomatik ödenmiş olur.' : null}
        validate={({ amount }) => {
          if (obligationToPay?.action === 'pay_card_debt' && amount > obligationToPay.amount + 0.01) {
            return 'Ödeme tutarı ödenebilir kart borcundan büyük olamaz.'
          }
          return null
        }}
        onSubmit={handleObligationPaymentSubmit}
      >
        <p className="font-semibold text-foreground">{obligationToPay?.title}</p>
        <p className="mt-0.5">{obligationToPay?.subtitle}</p>
        <p className="mt-0.5">Tarih: {obligationToPay ? formatDate(obligationToPay.date) : '-'}</p>
        <p className="mt-0.5">
          Planlanan tutar:{' '}
          <span className="font-mono font-semibold text-foreground">
            {obligationToPay ? formatCurrency(obligationToPay.amount) : '-'}
          </span>
        </p>
      </AccountPaymentModal>
    </>
  )
}
