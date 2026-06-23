import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { addCardAlias, deleteCardAlias, fetchCardAliases } from '../../data/repositories/cardAliasesRepo'
import type { Card, CardAlias } from '../../types/database'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export function CardAliasPanel({ card }: { card: Card }) {
  const { user } = useAuth()
  const [aliases, setAliases] = useState<CardAlias[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [digits, setDigits] = useState('')
  const [label, setLabel] = useState('')

  const load = useCallback(async () => {
    const result = await fetchCardAliases(card.id)
    if (!result.ok) {
      setLoadError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('Kart takma adları altyapısı', result.error)
          : result.error.message,
      )
      return
    }
    setAliases(result.data)
  }, [card.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function handleAdd() {
    if (!user || digits.length !== 4 || !/^\d{4}$/.test(digits)) {
      setError('4 haneli kart numarası gir.')
      return
    }
    setBusy(true)
    setError('')
    const result = await addCardAlias({
      userId: user.id,
      cardId: card.id,
      lastFourDigits: digits,
      label: label.trim() || null,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDigits('')
    setLabel('')
    setAdding(false)
    await load()
  }

  async function handleDelete(aliasId: string) {
    setBusy(true)
    setError('')
    const result = await deleteCardAlias(aliasId)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    await load()
  }

  if (loadError) {
    return <Alert variant="destructive">{loadError}</Alert>
  }

  if (aliases === null) {
    return <p className="text-xs text-muted-foreground">Yükleniyor...</p>
  }

  return (
    <div className="mt-3 rounded-xl border border-border/50 bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">SMS kart numaraları</span>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/8 transition"
          >
            <Plus size={12} />
            Ekle
          </button>
        ) : null}
      </div>

      {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}

      {aliases.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          Henüz kart numarası eklenmemiş. SMS otomasyonu için son 4 haneyi ekle.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {aliases.map((alias) => (
          <span
            key={alias.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-mono font-semibold tabular-nums"
          >
            ****{alias.last_four_digits}
            {alias.label ? <span className="font-sans font-normal text-muted-foreground">({alias.label})</span> : null}
            <button
              type="button"
              onClick={() => handleDelete(alias.id)}
              disabled={busy}
              className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
              title="Sil"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      {adding ? (
        <div className="mt-2 flex items-end gap-2">
          <label className="flex-1">
            <span className="text-xs text-muted-foreground">Son 4 hane</span>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="9032"
              className="mt-0.5 font-mono"
            />
          </label>
          <label className="flex-1">
            <span className="text-xs text-muted-foreground">Etiket (opsiyonel)</span>
            <Input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="fiziksel, sanal..."
              className="mt-0.5"
            />
          </label>
          <Button type="button" onClick={handleAdd} disabled={busy || digits.length !== 4} className="h-9 px-3 text-xs">
            {busy ? '...' : 'Ekle'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setAdding(false); setError('') }} className="h-9 px-2 text-xs">
            İptal
          </Button>
        </div>
      ) : null}
    </div>
  )
}
