import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Plus, ShoppingCart, Trash2, Undo2 } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { useToast } from '../components/ui/toast'
import { HeroNumber } from '../components/serit'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import {
  deleteWishlistItem,
  insertWishlistItem,
  updateWishlistItem,
} from '../data/repositories/wishlistRepo'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { readSafeToSpendBuffer, useKasaReserved } from '../hooks/useSafeToSpend'
import { useWishlistItems, WISHLIST_QUERY_KEY } from '../hooks/useWishlistItems'
import { buildCashFlowForecast } from '../utils/cashFlowForecast'
import { buildFinancialPosition, buildMonthlyCashFlow } from '../utils/financeSummary'
import { resolveSavingsGoalRows } from '../utils/goalSources'
import { buildSafeToSpend } from '../utils/safeToSpend'
import { buildWishlistAge } from '../utils/wishlistAge'
import { buildWishlistPlan, type WishlistPlan } from '../utils/wishlistPlan'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { sumTL } from '../utils/money'
import type { WishlistItem } from '../types/database'

/** "Ne zaman alabilirim" projeksiyon ufku; PurchaseDecisionPage ile aynı mantık. */
const PLAN_HORIZON_MONTHS = 6

export function WishlistPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { confirm, confirmDialog } = useConfirmDialog()

  // Sorgu + anahtar paylaşılan hook'ta (hooks/useWishlistItems): karar ekranının
  // köprüsü aynı anahtarı invalidate eder, sayfa-lokal kopya bayatlamaz.
  const { data: items = [], isLoading } = useWishlistItems()

  const pending = useMemo(() => items.filter((i) => !i.is_purchased), [items])
  const purchased = useMemo(() => items.filter((i) => i.is_purchased), [items])
  // Tahmini fiyatı girilmemiş madde 0 sayılır; toplam "en az bu kadar" okunur.
  const pendingTotal = useMemo(() => sumTL(pending.map((i) => i.estimated_price ?? 0)), [pending])
  // Bekleme kuralı: 30 günü geçen bekleyenler hero özetinde görünür.
  const staleCount = pending.filter((i) => buildWishlistAge(i).isStale).length

  /**
   * "Ne zaman alabilirim" için gereken nakit projeksiyonu + hedef planı.
   *
   * Hepsi hazır cache'ten okunur: snapshot (TanStack, diğer sayfalarla ortak),
   * kasa rezervi ve cihazdaki güvenlik tamponu. Liste kendi başına hiçbir
   * finansal hesap TUTMAZ — cevap `utils/wishlistPlan.ts`'te üretilir.
   */
  const snapshotQuery = useFinanceSnapshot()
  const { reserved } = useKasaReserved()

  const planContext = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot) return null

    const summaryInput = {
      assets: snapshot.assets,
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: snapshot.loanInstallments,
      debts: snapshot.debts,
      payments: snapshot.payments,
      salaryHistory: snapshot.salaryHistory,
      cardInstallments: snapshot.cardInstallments,
      cardStatements: snapshot.cardStatements,
      cardStatementPayments: snapshot.cardStatementPayments,
    }

    const buffer = readSafeToSpendBuffer()
    const cashFlow = buildMonthlyCashFlow(summaryInput)
    const safe = buildSafeToSpend({
      liquidCash: buildFinancialPosition(summaryInput).totalCashAssets,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer,
      reserved,
    })

    return {
      forecast: buildCashFlowForecast(summaryInput, { horizonMonths: PLAN_HORIZON_MONTHS }),
      safeToSpend: safe.amount,
      // Ay sonunda dokunulmayacak taban; projeksiyon bakiyesi bunları içerir.
      floor: buffer + reserved,
      // Kaynağa bağlı hedefin birikeni DB'de değil burada oluşur (goalSources.ts).
      goals: resolveSavingsGoalRows(
        snapshot.savingsGoals,
        snapshot.savingsGoalComponents,
        snapshot.savingsGoalSources,
        { assets: snapshot.assets, cards: snapshot.cards },
      ).goals,
    }
  }, [snapshotQuery.data, reserved])

  const [showPurchased, setShowPurchased] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: WISHLIST_QUERY_KEY }), [qc])

  const addMutation = useMutation({
    mutationFn: async ({ name, price }: { name: string; price: string }) => {
      // `parseNumber` çift-locale çözer: "12.500" (binlik nokta) ve "12,5" (ondalık
      // virgül) ikisi de doğru okunur. Elle `replace(',', '.')` "12.500"ü NaN
      // yapıyordu → madde fiyatsız kaydediliyordu (denetim 2026-08-12 §6).
      const parsed = price.trim() ? parseNumber(price) : 0
      const estimatedPrice = parsed > 0 ? parsed : null
      const result = await insertWishlistItem({
        user_id: user!.id,
        name,
        estimated_price: estimatedPrice,
        is_purchased: false,
        sort_order: 0,
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => {
      invalidate()
      setNewName('')
      setNewPrice('')
      nameInputRef.current?.focus()
    },
    onError: (e: Error) => toast({ title: e.message, type: 'error' }),
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, purchased }: { id: string; purchased: boolean }) => {
      const result = await updateWishlistItem(id, {
        is_purchased: purchased,
        purchased_at: purchased ? new Date().toISOString() : null,
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: e.message, type: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteWishlistItem(id)
      if (!result.ok) throw new Error(result.error.message)
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: e.message, type: 'error' }),
  })

  async function handleDelete(item: WishlistItem) {
    const yes = await confirm({
      title: 'Maddeyi sil',
      description: `"${item.name}" kalıcı olarak silinecek.`,
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (yes) deleteMutation.mutate(item.id)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    addMutation.mutate({ name, price: newPrice })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-1">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl border border-line-strong bg-page" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Şerit: kahraman = bekleyen isteklerin tahmini toplamı. */}
      <HeroNumber
        label="Bekleyen istekler"
        value={pendingTotal}
        description={`${pending.length} bekleyen · ${purchased.length} tamamlanan · tahmini fiyatlarla${
          staleCount > 0 ? ` · ${staleCount} madde 30 günü geçti` : ''
        }`}
      />

      {/* Yeni madde ekleme */}
      <Card className="border-primary/15">
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
            <Input
              ref={nameInputRef}
              type="text"
              placeholder="Ne almak istiyorsun?"
              aria-label="Alışveriş listesi maddesi"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-11"
            />
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Tahmini fiyat"
              aria-label="Tahmini fiyat"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="h-11"
            />
            <Button
              type="submit"
              size="lg"
              disabled={!newName.trim() || addMutation.isPending}
              aria-label="Listeye ekle"
              className="w-full sm:w-auto"
            >
              <Plus />
              <span className="sm:hidden">Listeye ekle</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Alınacaklar */}
      {pending.length === 0 && purchased.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-muted">
          Henüz bir madde eklenmedi.
        </p>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {pending.map((item) => (
            <WishlistRow
              key={item.id}
              item={item}
              plan={
                planContext
                  ? buildWishlistPlan({ price: item.estimated_price, ...planContext })
                  : null
              }
              onToggle={() => toggleMutation.mutate({ id: item.id, purchased: true })}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </ul>
      )}

      {/* Alınanlar */}
      {purchased.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPurchased((v) => !v)}
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted transition hover:text-ink"
          >
            {showPurchased ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Alınanlar ({purchased.length})
          </button>
          {showPurchased && (
            <ul className="flex flex-col gap-1.5">
              {purchased.map((item) => (
                <WishlistRow
                  key={item.id}
                  item={item}
                  onToggle={() => toggleMutation.mutate({ id: item.id, purchased: false })}
                  onDelete={() => handleDelete(item)}
                  purchased
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmDialog}
    </div>
  )
}

function WishlistRow({
  item,
  plan,
  onToggle,
  onDelete,
  purchased,
}: {
  item: WishlistItem
  /** Projeksiyondan türeyen "ne zaman + neyin payı"; veri hazır değilse null. */
  plan?: WishlistPlan | null
  onToggle: () => void
  onDelete: () => void
  purchased?: boolean
}) {
  const purchasedDate = item.purchased_at ? new Date(item.purchased_at).toLocaleDateString('tr-TR') : null
  // Bekleme kuralı rozetleri (utils/wishlistAge): tamamı mevcut kolonlardan.
  const age = buildWishlistAge(item)

  return (
    <li className="finance-list-row group flex items-center gap-3 rounded-xl border border-line-strong bg-raised px-3 py-3 transition">
      <button
        type="button"
        onClick={onToggle}
        className={`tap-target grid size-7 shrink-0 place-items-center rounded-lg border transition ${
          purchased
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-line-strong bg-page text-transparent hover:border-primary/60 hover:text-primary/40'
        }`}
        aria-label={purchased ? 'Alınmadı olarak işaretle' : 'Alındı olarak işaretle'}
      >
        {purchased ? <Check size={14} strokeWidth={3} /> : <Check size={14} strokeWidth={2} />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm font-medium ${purchased ? 'text-ink-muted line-through' : 'text-ink'}`}>
          {item.name}
        </span>
        {(item.estimated_price || purchasedDate) && (
          <span className="truncate text-xs text-ink-muted">
            {item.estimated_price ? formatCurrency(item.estimated_price) : ''}
            {item.estimated_price && purchasedDate ? ' · ' : ''}
            {purchasedDate ? purchasedDate : ''}
            {purchased && age.decisionDays !== null
              ? ` · ${age.decisionDays === 0 ? 'aynı gün alındı' : `${age.decisionDays} gün düşündün`}`
              : ''}
          </span>
        )}
        {/* Bekleme kuralı: pasif rozet + nötr dil (aksiyon dürtmesi bilinçli yok). */}
        {!purchased ? (
          <span className={`text-[11px] leading-tight ${age.isStale ? 'text-warning' : 'text-ink-faint'}`}>
            {age.ageDays === 0 ? 'Bugün eklendi' : `${age.ageDays} gündür listede`}
            {age.isStale ? ' · 30 günü geçti — hâlâ istiyor musun?' : ''}
          </span>
        ) : null}
        {/* Alınmamış maddede "ne zaman + neyin payı": ikisi de projeksiyondan
            türer, listede saklanmaz. Ufukta karşılanmıyorsa tarih UYDURMAYIZ. */}
        {/* truncate DEĞİL: dar ekranda "…" ile kesilince cümlenin asıl bilgisi
            (hangi hedefin kaç aylık payı) kayboluyordu. */}
        {!purchased && plan ? (
          <span className="text-[11px] leading-tight text-ink-faint">
            {plan.affordableNow
              ? 'Şimdi alabilirsin'
              : plan.month
                ? `~${plan.month.label} içinde alabilirsin`
                : 'Bu projeksiyonda karşılanmıyor'}
            {plan.goalMonths > 0 && plan.goalName
              ? ` · ${plan.goalName} hedefine ayıracağın ~${plan.goalMonths} aylık pay`
              : ''}
          </span>
        ) : null}
      </div>

      <div className="hover-actions flex shrink-0 items-center gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        {/* Karar–Liste köprüsünün ters yönü: fiyatlı bekleyen madde karar
            ekranına tutarıyla taşınır (?tutar= tek seferlik form doldurur). */}
        {!purchased && item.estimated_price ? (
          <Link
            to={`/odemeler/alsam-mi?tutar=${item.estimated_price}`}
            className="tap-target grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-black/[.03] dark:hover:bg-white/[.04] hover:text-ink"
            aria-label={`"${item.name}" için Alsam mı ekranında değerlendir`}
            title="Alsam mı?"
          >
            <ShoppingCart size={14} />
          </Link>
        ) : null}
        {purchased && (
          <button
            type="button"
            onClick={onToggle}
            className="tap-target grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-black/[.03] dark:hover:bg-white/[.04] hover:text-ink"
            aria-label="Geri al"
          >
            <Undo2 size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="tap-target grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-destructive/10 hover:text-destructive"
          aria-label="Sil"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}
