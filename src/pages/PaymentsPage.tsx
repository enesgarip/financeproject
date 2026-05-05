import { CrudPage, type FormField } from '../components/CrudPage'
import { supabase } from '../lib/supabase'
import type { Payment } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'

const fields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  { name: 'amount', label: 'Tutar', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'due_date', label: 'Son tarih', type: 'date', required: true },
  {
    name: 'status',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Bekliyor', value: 'bekliyor' },
      { label: 'Ödendi', value: 'ödendi' },
    ],
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function validatePaymentForm(formData: FormData) {
  const errors: Record<string, string> = {}
  if (parseNumber(formData.get('amount')) <= 0) errors.amount = 'Tutar 0’dan büyük olmalı.'
  return errors
}

async function markPaymentAsPaid(payment: Payment, reload: () => Promise<void>, setError: (message: string) => void) {
  const { error } = await supabase
    .from('payments')
    .update({ status: 'ödendi', updated_at: new Date().toISOString() })
    .eq('id', payment.id)

  if (error) {
    setError(error.message)
    return
  }

  const historyError = await addTransactionHistory({
    user_id: payment.user_id,
    type: 'payment',
    title: `${payment.title} ödendi`,
    amount: payment.amount,
    source_table: 'payments',
    source_id: payment.id,
    note: formatDate(payment.due_date),
  })
  if (historyError) {
    setError(historyError.message)
    return
  }

  await reload()
}

export function PaymentsPage() {
  return (
    <CrudPage
      table="payments"
      pageTitle="Ödemeler"
      addLabel="Ödeme ekle"
      fields={fields}
      emptyTitle="Henüz ödeme yok"
      emptyDescription="Yaklaşan kira, fatura veya tek seferlik ödemelerini buradan ekleyebilirsin."
      orderBy="due_date"
      validateForm={validatePaymentForm}
      getInitialValues={(row?: Payment) => ({
        title: row?.title ?? '',
        amount: row?.amount ?? 0,
        due_date: row?.due_date ?? new Date().toISOString().slice(0, 10),
        status: row?.status ?? 'bekliyor',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        title: String(formData.get('title') ?? '').trim(),
        amount: parseNumber(formData.get('amount')),
        due_date: String(formData.get('due_date') ?? ''),
        status: formData.get('status') as Payment['status'],
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.title}
      renderSubtitle={(row) => row.status}
      renderDetails={(row) => [`Tutar: ${formatCurrency(row.amount)}`, `Son tarih: ${formatDate(row.due_date)}`]}
      renderRowActions={(row, helpers) =>
        row.status === 'bekliyor' ? (
          <button
            type="button"
            onClick={() => void markPaymentAsPaid(row, helpers.reload, helpers.setError)}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            Ödendi işaretle
          </button>
        ) : null
      }
    />
  )
}
