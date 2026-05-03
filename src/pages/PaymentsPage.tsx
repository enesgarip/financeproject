import { CrudPage, type FormField } from '../components/CrudPage'
import type { Payment } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

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

export function PaymentsPage() {
  return (
    <CrudPage
      table="payments"
      addLabel="Ödeme ekle"
      fields={fields}
      emptyTitle="Henüz ödeme yok"
      emptyDescription="Yaklaşan kira, fatura veya tek seferlik ödemelerini buradan ekleyebilirsin."
      orderBy="due_date"
      getInitialValues={(row?: Payment) => ({
        title: row?.title ?? '',
        amount: row?.amount ?? 0,
        due_date: row?.due_date ?? new Date().toISOString().slice(0, 10),
        status: row?.status ?? 'bekliyor',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        title: String(formData.get('title') ?? ''),
        amount: parseNumber(formData.get('amount')),
        due_date: String(formData.get('due_date') ?? ''),
        status: formData.get('status') as Payment['status'],
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.title}
      renderSubtitle={(row) => row.status}
      renderDetails={(row) => [`Tutar: ${formatCurrency(row.amount)}`, `Son tarih: ${formatDate(row.due_date)}`]}
    />
  )
}
