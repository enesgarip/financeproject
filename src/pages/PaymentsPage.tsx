import { CrudPage, type FormField } from '../components/CrudPage'
import { AccountPaymentModal } from '../components/finance/AccountPaymentModal'
import { ObligationsCalendar } from '../components/finance/ObligationsCalendar'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type {
  Card as FinanceCard,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  PaymentAmountStatus,
  PaymentCategory,
  PaymentMethod,
} from '../types/database'
import { daysUntil, formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import type { FinanceObligation, FinanceObligationsInput } from '../utils/obligations'
import { useCallback, useEffect, useState } from 'react'

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

const fields: FormField[] = [
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
  return errors
}

async function getPaymentCards(): Promise<FinanceCard[]> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')

  if (error) return []
  return ((data as FinanceCard[]) ?? []).sort((left, right) => {
    if (left.card_type !== right.card_type) return left.card_type === 'banka_karti' ? -1 : 1
    return `${left.bank_name} ${left.card_name}`.localeCompare(`${right.bank_name} ${right.card_name}`, 'tr')
  })
}

function getAccountsForObligation(obligation: FinanceObligation, cards: FinanceCard[]) {
  const bankOnly = obligation.action !== 'pay_payment'
  const accounts = bankOnly
    ? cards.filter((card) => card.card_type === 'banka_karti' && card.id !== obligation.relatedCardId)
    : cards

  return [...accounts].sort((left, right) => {
    if (left.card_type !== right.card_type) return left.card_type === 'banka_karti' ? -1 : 1
    return `${left.bank_name} ${left.card_name}`.localeCompare(`${right.bank_name} ${right.card_name}`, 'tr')
  })
}

function paymentToObligation(payment: Payment): FinanceObligation {
  return {
    id: `payment-${payment.id}`,
    kind: 'payment',
    action: 'pay_payment',
    sourceId: payment.id,
    title: payment.title,
    subtitle: payment.category,
    date: payment.due_date,
    amount: payment.amount,
    direction: 'outflow',
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

function getAmountStatusLabel(payment: Payment) {
  return payment.amount_status === 'estimated' ? 'Tahmini' : 'Kesin'
}

function getPaymentAmountLabel(payment: Payment) {
  if (payment.amount <= 0 && payment.amount_status === 'estimated') return 'Tutar bekleniyor'
  const prefix = payment.amount_status === 'estimated' ? 'Yaklaşık ' : ''
  return `${prefix}${formatCurrency(payment.amount)}`
}

function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === 'PGRST204' || message.includes('schema cache') || message.includes('Could not find the function')
}

function lastUsedKeyForObligation(obligation: FinanceObligation) {
  if (obligation.action === 'pay_loan_installment') return 'loanAccount'
  if (obligation.action === 'settle_debt' || obligation.action === 'collect_debt') return 'debtAccount'
  return 'paymentAccount'
}

function modalTitleForObligation(obligation: FinanceObligation | null) {
  if (!obligation) return 'Ödeme yap'
  if (obligation.action === 'collect_debt') return 'Alacağı tahsil et'
  if (obligation.action === 'settle_debt') return 'Borcu öde'
  if (obligation.action === 'pay_card_statement') return 'Ekstre ödemesi'
  if (obligation.action === 'pay_card_debt') return 'Kredi kartı borç ödeme'
  if (obligation.action === 'pay_loan_installment') return 'Taksit ödemesi'
  return 'Ödeme yap'
}

function submitLabelForObligation(obligation: FinanceObligation | null) {
  if (!obligation) return 'İşlemi tamamla'
  if (obligation.action === 'collect_debt') return 'Tahsilatı tamamla'
  if (obligation.action === 'settle_debt') return 'Borcu öde'
  if (obligation.action === 'pay_card_statement') return 'Ekstreyi öde'
  if (obligation.action === 'pay_card_debt') return 'Borç öde'
  if (obligation.action === 'pay_loan_installment') return 'Taksiti öde'
  return 'Ödemeyi tamamla'
}

function accountLabelForObligation(obligation: FinanceObligation | null) {
  return obligation?.action === 'collect_debt' ? 'Tahsilat hesabı' : 'Kaynak hesap'
}

function amountLabelForObligation(obligation: FinanceObligation | null) {
  if (obligation?.action === 'collect_debt') return 'Tahsilat tutarı'
  if (obligation?.action === 'pay_payment') return 'Ödenen gerçek tutar'
  if (obligation?.action === 'pay_card_debt') return 'Ödeme tutarı'
  return 'Tutar'
}

function emptyAccountMessageForObligation(obligation: FinanceObligation | null) {
  if (obligation?.action === 'pay_payment') return 'Kullanılabilir banka hesabı veya kredi kartı yok.'
  if (obligation?.action === 'collect_debt') return 'Tahsilat için önce bir banka hesabı eklemelisin.'
  return 'Ödeme için önce bir banka hesabı eklemelisin.'
}

function obligationAmountEditable(obligation: FinanceObligation | null) {
  return obligation?.action === 'pay_payment' || obligation?.action === 'pay_card_debt'
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
  const [planningData, setPlanningData] = useState<PlanningData>(EMPTY_PLANNING_DATA)
  const [planningLoading, setPlanningLoading] = useState(true)
  const [planningError, setPlanningError] = useState('')
  const [obligationToPay, setObligationToPay] = useState<FinanceObligation | null>(null)
  const [obligationAccounts, setObligationAccounts] = useState<FinanceCard[]>([])
  const [obligationAccountId, setObligationAccountId] = useState('')
  const [obligationAmount, setObligationAmount] = useState('')
  const [obligationPaymentError, setObligationPaymentError] = useState('')
  const [obligationSaving, setObligationSaving] = useState(false)
  const [reloadPayments, setReloadPayments] = useState<(() => Promise<void>) | null>(null)

  const loadPlanningData = useCallback(async () => {
    setPlanningLoading(true)
    setPlanningError('')

    const [cards, loans, loanInstallments, debts, cardInstallments, cardStatements] = await Promise.all([
      supabase.from('cards').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*').order('due_date', { ascending: true }),
      supabase.from('debts').select('*').order('due_date', { ascending: true }),
      supabase.from('card_installments').select('*').order('due_month', { ascending: true }),
      supabase.from('card_statement_archives').select('*').eq('status', 'open').order('due_date', { ascending: true }),
    ])

    const firstError = [cards.error, loans.error, loanInstallments.error, debts.error, cardInstallments.error, cardStatements.error].find(Boolean)
    if (firstError) setPlanningError(firstError.message)

    setPlanningData({
      cards: (cards.data ?? []) as FinanceCard[],
      loans: (loans.data ?? []) as Loan[],
      loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
      debts: (debts.data ?? []) as Debt[],
      cardInstallments: (cardInstallments.data ?? []) as CardInstallment[],
      cardStatements: (cardStatements.data ?? []) as CardStatementArchive[],
    })
    setPlanningLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlanningData()
  }, [loadPlanningData])

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

    let submitError: { message: string; code?: string } | null = null

    if (obligationToPay.action === 'pay_payment') {
      const { error } = await supabase.rpc('pay_payment', {
        p_payment_id: obligationToPay.sourceId,
        p_source_card_id: account.id,
        p_paid_amount: amount,
      })

      submitError = error
      if (submitError && isSchemaCacheError(submitError)) {
        const { error: updateError } = await supabase
          .from('payments')
          .update({ amount, updated_at: new Date().toISOString() })
          .eq('id', obligationToPay.sourceId)

        if (updateError) {
          submitError = updateError
        } else {
          const { error: legacyError } = await supabase.rpc('pay_payment', {
            p_payment_id: obligationToPay.sourceId,
            p_source_card_id: account.id,
          })
          submitError = legacyError
        }
      }
    } else if (obligationToPay.action === 'pay_card_statement') {
      const { error } = await supabase.rpc('pay_card_statement', {
        p_statement_id: obligationToPay.sourceId,
        p_source_card_id: account.id,
      })
      submitError = error
    } else if (obligationToPay.action === 'pay_card_debt') {
      const { error } = await supabase.rpc('pay_card_debt', {
        p_card_id: obligationToPay.sourceId,
        p_source_card_id: account.id,
        p_amount: amount,
      })
      submitError = error
    } else if (obligationToPay.action === 'pay_loan_installment') {
      const { error } = await supabase.rpc('pay_loan_installment', {
        p_installment_id: obligationToPay.sourceId,
        p_source_card_id: account.id,
      })
      submitError = error
    } else if (obligationToPay.action === 'settle_debt' || obligationToPay.action === 'collect_debt') {
      const { error } = await supabase.rpc('settle_personal_debt', {
        p_debt_id: obligationToPay.sourceId,
        p_account_card_id: account.id,
      })
      submitError = error
    }

    setObligationSaving(false)
    if (submitError) {
      setObligationPaymentError(submitError.message)
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
        fields={fields}
        emptyTitle="Henüz planlı ödeme yok"
        emptyDescription="Yaklaşan kira, fatura veya tek seferlik ödemelerini buradan ekleyebilirsin."
        orderBy="due_date"
        validateForm={validatePaymentForm}
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
          status: row?.status ?? 'bekliyor',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, editing) => {
          const recurrence = formData.get('recurrence') as Payment['recurrence']

          return {
            user_id: userId,
            title: String(formData.get('title') ?? '').trim(),
            category: (formData.get('category') as PaymentCategory | null) ?? 'Diğer',
            payment_method: (formData.get('payment_method') as PaymentMethod | null) ?? 'manual',
            amount_status: (formData.get('amount_status') as PaymentAmountStatus | null) ?? 'exact',
            amount: parseNumber(formData.get('amount')),
            due_date: String(formData.get('due_date') ?? ''),
            status: recurrence === 'monthly' ? 'bekliyor' : (editing?.status ?? 'bekliyor'),
            recurrence,
            recurrence_day: recurrence === 'monthly' ? Number(formData.get('recurrence_day')) : null,
            recurrence_end_date: recurrence === 'monthly' ? String(formData.get('recurrence_end_date') ?? '') || null : null,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.title}
        renderSubtitle={(row) => `${row.category} · ${row.status} · ${getPaymentScheduleLabel(row)}`}
        renderDetails={(row) => [
          `Tutar: ${getPaymentAmountLabel(row)}`,
          `Durum: ${getAmountStatusLabel(row)} · ${getPaymentMethodLabel(row)}`,
          `Sıradaki tarih: ${formatDate(row.due_date)}`,
        ]}
        groupBy={(row) => row.category}
        renderRowActions={(row, helpers) =>
          row.status === 'bekliyor' ? (
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
