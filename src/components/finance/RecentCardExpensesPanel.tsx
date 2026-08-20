import { Ban, Layers } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cancelCardExpense, fetchRecentCardExpenses, updateCardExpense } from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card, CardExpense } from '../../types/database'
import { installmentChoicesWith } from '../../utils/cardInstallmentCalendar'
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
  importance: 'Yanlış girilen hareket buradan append-only iptal edilir; taksiti kaçırılmış hareket sonradan taksitlendirilir.',
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
  const [splittingId, setSplittingId] = useState<string | null>(null)
  const [splitCount, setSplitCount] = useState(3)
  const [savingSplitId, setSavingSplitId] = useState<string | null>(null)

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

  /**
   * SMS provizyonu her zaman tek çekim doğar (banka taksiti SMS'te yazmaz) ve
   * 7 günde otomatik kesinleşir. Taksit seçmeyi kaçırdıysan hareket "tek çekim"
   * olarak kalıyordu; taksitli harcama paneli de yalnız installment_count > 1
   * satırları listelediği için düzeltilemiyordu. Bu aksiyon o kapıyı açar:
   * update_card_expense eski etkiyi tersleyip planı yeniden kurar. Ekstreye
   * kesilmiş satır burada da kilitlidir (RPC de reddeder).
   */
  async function handleSplit(expense: CardExpense) {
    setSavingSplitId(expense.id)
    setError('')

    const result = await updateCardExpense({
      expenseId: expense.id,
      amount: expense.amount,
      description: expense.description,
      spentAt: expense.spent_at,
      installmentCount: splitCount,
      category: expense.category,
      note: expense.note,
    })

    setSavingSplitId(null)

    if (!result.ok) {
      setError(result.error.message ?? 'Hareket taksitlendirilemedi.')
      return
    }

    setSplittingId(null)
    await Promise.all([load(), reload()])
  }

  if (loading || expenses.length === 0) return null

  return (
    <SurfaceCard className="border-line-strong">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="inline-flex items-center gap-1.5 text-base">
              Son kart hareketleri
              <HelpTooltip title="Son kart hareketleri" content={recentExpensesHelp} />
            </CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Yanlış girilen hareketi buradan iptal edebilirsin; borç otomatik terslenir.</p>
          </div>
          <Badge variant="secondary">{expenses.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {expenses.map((expense) => {
          const card = cardsById.get(expense.card_id)
          const locked = lockReason(expense)
          const canSplit = card?.card_type === 'kredi_karti' && expense.installment_count === 1 && !locked
          const splitOpen = splittingId === expense.id
          return (
            <div key={expense.id} className="rounded-xl border border-line-strong bg-raised px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{expense.description}</p>
                  <p className="text-xs text-ink-muted">
                    {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)}
                    {expense.installment_count > 1 ? ` · ${expense.installment_count} taksit` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">{formatAmount(expense.amount)}</span>
                {canSplit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSplitCount(3)
                      setSplittingId(splitOpen ? null : expense.id)
                    }}
                    disabled={cancellingId === expense.id || savingSplitId === expense.id}
                    title="Tek çekim görünen hareketi taksitli plana çevir"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Layers size={13} />
                    Taksitlendir
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleCancel(expense)}
                  disabled={Boolean(locked) || cancellingId === expense.id}
                  title={locked ?? 'Hareketi append-only iptal et'}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Ban size={13} />
                  İptal
                </button>
              </div>

              {splitOpen ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line-strong pt-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                    Taksit sayısı
                    <select
                      value={splitCount}
                      onChange={(event) => setSplitCount(Number(event.target.value))}
                      disabled={savingSplitId === expense.id}
                      className="rounded-lg border border-line-strong bg-raised px-2 py-1 text-xs font-semibold tabular-nums text-ink disabled:opacity-60"
                    >
                      {installmentChoicesWith(2)
                        .filter((count) => count > 1)
                        .map((count) => (
                          <option key={count} value={count}>{count} taksit</option>
                        ))}
                    </select>
                  </label>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {splitCount} × {formatAmount(expense.amount / splitCount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSplit(expense)}
                    disabled={savingSplitId === expense.id}
                    className="ml-auto inline-flex items-center rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-success/90 disabled:opacity-60"
                  >
                    {savingSplitId === expense.id ? 'Kaydediliyor...' : 'Planı kur'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplittingId(null)}
                    disabled={savingSplitId === expense.id}
                    className="inline-flex items-center rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04] disabled:opacity-60"
                  >
                    Vazgeç
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </CardContent>
      {confirmDialog}
    </SurfaceCard>
  )
}
