import { CalendarPlus, ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { insertPayments } from '../../data/repositories/paymentsRepo'
import type { Payment } from '../../types/database'
import { OBLIGATION_PRESETS, buildPresetPayments } from '../../utils/obligationPresets'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

type Props = {
  existing: Payment[]
  onAdded: () => Promise<void> | void
}

/**
 * "Türkiye finans takvimi" — MTV, emlak, gelir vergisi gibi sabit tarihli
 * yükümlülükleri tek tıkla planlı ödeme olarak ekler (roadmap Y4). Tutar 0 +
 * tahmini gelir; kullanıcı listede düzenler. Mükerrer ekleme engellenir.
 */
export function TurkishCalendarPresets({ existing, onAdded }: Props) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function add(presetId: string) {
    if (!user) return
    const preset = OBLIGATION_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setBusyId(presetId)
    setMessage(null)
    setError(null)
    try {
      const rows = buildPresetPayments(preset, user.id, new Date(), existing)
      if (rows.length === 0) {
        setMessage(`${preset.title} zaten ekli.`)
        return
      }
      await insertPayments(rows)
      await onAdded()
      setMessage(`${preset.title} eklendi (${rows.length} taksit). Tutarı düzenlemeyi unutma.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eklenemedi.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarPlus className="h-4 w-4" /> Türkiye finans takvimi
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {open ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Sabit tarihli devlet yükümlülüklerini tek tıkla ekle. Tutar tahminidir; ekledikten
              sonra düzenle. Tarihler yaklaşıktır, resmi takvimi teyit et.
            </p>
            <div className="flex flex-col gap-2">
              {OBLIGATION_PRESETS.map((preset) => (
                <div key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{preset.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{preset.note}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void add(preset.id)}
                    disabled={busyId !== null}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Ekle
                  </Button>
                </div>
              ))}
            </div>
            {message ? <Badge variant="secondary">{message}</Badge> : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
