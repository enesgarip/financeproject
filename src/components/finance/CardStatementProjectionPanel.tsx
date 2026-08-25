/**
 * "Önümüzdeki 3 ekstre" — kart detay genişlemesinin OPT-IN projeksiyon bloğu.
 *
 * E3'ün "kesime ≤5 gün, uzak tahmin gürültü" pencere disipliniyle bilinçli
 * gerilim var; bu yüzden satır rozeti değil, kullanıcının kendi açtığı detay
 * panelinde yaşar ve '~' + "bilinen yükler" diliyle konuşur. Abonelik girdisi
 * snapshot'tan (tek RPC, TanStack cache) yalnız panel mount olunca hesaplanır.
 */
import { useMemo } from 'react'
import { useFinanceSnapshot } from '../../app/useFinanceSnapshot'
import type { Card, CardInstallment } from '../../types/database'
import { dateInputValue } from '../../utils/date'
import { discretionaryMonthlyBase, projectUpcomingStatements } from '../../utils/statementProjection'
import { buildSubscriptionSummary } from '../../utils/subscriptions'

export function CardStatementProjectionPanel({
  card,
  installments,
  formatAmount,
}: {
  card: Card
  installments: CardInstallment[]
  formatAmount: (value: number | null | undefined) => string
}) {
  const snapshotQuery = useFinanceSnapshot()
  // Gün anahtarı: memo gün dönüşünde tazelenir, tarih memo içinde o güne sabit.
  const todayKey = dateInputValue(new Date())
  const view = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot || card.card_type !== 'kredi_karti') return null
    const today = new Date(`${todayKey}T12:00:00`)
    const subscriptions = buildSubscriptionSummary(snapshot.cardExpenses, snapshot.payments, null, today).items
    const rows = projectUpcomingStatements(card, installments, subscriptions, snapshot.payments, today)
    if (rows.length === 0) return null
    const recurringMonthly = rows.find((row) => row.recurringTotal > 0)?.recurringTotal ?? 0
    return {
      rows,
      discretionary: discretionaryMonthlyBase(card.id, snapshot.cardExpenses, recurringMonthly, today),
    }
  }, [snapshotQuery.data, card, installments, todayKey])

  if (!view) return null

  return (
    <div className="mt-4 rounded-lg bg-raised p-3 ring-1 ring-line-strong">
      <p className="text-xs font-black uppercase text-ink-muted">Önümüzdeki 3 ekstre · bilinen yükler</p>
      <div className="mt-3 flex flex-col gap-2">
        {view.rows.map((row) => (
          <div
            key={row.statementDate}
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-page px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate font-bold text-ink">{row.monthLabel}</span>
            <span className="shrink-0 text-right">
              <span className="font-black tabular-nums text-ink">~{formatAmount(row.amount)}</span>
              <span className="block text-[10px] text-ink-muted">
                {[
                  row.currentPeriod > 0 ? `dönem içi ${formatAmount(row.currentPeriod)}` : null,
                  row.installmentTotal > 0 ? `taksit ${formatAmount(row.installmentTotal)}` : null,
                  row.recurringTotal > 0 ? `abonelik/talimat ${formatAmount(row.recurringTotal)}` : null,
                ]
                  .filter(Boolean)
                  .join(' + ') || 'bilinen yük yok'}
              </span>
            </span>
          </div>
        ))}
      </div>
      {/* Tempo tabanı bilinçli TOPLAM DIŞI: toplam "bilinen yükler" olarak
          savunulabilir kalır, serbest harcama yalnız bağlam verir. */}
      {view.discretionary != null && view.discretionary > 0 ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          + serbest harcama ~{formatAmount(view.discretionary)}/ay (son 90 gün ortalaması — toplama dahil değil).
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-ink-faint">
        Yalnız bilinen yükler: yeni abonelik, bekleyen provizyon ve faiz bilinemez — gerçek ekstre yüksek çıkabilir.
      </p>
    </div>
  )
}
