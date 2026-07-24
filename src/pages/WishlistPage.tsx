import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Plus, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { useToast } from '../components/ui/toast'
import {
  deleteWishlistItem,
  fetchWishlistItems,
  insertWishlistItem,
  updateWishlistItem,
} from '../data/repositories/wishlistRepo'
import { formatCurrency } from '../utils/formatCurrency'
import type { WishlistItem } from '../types/database'

const QUERY_KEY = ['wishlist-items'] as const

export function WishlistPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { confirm, confirmDialog } = useConfirmDialog()

  const { data: items = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await fetchWishlistItems()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })

  const pending = useMemo(() => items.filter((i) => !i.is_purchased), [items])
  const purchased = useMemo(() => items.filter((i) => i.is_purchased), [items])

  const [showPurchased, setShowPurchased] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: QUERY_KEY }), [qc])

  const addMutation = useMutation({
    mutationFn: async ({ name, price }: { name: string; price: string }) => {
      const parsed = price ? Number(price.replace(',', '.')) : null
      const estimatedPrice = parsed && Number.isFinite(parsed) ? parsed : null
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
          <div key={i} className="h-14 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Yeni madde ekleme */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            ref={nameInputRef}
            type="text"
            placeholder="Ne almak istiyorsun?"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex w-28 flex-col gap-1 sm:w-32">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Fiyat (opsiyonel)"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!newName.trim() || addMutation.isPending}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          <Plus size={18} />
        </button>
      </form>

      {/* Alınacaklar */}
      {pending.length === 0 && purchased.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Henüz bir madde eklenmedi.
        </p>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {pending.map((item) => (
            <WishlistRow
              key={item.id}
              item={item}
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
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground"
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
  onToggle,
  onDelete,
  purchased,
}: {
  item: WishlistItem
  onToggle: () => void
  onDelete: () => void
  purchased?: boolean
}) {
  const purchasedDate = item.purchased_at ? new Date(item.purchased_at).toLocaleDateString('tr-TR') : null

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 transition hover:border-border">
      <button
        type="button"
        onClick={onToggle}
        className={`grid size-7 shrink-0 place-items-center rounded-lg border transition ${
          purchased
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-background text-transparent hover:border-primary/60 hover:text-primary/40'
        }`}
        aria-label={purchased ? 'Alınmadı olarak işaretle' : 'Alındı olarak işaretle'}
      >
        {purchased ? <Check size={14} strokeWidth={3} /> : <Check size={14} strokeWidth={2} />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm font-medium ${purchased ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {item.name}
        </span>
        {(item.estimated_price || purchasedDate) && (
          <span className="truncate text-xs text-muted-foreground">
            {item.estimated_price ? formatCurrency(item.estimated_price) : ''}
            {item.estimated_price && purchasedDate ? ' · ' : ''}
            {purchasedDate ? purchasedDate : ''}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        {purchased && (
          <button
            type="button"
            onClick={onToggle}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Geri al"
          >
            <Undo2 size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          aria-label="Sil"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )
}
