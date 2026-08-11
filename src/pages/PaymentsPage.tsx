import { CalendarDays, CreditCard, Receipt, RefreshCw } from 'lucide-react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { ObligationsCalendar } from '../components/finance/ObligationsCalendar'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { HeroNumber, SERIT_TEXT } from '../components/serit'
import { useFinanceSnapshot, useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { fetchCards } from '../data/repositories/cardsRepo'
import { sortPaymentAccounts } from '../services/financePaymentActions'
import type {
  Card as FinanceCard,
  Payment,
  PaymentAmountStatus,
  PaymentCategory,
  PaymentMethod,
  TransactionHistory,
} from '../types/database'
import { addMonths, dateInputValue, daysUntil, formatDate, startOfMonth } from '../utils/date'
import { formatSeritAmount, parseNumber } from '../utils/formatCurrency'
import { paymentCashOutflowAmount, paymentOccurrenceInMonth, paymentUsesCreditCard } from '../utils/financeSummary'
import { sumTL } from '../utils/money'
import { paidPaymentIdsInMonth } from '../utils/paymentHistory'
import type { FinanceObligation, FinanceObligationsInput } from '../utils/obligations'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import { useCallback, useMemo } from 'react'

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

// BM-5: Kart talimatlı ödeme BİLGİLENDİRME kaydıdır; tahmini tutar proaktif
// karta yazılmaz. Gerçek kayıt SMS'ten (anlık) veya ekstre importundan (aylık
// kesin kapanış) gelir ve planı otomatik ilerletir; manuel "Öde" açık kalır.
function isCardInstructedPayment(payment: Payment) {
  return paymentUsesCreditCard(payment)
}

function getPaymentAmountLabel(payment: Payment) {
  if (payment.amount <= 0 && payment.amount_status === 'estimated') return 'Tutar bekleniyor'
  const prefix = payment.amount_status === 'estimated' ? 'Yaklaşık ' : ''
  return `${prefix}${formatSeritAmount(payment.amount, { decimals: 2 })}`
}

function PaymentsOverview({ rows, transactionHistory }: { rows: Payment[]; transactionHistory: TransactionHistory[] }) {
  // Tutarlar Şerit bileşenleri üzerinden biçimleniyor; gizlilik onların içinde.
  const summary = useMemo(() => {
    if (rows.length === 0) return null

    const currentMonth = startOfMonth(new Date())
    const nextMonthStart = startOfMonth(addMonths(currentMonth, 1))

    const pendingThisMonth = rows.filter((row) => paymentOccurrenceInMonth(row, currentMonth) !== null)

    const paidIds = paidPaymentIdsInMonth(transactionHistory, currentMonth)

    const monthStart = dateInputValue(currentMonth)
    const monthEnd = dateInputValue(nextMonthStart)
    const paidOneTimeThisMonth = rows.filter((row) =>
      row.recurrence !== 'monthly' &&
      row.status === 'ödendi' &&
      row.due_date >= monthStart && row.due_date < monthEnd,
    )

    const paidThisMonthCount = new Set([
      ...rows.filter((row) => paidIds.has(row.id)).map((row) => row.id),
      ...paidOneTimeThisMonth.map((row) => row.id),
    ]).size
    const totalThisMonth = pendingThisMonth.length + paidThisMonthCount

    const pendingTotal = sumTL(pendingThisMonth.map((row) => row.amount))
    const recurringCount = rows.filter((row) => row.recurrence === 'monthly').length
    const paidRate = totalThisMonth > 0 ? Math.min(100, (paidThisMonthCount / totalThisMonth) * 100) : 0
    const overdueCount = pendingThisMonth.filter((row) => {
      const remaining = daysUntil(row.due_date)
      return remaining !== null && remaining < 0
    }).length
    const nextPayment = [...pendingThisMonth].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] as Payment | undefined
    const statusLabel = overdueCount > 0
      ? `${overdueCount} geciken`
      : pendingThisMonth.length > 0
        ? `${pendingThisMonth.length} bekleyen`
        : 'Takvim temiz'

    return { pendingThisMonth, paidThisMonthCount, pendingTotal, recurringCount, paidRate, overdueCount, nextPayment, statusLabel }
  }, [rows, transactionHistory])

  if (!summary) return null

  const { pendingThisMonth, paidThisMonthCount, pendingTotal, recurringCount, paidRate, overdueCount, nextPayment, statusLabel } = summary

  // Şerit (`3b`): kahraman = kalan yükümlülük, altında vade sayısı ve en yakını.
  const nextDays = nextPayment ? daysUntil(nextPayment.due_date) : null

  return (
    <section>
      <HeroNumber
        label="Kalan yükümlülük"
        value={pendingTotal}
        tone={overdueCount > 0 ? 'danger' : 'ink'}
        // İlerleme yalnız gerçekten ödenen varsa çizilir; boş çubuk "hiç
        // ilerlemedin" gibi okunuyordu.
        progress={paidThisMonthCount > 0 ? paidRate : undefined}
        description={
          <>
            {pendingThisMonth.length} vade
            {nextDays !== null ? (
              <>
                {' '}
                · en yakını{' '}
                <span className="font-semibold" style={{ color: nextDays < 0 ? SERIT_TEXT.danger : SERIT_TEXT.ink }}>
                  {nextDays < 0 ? 'gecikti' : nextDays === 0 ? 'bugün' : `${nextDays} gün sonra`}
                </span>
              </>
            ) : null}
            {recurringCount > 0 ? ` · ${recurringCount} aylık tekrar` : null}
          </>
        }
      />

      <p className="mt-3.5 border-t border-line pt-3 text-[12.5px] text-ink-muted">
        <span className="font-semibold text-ink">{statusLabel}</span>
        {paidThisMonthCount > 0 ? ` · bu ay ${paidThisMonthCount} kayıt ödendi` : null}
        {nextPayment ? (
          <>
            {' '}
            · sıradaki <span className="text-ink">{nextPayment.title}</span> {formatDate(nextPayment.due_date)}{' '}
            <span className="serit-num font-semibold text-ink">{getPaymentAmountLabel(nextPayment)}</span>
          </>
        ) : null}
      </p>
    </section>
  )
}

export function PaymentsPage() {
  const snapshotQuery = useFinanceSnapshot()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()

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
      salaryHistory: snapshot.salaryHistory,
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

    await openPaymentDrawer(obligation, {
      cards: planningData.cards.length > 0 ? planningData.cards : undefined,
      loadCards: planningData.cards.length > 0 ? undefined : getPaymentCards,
      reload,
      afterSuccess: loadPlanningData,
    })
  }

  return (
    <>
      <CrudPage
        table="payments"
        pageTitle="Planlı ödemeler"
        pageLabel="Nakit takvimi"
        pageDescription="Fatura, kira ve tek seferlik yükümlülükleri vadeye göre planla ve ödeme akışını yönet."
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
              {planningError ? <Alert variant="warning">{planningError}</Alert> : null}
              <ObligationsCalendar
                loading={loading || planningLoading}
                data={{ ...planningData, payments }}
                onPayObligation={(obligation) => void openObligationPayment(obligation, reload)}
              />
              {!loading ? <PaymentsOverview rows={payments} transactionHistory={snapshotQuery.data?.transactionHistory ?? []} /> : null}
            </div>
          )
        }}
        getInitialValues={(row?: Payment) => ({
          title: row?.title ?? '',
          category: row?.category ?? 'Diğer',
          payment_method: row?.payment_method ?? 'manual',
          amount_status: row?.amount_status ?? (row?.category === 'Fatura' ? 'estimated' : 'exact'),
          amount: row?.amount ?? 0,
          due_date: row?.due_date ?? dateInputValue(new Date()),
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
        renderSubtitle={(row) => `${row.category} · ${row.status}`}
        renderDetails={(row) => [`Tutar: ${getPaymentAmountLabel(row)}`]}
        groupBy={(row) => row.category}
        renderCard={(row, { menu, reload }) => {
          const payment = row as Payment
          const autoCard = cardLabelById(payment.auto_source_card_id)
          const isAuto = payment.payment_method === 'bank_auto'
          const isPaid = payment.status === 'ödendi'
          const isRecurring = payment.recurrence === 'monthly'
          const remaining = daysUntil(new Date(`${payment.due_date}T00:00:00`))
          const isUrgent = remaining !== null && remaining >= 0 && remaining <= 3

          return (
            <article className={`rounded-2xl border bg-card p-4 transition-all duration-250 hover:-translate-y-0.5 min-[390px]:p-5 ${isPaid ? 'border-success/20 opacity-70' : isUrgent ? 'border-warning/40' : 'border-border/75'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${isPaid ? 'bg-success/12 text-success' : isAuto ? 'bg-info/12 text-info' : 'bg-muted text-muted-foreground'}`}>
                    {isAuto ? <CreditCard className="size-5" /> : <Receipt className="size-5" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-black text-foreground">{payment.title}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{payment.category} · {getPaymentScheduleLabel(payment)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isPaid ? <Badge variant="success">Ödendi</Badge> : null}
                  {isRecurring && !isPaid ? <RefreshCw size={13} className="text-muted-foreground" /> : null}
                  {payment.amount_status === 'estimated' && !isPaid ? <Badge variant="outline">Tahmini</Badge> : null}
                  {menu}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tutar</p>
                  <p className="mt-0.5 font-mono text-lg font-black tabular-nums text-foreground">{getPaymentAmountLabel(payment)}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <CalendarDays size={14} />
                  <span>{formatDate(payment.due_date)}</span>
                  {isUrgent && !isPaid ? <Badge variant="warning" className="ml-1">{remaining} gün</Badge> : null}
                </div>
              </div>

              {isAuto && autoCard ? (
                <p className="mt-2.5 text-[11px] font-semibold text-info/70">
                  <CreditCard size={11} className="mr-1 inline" />
                  {autoCard}
                </p>
              ) : null}

              {!isPaid && isCardInstructedPayment(payment) ? (
                <p className="mt-2.5 text-[11px] font-medium text-muted-foreground">
                  Talimat bilgilendirmedir; harcama SMS geldiğinde veya ekstre importunda otomatik işlenir ve plan ilerler.
                </p>
              ) : null}

              {!isPaid ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void openObligationPayment(paymentToObligation(payment), reload)}
                    className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground transition hover:bg-success/90 active:scale-[0.97]"
                  >
                    Öde
                  </button>
                </div>
              ) : null}
            </article>
          )
        }}
      />

      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
