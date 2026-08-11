import { Ban } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cancelCardExpense, fetchRecentCardExpenses } from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card, CardExpense } from '../../types/database'
import { formatDate } from '../../utils/date'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { useConfirmDialog } from '../ui/use-confirm-dialog'

/**
 * BM-6: "Dün yanlış girdim, sileyim" senaryosunun doğrudan karşılığı. İptal
 * daha önce yalnız import/Veri Sağlığı ekranlarından dolaylı bulunuyordu; bu
 * panel son kesinleşmiş kart hareketlerini listeler ve append-only iptali
 * (cancel_card_expense) tek yerden sunar. Ekstreye kesilmiş / erken ödemeyle
 * kapatılmış satırlar tarihsel kanıttır — buton kapalı kalır (RPC de reddeder).
 * İptal edilen bir import/SMS satırı gerekirse aynı kaynaktan yeniden içe
 * aktarılarak geri getirilebilir (iptal, kaynak-olay kimliğini rezerve etmez).
 */

const recentExpensesHelp = {
  calculation: 'Son 20 kesinleşmiş kart hareketi (peşin ve taksit parent kayıtları).',
  importance: 'Yanlış girilen hareket buradan append-only iptal edilir; borç ve kovalar otomatik terslenir.',
  source: 'Kart harcamaları. Ekstreye kesilmiş veya erken ödemeyle kapatılmış satırlar değiştirilemez.',
} satisfies HelpTooltipContent

type RecentCardExpensesPanelProps = {
  cards: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}

function lockReason(expense: CardExpense) {
  if (expense.statement_archive_id) return 'Ekstreye kesilmiş hareket iptal edilemez; düzeltme/uzlaştırma akışını kullan.'
  if (expense.current_settlement_id) return 'Erken ödemeyle kapatılmış hareket tarihsel kanıttır; iptal edilemez.'
  return null
}

export function RecentCardExpensesPanel({ cards, reload, setError }: RecentCardExpensesPanelProps) {
  const { formatAmount } = useBalancePrivacy()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [expenses, setExpenses] = useState<CardExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  const load = useCallback(async () => {
    const result = await fetchRecentCardExpenses(20)
    if (!result.ok) {
      setExpenses([])
      setError(result.error.message ?? 'Son hareketler yüklenemedi.')
      setLoading(false)
      return
    }
    setExpenses(result.data)
    setLoading(false)
  }, [setError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function handleCancel(expense: CardExpense) {
    // BM-6(d): planlı ödemeden doğan kayıtta iptal, ödemeyi geri AÇMAZ —
    // kullanıcı bunu bilerek onaylamalı (denetim İptal-B4).
    const paymentLinked = expense.source === 'payment_auto'
      || (expense.note ?? '').startsWith('Odeme kaydindan import ile olusturuldu.')

    const confirmed = await confirm({
      title: 'Hareketi iptal et',
      description: paymentLinked
        ? 'Bu kayıt bir planlı ödemeden oluşturuldu. İptal yalnız kart tarafını tersler; planlı ödeme "ödendi" olarak KALIR — gerekirse Ödemeler sayfasından kontrol et.'
        : 'Hareket append-only iptal edilir: borç ve kovalar terslenir, kayıt geçmişte "iptal" olarak kalır. Import/SMS kaydıysa aynı kaynaktan yeniden içe aktarılarak geri getirilebilir.',
      confirmLabel: 'İptal et',
      variant: 'destructive',
    })
    if (!confirmed) return

    setCancellingId(expense.id)
    setError('')
    const result = await cancelCardExpense(expense.id)
    setCancellingId(null)

    if (!result.ok) {
      setError(result.error.message ?? 'Hareket iptal edilemedi.')
      return
    }

    await Promise.all([load(), reload()])
  }

  if (loading || expenses.length === 0) return null

  return (
    <SurfaceCard className="border-border/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="inline-flex items-center gap-1.5 text-base">
              Son kart hareketleri
              <HelpTooltip title="Son kart hareketleri" content={recentExpensesHelp} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Yanlış girilen hareketi buradan iptal edebilirsin; borç otomatik terslenir.</p>
          </div>
          <Badge variant="secondary">{expenses.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {expenses.map((expense) => {
          const card = cardsById.get(expense.card_id)
          const locked = lockReason(expense)
          return (
            <div key={expense.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{expense.description}</p>
                <p className="text-xs text-muted-foreground">
                  {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)}
                  {expense.installment_count > 1 ? ` · ${expense.installment_count} taksit` : ''}
                </p>
              </div>
              <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">{formatAmount(expense.amount)}</span>
              <button
                type="button"
                onClick={() => void handleCancel(expense)}
                disabled={Boolean(locked) || cancellingId === expense.id}
                title={locked ?? 'Hareketi append-only iptal et'}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Ban size={13} />
                İptal
              </button>
            </div>
          )
        })}
      </CardContent>
      {confirmDialog}
    </SurfaceCard>
  )
}
