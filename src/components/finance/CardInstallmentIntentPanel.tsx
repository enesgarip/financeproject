import { CalendarClock, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import {
  cancelCardInstallmentIntent,
  fetchCardInstallmentIntents,
  insertCardInstallmentIntent,
} from '../../data/repositories/cardInstallmentIntentsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card, CardInstallment, CardInstallmentIntent } from '../../types/database'
import { installmentChoicesWith } from '../../utils/cardInstallmentCalendar'
import { buildPlannedInstallmentHint } from '../../utils/installmentHorizon'
import { parseNumber } from '../../utils/formatCurrency'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Button } from '../ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { Input, Select } from '../ui/input'

/**
 * Alışverişten ÖNCE bırakılan taksit notu.
 *
 * Neden var: banka SMS'i taksit bilgisi taşımaz, provizyon her zaman tek çekim
 * doğar ve işaretlenmezse 7. günde tek çekim olarak kesinleşir. Niyeti karar
 * anında (mağazada) bırakınca SMS düştüğü an otomatik uygulanır — 7 günlük
 * pencereyi hatırlamak zorunda kalmazsın.
 *
 * Para modeline dokunmaz: yalnız provizyonun taksit etiketini yazar.
 */

const intentHelp = {
  calculation: 'Eşleşme: kart + tutar aralığı + satıcı ipucu + geçerlilik penceresi. En özel niyet seçilir.',
  importance: 'SMS taksit bilgisi taşımaz; niyet olmadan provizyon tek çekim doğar ve 7 günde öyle kesinleşir.',
  source: 'Niyet yalnız taksit etiketini yazar; borç, kova ve ledger değişmez.',
} satisfies HelpTooltipContent

const VALIDITY_OPTIONS = [
  { days: 1, label: 'Bugün (1 gün)' },
  { days: 2, label: '2 gün' },
  { days: 3, label: '3 gün' },
  { days: 7, label: '1 hafta' },
]

function remainingLabel(expiresAt: string, nowMs: number): string {
  const diffMs = new Date(expiresAt).getTime() - nowMs
  if (diffMs <= 0) return 'süresi doldu'
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `${Math.max(1, hours)} saat kaldı`
  return `${Math.round(hours / 24)} gün kaldı`
}

type CardInstallmentIntentPanelProps = {
  cards: Card[]
  /** Planlı taksitler: niyet formunda "aylık yükün X → Y olur" bağlamı için. */
  installments?: CardInstallment[]
  /** Niyet tüketilmiş olabilir; provizyon listesi tazelensin. */
  onChanged?: () => Promise<void> | void
}

export function CardInstallmentIntentPanel({ cards, installments = [], onChanged }: CardInstallmentIntentPanelProps) {
  const { user } = useAuth()
  const { formatAmount } = useBalancePrivacy()
  const [intents, setIntents] = useState<CardInstallmentIntent[]>([])
  // Süre kıyası render sırasında değil, yükleme anında sabitlenir (saf render).
  const [nowMs, setNowMs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const [cardId, setCardId] = useState('')
  const [merchantHint, setMerchantHint] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [installmentCount, setInstallmentCount] = useState(3)
  const [validDays, setValidDays] = useState(2)

  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')

  const load = useCallback(async () => {
    const result = await fetchCardInstallmentIntents()
    if (!result.ok) {
      setIntents([])
      setLoading(false)
      setError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('Taksit niyeti altyapısı', result.error)
          : result.error.message ?? 'Taksit niyetleri yüklenemedi.',
      )
      return
    }
    setIntents(result.data)
    setNowMs(Date.now())
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const activeIntents = intents.filter(
    (intent) => intent.status === 'active' && new Date(intent.expires_at).getTime() > nowMs,
  )

  async function handleAdd() {
    if (!user) return
    const min = minAmount.trim() ? parseNumber(minAmount) : null
    const max = maxAmount.trim() ? parseNumber(maxAmount) : null

    if (min !== null && max !== null && max < min) {
      setError('Üst sınır alt sınırdan küçük olamaz.')
      return
    }

    setBusy(true)
    setError('')
    const result = await insertCardInstallmentIntent(user.id, {
      cardId: cardId || null,
      merchantHint: merchantHint.trim() || null,
      minAmount: min && min > 0 ? min : null,
      maxAmount: max && max > 0 ? max : null,
      installmentCount,
      validDays,
      note: null,
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('Taksit niyeti altyapısı', result.error)
          : result.error.message ?? 'Taksit niyeti kaydedilemedi.',
      )
      return
    }

    setMerchantHint('')
    setMinAmount('')
    setMaxAmount('')
    setFormOpen(false)
    await load()
  }

  async function handleCancel(intentId: string) {
    setBusy(true)
    setError('')
    const result = await cancelCardInstallmentIntent(intentId)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message ?? 'Taksit niyeti iptal edilemedi.')
      return
    }
    await load()
    await onChanged?.()
  }

  if (loading) return null
  if (creditCards.length === 0) return null

  return (
    <SurfaceCard className="border-info/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="inline-flex items-center gap-1.5 text-base">
              <CalendarClock size={17} />
              Bekleyen taksit niyeti
              <HelpTooltip title="Bekleyen taksit niyeti" content={intentHelp} />
            </CardTitle>
            <p className="mt-1 text-xs text-ink-muted">
              Taksitli alışverişe çıkmadan önce buraya not bırak; SMS provizyonu düştüğü an taksit sayısı otomatik işlenir.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setFormOpen((open) => !open)} disabled={busy}>
            <Plus data-icon="inline-start" />
            {formOpen ? 'Kapat' : 'Niyet ekle'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {error ? (
          <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{error}</p>
        ) : null}

        {formOpen ? (
          <div className="grid gap-3 rounded-xl border border-line-strong bg-raised p-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink-muted">
              Kart (boş = fark etmez)
              <Select value={cardId} onChange={(event) => setCardId(event.target.value)} className="mt-1">
                <option value="">Fark etmez</option>
                {creditCards.map((card) => (
                  <option key={card.id} value={card.id}>{`${card.bank_name} · ${card.card_name}`}</option>
                ))}
              </Select>
            </label>

            <label className="text-xs font-semibold text-ink-muted">
              Taksit sayısı
              <Select
                value={String(installmentCount)}
                onChange={(event) => setInstallmentCount(Number(event.target.value))}
                className="mt-1"
              >
                {installmentChoicesWith(2)
                  .filter((count) => count > 1)
                  .map((count) => (
                    <option key={count} value={count}>{count} taksit</option>
                  ))}
              </Select>
            </label>

            <label className="text-xs font-semibold text-ink-muted">
              Satıcı ipucu (boş = fark etmez)
              <Input
                value={merchantHint}
                onChange={(event) => setMerchantHint(event.target.value)}
                placeholder="örn. mediamarkt"
                className="mt-1"
              />
            </label>

            <label className="text-xs font-semibold text-ink-muted">
              Geçerlilik
              <Select value={String(validDays)} onChange={(event) => setValidDays(Number(event.target.value))} className="mt-1">
                {VALIDITY_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>{option.label}</option>
                ))}
              </Select>
            </label>

            <label className="text-xs font-semibold text-ink-muted">
              En az tutar (boş = sınırsız)
              <Input
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="mt-1"
              />
            </label>

            <label className="text-xs font-semibold text-ink-muted">
              En çok tutar (boş = sınırsız)
              <Input
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="mt-1"
              />
            </label>

            <div className="sm:col-span-2">
              {(() => {
                // Karar anı bağlamı: beklenen tutar (üst sınır; yoksa alt sınır)
                // girildiyse yeni planın aylık yüke etkisi burada görünür.
                const estimate = maxAmount.trim() ? parseNumber(maxAmount) : minAmount.trim() ? parseNumber(minAmount) : null
                const horizonHint = buildPlannedInstallmentHint(installments, { amount: estimate, count: installmentCount })
                return horizonHint ? (
                  <p className="mb-2 text-xs font-semibold tabular-nums text-ink">
                    Bu planla aylık taksit yükün {formatAmount(horizonHint.baseMonthly)} →{' '}
                    {formatAmount(horizonHint.newMonthly)} olur (~{formatAmount(horizonHint.perMonth)}/ay, {horizonHint.months} ay).
                  </p>
                ) : null
              })()}
              <p className="mb-2 text-xs text-ink-muted">
                Tutar aralığı vermek, niyetin yanlış bir işleme yapışmasını engeller: aynı gün yaptığın başka bir
                harcamaya değil, beklediğin tutardakine uygulanır.
              </p>
              <Button type="button" onClick={() => void handleAdd()} disabled={busy}>
                {busy ? 'Kaydediliyor...' : 'Niyeti kaydet'}
              </Button>
            </div>
          </div>
        ) : null}

        {activeIntents.length === 0 ? (
          formOpen ? null : (
            <p className="text-xs text-ink-muted">Bekleyen niyet yok.</p>
          )
        ) : (
          activeIntents.map((intent) => {
            const card = creditCards.find((row) => row.id === intent.card_id)
            const scope = [
              card ? `${card.bank_name} · ${card.card_name}` : 'Tüm kartlar',
              intent.merchant_hint ? `"${intent.merchant_hint}"` : null,
              intent.min_amount != null || intent.max_amount != null
                ? `${intent.min_amount != null ? formatAmount(intent.min_amount) : '—'} / ${intent.max_amount != null ? formatAmount(intent.max_amount) : '—'}`
                : null,
            ].filter(Boolean).join(' · ')

            return (
              <div
                key={intent.id}
                className="flex items-center gap-3 rounded-xl border border-info/20 bg-info/8 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{intent.installment_count} taksit bekleniyor</p>
                  <p className="truncate text-xs text-ink-muted">
                    {scope} · {remainingLabel(intent.expires_at, nowMs)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCancel(intent.id)}
                  disabled={busy}
                  title="Niyeti iptal et"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-40"
                >
                  <X size={13} />
                  İptal
                </button>
              </div>
            )
          })
        )}
      </CardContent>
    </SurfaceCard>
  )
}
