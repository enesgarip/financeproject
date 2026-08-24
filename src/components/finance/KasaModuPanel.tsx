import { useQueryClient } from '@tanstack/react-query'
import { Boxes, Plus, Pencil, Trash2, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import {
  deleteKasaBucket,
  fetchKasaBuckets,
  insertKasaBucket,
  updateKasaBucket,
} from '../../data/repositories/kasaBucketsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { KASA_BUCKETS_QUERY_KEY } from '../../hooks/useSafeToSpend'
import type { KasaBucket } from '../../types/database'
import { parseNumber } from '../../utils/formatCurrency'
import { spendableAfterReserves, totalReservedTL } from '../../utils/kasaMode'
import { SimpleModal } from '../SimpleModal'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { MiniStat } from './FinanceUI'
import { MoneyInput } from './MoneyInput'
import { Input, Textarea } from '../ui/input'
import { useConfirmDialog } from '../ui/use-confirm-dialog'

/**
 * Kasa modu: banka bakiyesini kovalara ayır, gerçek harcanabiliri gör.
 * Planlama katmanı — gerçek bakiyeyi değiştirmez (bkz. utils/kasaMode.ts).
 */
export function KasaModuPanel({ liquidCash }: { liquidCash: number }) {
  const { formatAmount } = useBalancePrivacy()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [buckets, setBuckets] = useState<KasaBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<KasaBucket | null>(null)
  const [name, setName] = useState('')
  const [reserved, setReserved] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchKasaBuckets()
    if (!result.ok) {
      setError(result.error.message ?? 'Kasa kovaları yüklenemedi.')
      setBuckets([])
    } else {
      setBuckets(result.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setName('')
    setReserved('')
    setNote('')
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(bucket: KasaBucket) {
    setEditing(bucket)
    setName(bucket.name)
    setReserved(String(bucket.reserved_amount))
    setNote(bucket.note ?? '')
    setFormError('')
    setModalOpen(true)
  }

  async function handleDelete(bucket: KasaBucket) {
    const confirmed = await confirm({
      title: 'Kovayı sil',
      description: `"${bucket.name}" kovası silinecek. Bakiye etkilenmez.`,
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await deleteKasaBucket(bucket.id)
    if (!result.ok) {
      setError(result.error.message ?? 'Kova silinemedi.')
      return
    }
    await load()
    // Aynı sayfadaki "harcanabilir" hesabı (useKasaReserved) bayat kalmasın (O3).
    void queryClient.invalidateQueries({ queryKey: KASA_BUCKETS_QUERY_KEY })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Kova adı yazmalısın.')
      return
    }
    const reservedAmount = parseNumber(reserved)
    if (reservedAmount < 0) {
      setFormError('Rezerve tutar negatif olamaz.')
      return
    }

    setSaving(true)
    setFormError('')
    const fields = {
      name: trimmedName,
      reserved_amount: reservedAmount,
      note: note.trim() || null,
    }
    const result = editing
      ? await updateKasaBucket(editing.id, fields)
      : await insertKasaBucket({ user_id: user.id, sort_order: buckets.length, ...fields })
    setSaving(false)

    if (!result.ok) {
      setFormError(result.error.message ?? 'Kayıt sırasında hata oluştu.')
      return
    }
    setModalOpen(false)
    await load()
    void queryClient.invalidateQueries({ queryKey: KASA_BUCKETS_QUERY_KEY })
  }

  const reservedTotal = totalReservedTL(buckets)
  const spendable = spendableAfterReserves(liquidCash, buckets)

  return (
    <section className="space-y-4">
      <Card className="border-line-strong">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Wallet size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Kasa modu</h2>
                <p className="text-sm text-ink-muted">
                  Bakiyeni kovalara ayır; rezerv sonrası kalan likidi gör. Bakiye değişmez.
                </p>
              </div>
            </div>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus size={16} />
              Kova ekle
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <MiniStat label="Likit" value={formatAmount(liquidCash)} tone="neutral" />
            <MiniStat label="Rezerve" value={formatAmount(reservedTotal)} tone={reservedTotal > 0 ? 'warning' : 'neutral'} />
            {/* "Harcanabilir" DEĞİL: o etiket kanonik buildSafeToSpend sayısına
                ait (yükümlülük+tampon da düşer). Buradaki sayı yalnız
                likit − rezerv'dir; aynı adı taşıması iki farklı rakamı aynı
                kavram gibi gösteriyordu (denetim 2026-08-12 K11). */}
            <MiniStat
              label="Rezerv sonrası"
              value={formatAmount(spendable)}
              tone={spendable < 0 ? 'danger' : 'good'}
            />
          </div>
          {spendable < 0 ? (
            <p className="mt-2 text-xs font-semibold text-destructive">
              Kovalara likidinden fazlasını ayırdın; rezerveyi azalt.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Kovalar yükleniyor...</p>
      ) : buckets.length === 0 ? (
        <Card className="border border-dashed border-line-strong bg-page shadow-none">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/8 text-primary/60">
              <Boxes size={28} />
            </div>
            <p className="text-sm font-semibold text-ink">Henüz kova yok</p>
            <p className="text-xs text-ink-muted">Acil fon, vergi, tatil gibi kovalar ekleyerek başla.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 min-[520px]:grid-cols-2">
          {buckets.map((bucket) => (
            <Card key={bucket.id} className="border-line-strong">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{bucket.name}</p>
                  {/* Bu kovayı bir hedef besliyor: tutarı elle değiştirmek
                      hedefin planıyla çelişebilir, o yüzden görünür olsun. */}
                  {bucket.goal_id ? (
                    <p className="mt-0.5 text-[11px] font-semibold text-primary">Birikim hedefine bağlı</p>
                  ) : null}
                  <p className="mt-0.5 text-sm font-black tabular-nums text-ink">{formatAmount(bucket.reserved_amount)}</p>
                  {bucket.note ? <p className="mt-0.5 truncate text-[11px] italic text-ink-muted">{bucket.note}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(bucket)}
                    aria-label={`${bucket.name} kovasını düzenle`}
                    className="tap-target grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-black/[.03] dark:hover:bg-white/[.04] hover:text-ink"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(bucket)}
                    aria-label={`${bucket.name} kovasını sil`}
                    className="tap-target grid size-9 place-items-center rounded-lg text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SimpleModal title={editing ? 'Kovayı düzenle' : 'Kova ekle'} open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium">
            Kova adı
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="Örn. Acil fon" required />
          </label>
          {/* Ham `type="number"` TR klavyede virgülü reddediyordu ("1.250,50" ya da
              "1250,5" girilemiyordu). MoneyInput `parseNumber` üzerinden iki
              locale'i de kabul eder ve tutarı biçimlenmiş gösterir (denetim §6). */}
          {/* Zorunlu DEĞİL: `MoneyInput` blur'da 0'ı boşa çeviriyor, zorunlu alanla
              birleşince "kovayı şimdi aç, parayı sonra ayır" akışı HİÇ
              kaydedilemiyordu — üstelik hedefe bağlı kovanın doğal başlangıcı
              tam olarak 0. Boş = 0; gönderimdeki negatif kontrolü yerinde duruyor. */}
          <MoneyInput label="Rezerve tutar (₺)" value={reserved} onValueChange={setReserved} />
          <label className="block text-sm font-medium">
            Not
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" />
          </label>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </form>
      </SimpleModal>
      {confirmDialog}
    </section>
  )
}
