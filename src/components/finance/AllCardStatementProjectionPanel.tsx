import { useMemo } from 'react'
import { useFinanceSnapshot } from '../../app/useFinanceSnapshot'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { dateInputValue } from '../../utils/date'
import { projectAllCardStatements } from '../../utils/statementProjection'
import { buildSubscriptionSummary } from '../../utils/subscriptions'
import { QueryError } from '../ui/query-error'

/** Tüm girdiler aynı snapshot'tan; kapalıyken DeferredDetails tarafından kurulmaz. */
export function AllCardStatementProjectionPanel() {
  const query = useFinanceSnapshot()
  const { formatAmount } = useBalancePrivacy()
  const todayKey = dateInputValue(new Date())
  const view = useMemo(() => {
    const snapshot = query.data
    if (!snapshot) return null
    const today = new Date(`${todayKey}T12:00:00`)
    const subscriptions = buildSubscriptionSummary(snapshot.cardExpenses, snapshot.payments, null, today).items
    return projectAllCardStatements(snapshot.cards, snapshot.cardInstallments, subscriptions, snapshot.payments, today)
  }, [query.data, todayKey])

  if (query.isError) return <QueryError title="Kart tahmini yüklenemedi" message="Toplam henüz doğrulanamadı." onRetry={() => void query.refetch()} retrying={query.isFetching} />
  if (!view || !query.data) return <p role="status" className="py-3 text-sm text-ink-muted">Kart tahmini yükleniyor…</p>
  if (query.data.missingTables.includes('card_installments')) return <QueryError title="Kart tahmini hesaplanamadı" message="Taksit verilerine erişilemedi; eksik toplam gösterilmiyor." onRetry={() => void query.refetch()} retrying={query.isFetching} />

  const excluded = query.data.cards.filter((card) => view.excludedCardIds.includes(card.id))
  const creditCount = query.data.cards.filter((card) => card.card_type === 'kredi_karti').length
  return (
    <section aria-label="Tüm kartların ekstre tahmini" className="pb-4 text-sm">
      <p className="text-xs leading-relaxed text-ink-muted">{creditCount} kredi kartı · ekstre kesim ayına göre bilinen yükler. Son ödeme ayı farklı olabilir.</p>
      {excluded.length > 0 ? <p role="alert" className="mt-3 text-xs leading-relaxed text-warning">Kesim veya ödeme günü eksik: {excluded.map((card) => card.card_name).join(', ')}. Bu kartlar toplama dahil değil; gösterilen tutarlar eksiktir.</p> : null}
      {view.rows.length > 0 ? <dl className="mt-3 divide-y divide-line border-y border-line">
        {view.rows.map((row) => <div key={row.monthKey} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <dt className="font-semibold capitalize">{row.monthLabel}</dt>
          <dd className="min-w-0 sm:text-right">
            <span className="serit-num block break-words text-lg font-semibold">~{formatAmount(row.amount)}</span>
            <span className="mt-1 flex flex-wrap gap-x-1 gap-y-1 text-xs leading-relaxed text-ink-muted sm:justify-end">
              <span className="whitespace-nowrap">Dönem içi {formatAmount(row.currentPeriod)}</span>
              <span className="whitespace-nowrap">+ taksit {formatAmount(row.installmentTotal)}</span>
              <span className="whitespace-nowrap">+ abonelik/talimat {formatAmount(row.recurringTotal)}</span>
            </span>
          </dd>
        </div>)}
      </dl> : <p className="mt-3 text-ink-muted">{creditCount === 0 ? 'Kayıtlı kredi kartı yok.' : 'Kartların kesim ve ödeme günleri tamamlanınca tahmin gösterilir.'}</p>}
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">Kesilmiş ekstre borçları, serbest harcama, bekleyen provizyon ve faiz bu toplama dahil değil. Yeni harcamalarla gerçek ekstreler daha yüksek çıkabilir.</p>
    </section>
  )
}
