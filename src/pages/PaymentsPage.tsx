import { CrudPage, type FormField } from '../components/CrudPage'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type { Payment } from '../types/database'
import { daysUntil, formatDate } from '../utils/date'
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

function PaymentsOverview({ rows }: { rows: Payment[] }) {
  const pending = rows.filter((row) => row.status === 'bekliyor')
  if (rows.length === 0) return null

  const pendingTotal = pending.reduce((sum, row) => sum + row.amount, 0)
  const paidCount = rows.filter((row) => row.status === 'ödendi').length
  const paidRate = rows.length > 0 ? Math.min(100, (paidCount / rows.length) * 100) : 0
  const overdueCount = pending.filter((row) => {
    const remaining = daysUntil(row.due_date)
    return remaining !== null && remaining < 0
  }).length
  const nextPayment = pending
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-muted-foreground">Ödeme akışı</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{formatCurrency(pendingTotal)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{pending.length} bekleyen ödeme</p>
          </div>
          <Badge variant={overdueCount > 0 ? 'destructive' : 'secondary'}>
            {overdueCount > 0 ? `${overdueCount} geciken` : `${paidCount}/${rows.length} ödendi`}
          </Badge>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>Tamamlanma</span>
            <span>%{Math.round(paidRate)}</span>
          </div>
          <Progress value={paidRate} className="h-1.5" />
        </div>
        {nextPayment ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted/55 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{nextPayment.title}</p>
              <p className="text-xs text-muted-foreground">Son tarih {formatDate(nextPayment.due_date)}</p>
            </div>
            <span className="shrink-0 font-bold tabular-nums text-foreground">{formatCurrency(nextPayment.amount)}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
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
      renderBeforeList={({ loading, rows }) => (!loading ? <PaymentsOverview rows={rows as Payment[]} /> : null)}
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
