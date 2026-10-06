import { ArrowRight, Gauge } from 'lucide-react'
import { Link } from 'react-router'
import { useCrudRows } from '../../app/useCrudRows'
import { buildCreditScoreSummary, creditScoreCheckStatus } from '../../utils/creditScore'
import { formatDate } from '../../utils/date'

export function CreditScoreReminder({ today }: { today: string }) {
  const query = useCrudRows('credit_score_history', 'checked_on', false)
  const { current } = buildCreditScoreSummary(query.data ?? [])
  const status = creditScoreCheckStatus(current, today)

  if (query.isPending) {
    return <div className="h-[72px] animate-pulse rounded-xl bg-raised" role="status" aria-label="Kredi notu yükleniyor" />
  }

  const destination = status.due ? '/analiz/detay?new=1' : '/analiz/detay'
  const description = query.isError
    ? 'Kredi notu kayıtları şu an yüklenemedi.'
    : !current
      ? 'Henüz kayıt yok · ilk Findeks sonucunu ekle'
      : status.due
        ? `Son sorgu ${status.daysSinceCheck} gün önce · aylık kontrol zamanı`
        : `${formatDate(current.checked_on)} tarihinde sorgulandı · ${status.daysSinceCheck} gün önce`

  return (
    <Link
      to={destination}
      className={`group flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${status.due ? 'border-warning/30 bg-warning/8 hover:bg-warning/12' : 'border-line-strong bg-raised hover:border-primary/30 hover:bg-primary/5'}`}
      aria-label={`${current ? `Kredi notu ${current.score} puan.` : 'Kredi notu kaydı yok.'} ${description}`}
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${status.due ? 'bg-warning/12 text-warning' : 'bg-primary/10 text-primary'}`} aria-hidden="true">
        <Gauge size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wide text-ink-muted">Kredi notum</span>
        <span className="mt-0.5 block text-sm text-ink-muted">
          {current ? <strong className="mr-1 text-base font-black text-ink">{current.score} puan</strong> : null}
          {description}
        </span>
      </span>
      <span className={`shrink-0 text-xs font-black ${status.due ? 'text-warning' : 'text-primary'}`}>
        {status.due ? 'Güncelle' : 'Geçmiş'}
      </span>
      <ArrowRight size={16} className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${status.due ? 'text-warning' : 'text-primary'}`} aria-hidden="true" />
    </Link>
  )
}
