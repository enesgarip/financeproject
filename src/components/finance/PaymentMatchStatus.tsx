import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { formatDate } from '../../utils/date'
import type { PaymentMonthMatch } from '../../utils/paymentHistory'
import { Badge } from '../ui/badge'

const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

export function PaymentMatchStatus({ month, match, loading = false, error = false, historyAvailable = true }: {
  month: Date
  match?: PaymentMonthMatch
  loading?: boolean
  error?: boolean
  historyAvailable?: boolean
}) {
  const { formatAmount } = useBalancePrivacy()
  const label = MONTH_LABEL.format(month)
  if (error) return <p className="mt-2 text-xs text-warning">{label} · Eşleşme durumu doğrulanamadı.</p>
  if (loading) return <p className="mt-2 text-xs text-ink-muted">{label} · Eşleşme kontrol ediliyor…</p>
  if (!historyAvailable && !match) return <p className="mt-2 text-xs text-ink-muted">{label} · Bu ayın eşleşme geçmişi tam yüklü değil.</p>
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge variant={match?.state === 'matched' ? 'success' : match ? 'warning' : 'outline'}>
        {label} · {match?.state === 'matched' ? 'Eşleşti' : match ? 'Eşleşme geri alınmış' : 'Henüz eşleşme yok'}
      </Badge>
      {match?.state === 'matched' ? <span className="text-ink-muted">
        Banka işlemi: {formatDate(match.occurredOn)}{match.amount != null ? ` · ${formatAmount(match.amount)}` : ''}
      </span> : null}
    </div>
  )
}
