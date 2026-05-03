import { CrudPage, type FormField } from '../components/CrudPage'
import { supabase } from '../lib/supabase'
import type { Loan } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'loan_name', label: 'Kredi adı', type: 'text', required: true },
  { name: 'total_amount', label: 'Toplam tutar', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'remaining_amount', label: 'Kalan tutar', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'monthly_payment', label: 'Aylık ödeme', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'installment_day', label: 'Taksit günü', type: 'number', min: '1', step: '1' },
  { name: 'start_date', label: 'Başlangıç tarihi', type: 'date' },
  { name: 'end_date', label: 'Bitiş tarihi', type: 'date' },
  { name: 'remaining_installments', label: 'Kalan taksit', type: 'number', min: '0', step: '1', required: true },
  {
    name: 'status',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Aktif', value: 'active' },
      { label: 'Kapalı', value: 'closed' },
    ],
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

async function payInstallment(loan: Loan, reload: () => Promise<void>, setError: (message: string) => void) {
  const confirmed = window.confirm(`${loan.loan_name} için ${formatCurrency(loan.monthly_payment)} tutarında taksit ödensin mi?`)
  if (!confirmed) return

  const remainingInstallments = Math.max(0, loan.remaining_installments - 1)
  const remainingAmount = Math.max(0, loan.remaining_amount - loan.monthly_payment)
  const status = remainingInstallments === 0 || remainingAmount === 0 ? 'closed' : 'active'

  const { error } = await supabase
    .from('loans')
    .update({
      remaining_installments: remainingInstallments,
      remaining_amount: remainingAmount,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', loan.id)

  if (error) {
    setError(error.message)
    return
  }

  await reload()
}

export function LoansPage() {
  return (
    <CrudPage
      table="loans"
      addLabel="Kredi ekle"
      fields={fields}
      emptyTitle="Henüz kredi yok"
      emptyDescription="Aktif veya kapanmış kredilerini, taksit günleriyle birlikte ekleyebilirsin."
      getInitialValues={(row?: Loan) => ({
        bank_name: row?.bank_name ?? '',
        loan_name: row?.loan_name ?? '',
        total_amount: row?.total_amount ?? 0,
        remaining_amount: row?.remaining_amount ?? 0,
        monthly_payment: row?.monthly_payment ?? 0,
        installment_day: row?.installment_day ?? '',
        start_date: row?.start_date ?? '',
        end_date: row?.end_date ?? '',
        remaining_installments: row?.remaining_installments ?? 0,
        status: row?.status ?? 'active',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        bank_name: String(formData.get('bank_name') ?? ''),
        loan_name: String(formData.get('loan_name') ?? ''),
        total_amount: parseNumber(formData.get('total_amount')),
        remaining_amount: parseNumber(formData.get('remaining_amount')),
        monthly_payment: parseNumber(formData.get('monthly_payment')),
        installment_day: optionalDay(formData.get('installment_day')),
        start_date: optionalDate(formData.get('start_date')),
        end_date: optionalDate(formData.get('end_date')),
        remaining_installments: Math.trunc(parseNumber(formData.get('remaining_installments'))),
        status: formData.get('status') as Loan['status'],
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.loan_name}
      renderSubtitle={(row) => `${row.bank_name} · ${row.status === 'active' ? 'Aktif' : 'Kapalı'}`}
      renderDetails={(row) => [
        `Kalan: ${formatCurrency(row.remaining_amount)}`,
        `Aylık: ${formatCurrency(row.monthly_payment)}`,
        `Taksit günü: ${row.installment_day ?? '-'}`,
        `Kalan taksit: ${row.remaining_installments}`,
        `Bitiş: ${formatDate(row.end_date)}`,
      ]}
      renderRowActions={(row, helpers) =>
        row.status === 'active' && row.remaining_installments > 0 ? (
          <button
            type="button"
            onClick={() => void payInstallment(row, helpers.reload, helpers.setError)}
            className="rounded-lg border border-emerald-200 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white shadow-sm dark:border-emerald-800"
          >
            Taksit öde
          </button>
        ) : null
      }
    />
  )
}
