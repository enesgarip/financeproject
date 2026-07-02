import { CalendarDays, Check, MoreVertical, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrudPage } from '../components/CrudPage'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { SimpleModal } from '../components/SimpleModal'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import {
  deleteLoanInstallment,
  fetchLoanInstallments,
  updateLoanInstallment,
} from '../data/repositories/loansRepo'
import type { Loan, LoanInstallment } from '../types/database'
import { formatDate } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import { BankLogo } from '../components/finance/BankLogo'
import { Badge } from '../components/ui/badge'
import { Progress } from '../components/ui/progress'
import { LoanOverview } from './LoansPage.components'
import {
  getBankaKartlari,
  getNextPaymentDate,
  loanFields,
  loanProgress,
  nextPendingInstallment,
  optionalDate,
  optionalDay,
  syncLoanInstallmentPlan,
  validateLoanForm,
} from './LoansPage.helpers'

// Kredi özeti (remaining_amount/installments/status) artık DB'de loan_installments
// üzerindeki sync_loan_summary trigger'ından türetiliyor (Faz 2). İstemci tarafı
// recompute fazlalıktı ve float topluyordu; kaldırıldı, trigger numeric ile kesin hesaplar.

// Tüm taksitleri ödenen krediyi trigger 'closed' yapar; kapalı krediler listede
// aktiflerin altında, varsayılan kapalı bir "Tamamlananlar" bölümünde toplanır.
const COMPLETED_LOAN_GROUPS = ['Tamamlananlar']

export function LoansPage() {
  const { formatAmount } = useBalancePrivacy()
  const { confirm, confirmDialog } = useConfirmDialog()
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()
  const [reloadLoans, setReloadLoans] = useState<(() => Promise<void>) | null>(null)
  const [installments, setInstallments] = useState<LoanInstallment[]>([])
  const [planMenuOpenId, setPlanMenuOpenId] = useState<string | null>(null)
  const [editingPlanItem, setEditingPlanItem] = useState<LoanInstallment | null>(null)
  const [planDueDate, setPlanDueDate] = useState('')
  const [planAmount, setPlanAmount] = useState('')
  const [planNote, setPlanNote] = useState('')
  const [planError, setPlanError] = useState('')
  const [planSaving, setPlanSaving] = useState(false)

  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const loadInstallments = useCallback(async () => {
    const result = await fetchLoanInstallments()
    setInstallments(result.ok ? result.data : [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  useEffect(() => {
    function handleClickOutside() {
      setPlanMenuOpenId(null)
    }

    if (planMenuOpenId) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [planMenuOpenId])

  async function openInstallmentPayment(loan: Loan, item: LoanInstallment, reload: () => Promise<void>) {
    setReloadLoans(() => reload)
    await openPaymentDrawer(
      {
        id: `loan-installment-${item.id}`,
        kind: 'loan_installment',
        action: 'pay_loan_installment',
        sourceId: item.id,
        title: loan.loan_name,
        subtitle: `${loan.bank_name} - ${item.installment_no}. taksit`,
        date: item.due_date,
        amount: item.amount,
        direction: 'outflow',
      },
      {
        loadCards: getBankaKartlari,
        reload,
        afterSuccess: async () => {
          await Promise.all([loadInstallments(), invalidateSnapshot()])
        },
        detail: (
          <>
            <p className="font-semibold text-foreground">{loan.loan_name}</p>
            <p className="mt-0.5">
              {item.installment_no}. taksit · {formatDate(item.due_date)}
            </p>
            <p className="mt-0.5">Kalan taksit: {loan.remaining_installments}</p>
          </>
        ),
      },
    )
  }

  function openPlanEdit(item: LoanInstallment) {
    setEditingPlanItem(item)
    setPlanDueDate(item.due_date)
    setPlanAmount(String(item.amount))
    setPlanNote(item.note ?? '')
    setPlanError('')
    setPlanMenuOpenId(null)
  }

  async function handlePlanEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingPlanItem) return

    const amount = parseNumber(planAmount)
    if (!planDueDate) {
      setPlanError('Vade tarihi zorunlu.')
      return
    }
    if (amount <= 0) {
      setPlanError('Taksit tutarı 0’dan büyük olmalı.')
      return
    }

    setPlanSaving(true)
    const result = await updateLoanInstallment(editingPlanItem.id, {
      due_date: planDueDate,
      amount,
      note: planNote || null,
      updated_at: new Date().toISOString(),
    })

    setPlanSaving(false)
    if (!result.ok) {
      setPlanError(result.error.message ?? 'Taksit güncellenemedi.')
      return
    }

    await Promise.all([loadInstallments(), reloadLoans?.(), invalidateSnapshot()])

    setEditingPlanItem(null)
  }

  async function deletePlanItem(item: LoanInstallment, reload: () => Promise<void>, setError: (message: string) => void) {
    const confirmed = await confirm({
      title: 'Taksiti sil',
      description: 'Bu taksit ödeme planından silinecek ve kredi toplamları yeniden hesaplanacak.',
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (!confirmed) return

    const result = await deleteLoanInstallment(item.id)
    if (!result.ok) {
      setError(result.error.message ?? 'Taksit silinemedi.')
      return
    }

    await Promise.all([loadInstallments(), reload(), invalidateSnapshot()])
  }

  function renderPaymentPlan(loan: Loan, reload: () => Promise<void>, setError: (message: string) => void) {
    const loanInstallments = installments.filter((item) => item.loan_id === loan.id)
    if (loanInstallments.length === 0) {
      return (
        <section className="mt-4 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Ödeme planı yok</h3>
              <p className="mt-1 text-xs text-muted-foreground">Kredi bilgilerinden aylık taksit listesini oluşturabilirsin.</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await syncLoanInstallmentPlan(loan)
                  await Promise.all([loadInstallments(), reload(), invalidateSnapshot()])
                } catch (syncError) {
                  setError(syncError instanceof Error ? syncError.message : 'Ödeme planı oluşturulamadı.')
                }
              }}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97]"
            >
              Plan oluştur
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="mt-4 rounded-2xl border border-border/70 bg-muted/20 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="finance-label">Ödeme Planı</h3>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
            {loanInstallments.filter((item) => item.status === 'ödendi').length}/{loanInstallments.length}
          </span>
        </div>
        <div className="space-y-2">
          {loanInstallments.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-2 py-2 text-sm"
            >
              {item.status === 'ödendi' ? (
                <div
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-success text-success-foreground"
                  aria-label="Taksit ödendi"
                >
                  <Check size={16} strokeWidth={3} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void openInstallmentPayment(loan, item, reload)}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-[0.97]"
                >
                  <ReceiptText size={13} />
                  Öde
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">
                  {item.installment_no}. taksit · <span className="font-mono">{formatAmount(item.amount)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(item.due_date)} · {item.status === 'ödendi' ? 'Ödendi' : 'Bekliyor'}
                </p>
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setPlanMenuOpenId(planMenuOpenId === item.id ? null : item.id)
                  }}
                  className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Taksit menüsü"
                >
                  <MoreVertical size={16} />
                </button>
                {planMenuOpenId === item.id ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-elevated)]">
                    <button
                      type="button"
                      onClick={() => openPlanEdit(item)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                    >
                      <Pencil size={14} />
                      Düzenle
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlanMenuOpenId(null)
                        void deletePlanItem(item, reload, setError)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 size={14} />
                      Sil
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <>
      <CrudPage
        table="loans"
        pageTitle="Krediler"
        addLabel="Kredi ekle"
        fields={loanFields}
        emptyTitle="Henüz kredi yok"
        emptyDescription="Aktif veya kapanmış kredilerini, taksit günleriyle birlikte ekleyebilirsin."
        validateForm={validateLoanForm}
        groupBy={(row) => (row.status === 'active' ? '' : 'Tamamlananlar')}
        collapsibleGroups={COMPLETED_LOAN_GROUPS}
        renderBeforeList={({ loading, rows }) => (!loading ? <LoanOverview loans={rows as Loan[]} installments={installments} /> : null)}
        afterSave={async (row) => {
          await syncLoanInstallmentPlan(row as Loan)
          await Promise.all([loadInstallments(), invalidateSnapshot()])
        }}
        afterDelete={async () => {
          await Promise.all([loadInstallments(), invalidateSnapshot()])
        }}
        getInitialValues={(row?: Loan) => ({
          bank_name: row?.bank_name ?? '',
          loan_name: row?.loan_name ?? '',
          total_amount: row?.total_amount ?? 0,
          monthly_payment: row?.monthly_payment ?? 0,
          installment_day: row?.installment_day ?? '',
          start_date: row?.start_date ?? '',
          end_date: row?.end_date ?? '',
          status: row?.status ?? 'active',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, existingRow) => ({
          user_id: userId,
          bank_name: String(formData.get('bank_name') ?? '').trim(),
          loan_name: String(formData.get('loan_name') ?? '').trim(),
          total_amount: parseNumber(formData.get('total_amount')),
          remaining_amount: existingRow ? (existingRow as Loan).remaining_amount : parseNumber(formData.get('total_amount')),
          monthly_payment: parseNumber(formData.get('monthly_payment')),
          installment_day: optionalDay(formData.get('installment_day')),
          start_date: optionalDate(formData.get('start_date')),
          end_date: optionalDate(formData.get('end_date')),
          remaining_installments: existingRow ? (existingRow as Loan).remaining_installments : 0,
          status: formData.get('status') as Loan['status'],
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.loan_name}
        renderSubtitle={(row) => `${row.bank_name} · ${row.status === 'active' ? 'Aktif kredi' : 'Kapalı kredi'}`}
        renderDetails={(row) => {
          const details = [
            `Kalan borç: ${formatAmount(row.remaining_amount)}`,
            `Aylık ödeme: ${formatAmount(row.monthly_payment)}`,
          ]
          return details
        }}
        renderCard={(row, { menu, reload, setError }) => {
          const loan = row as Loan
          const progress = loanProgress(loan, installments)
          const nextInstallment = nextPendingInstallment(loan, installments)
          const nextPaymentDate = nextInstallment
            ? formatDate(nextInstallment.due_date)
            : loan.installment_day
              ? getNextPaymentDate(loan.installment_day, loan.remaining_installments)
              : null

          return (
            <article className="rounded-2xl border border-border/75 bg-card p-4 shadow-[var(--shadow-card)] transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)] dark:ring-1 dark:ring-white/[0.04] min-[390px]:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <BankLogo bankName={loan.bank_name} size="sm" />
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-black text-foreground">{loan.loan_name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{loan.bank_name} · {loan.status === 'active' ? 'Aktif kredi' : 'Kapalı kredi'}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={progress.next ? 'warning' : 'success'}>
                    {progress.totalCount ? `${progress.paidCount}/${progress.totalCount}` : `${loan.remaining_installments} kaldı`}
                  </Badge>
                  {menu}
                </div>
              </div>

              <div className="mt-3">
                <Progress value={progress.progressRate} color="primary" size="default" />
              </div>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Kalan borç</p>
                  <p className="mt-0.5 font-mono text-lg font-black tabular-nums text-destructive">{formatAmount(loan.remaining_amount)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Aylık taksit</p>
                  <p className="mt-0.5 font-mono text-lg font-black tabular-nums text-foreground">{formatAmount(loan.monthly_payment)}</p>
                </div>
                {nextPaymentDate ? (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <CalendarDays size={14} />
                    <span>{nextPaymentDate}</span>
                  </div>
                ) : null}
              </div>

              {renderPaymentPlan(loan, reload, setError)}
            </article>
          )
        }}
      />

      <FinancePaymentDrawer {...drawerProps} />

      <SimpleModal title="Taksiti düzenle" open={Boolean(editingPlanItem)} onClose={() => setEditingPlanItem(null)}>
        <form onSubmit={handlePlanEditSubmit} className="space-y-4">
          <label className="block text-sm font-semibold text-foreground">
            Vade tarihi
            <input
              required
              type="date"
              value={planDueDate}
              onChange={(event) => setPlanDueDate(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 [color-scheme:light] dark:[color-scheme:dark]"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Tutar
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={planAmount}
              onChange={(event) => setPlanAmount(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-input bg-card/80 px-3 text-sm font-mono tabular-nums text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Not
            <textarea
              rows={3}
              value={planNote}
              onChange={(event) => setPlanNote(event.target.value)}
              className="mt-1 w-full resize-y rounded-xl border border-input bg-card/80 px-3 py-2.5 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
            />
          </label>
          {planError ? (
            <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{planError}</p>
          ) : null}
          <button
            type="submit"
            disabled={planSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {planSaving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </SimpleModal>
      {confirmDialog}
    </>
  )
}
