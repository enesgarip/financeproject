import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchAssetValueEvents } from '../../data/repositories/assetValueEventsRepo'
import { updateAssetValue } from '../../services/assetValueHistory'
import type { Asset, AssetValueEvent } from '../../types/database'
import { buildAssetValueRows, summarizeAssetValueEvents, type AssetValueRow } from '../../utils/assetValueEvents'
import { dateInputValue, formatDate } from '../../utils/date'
import { formatCurrency, formatPercent, parseNumber } from '../../utils/formatCurrency'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const VISIBLE_ROWS = 8

type RangeKey = 'all' | '12m' | 'ytd'
const RANGE_LABELS: Record<RangeKey, string> = { all: 'Tümü', '12m': 'Son 12 ay', ytd: 'Bu yıl' }

function rangeSince(range: RangeKey, now = new Date()): string | null {
  if (range === 'all') return null
  if (range === 'ytd') return `${now.getFullYear()}-01-01`
  const d = new Date(now)
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

function dayOf(value: string) {
  return formatDate(value.slice(0, 10))
}

/**
 * "Bu değer neyden oluşuyor?" — manuel varlığın (BES, Araç, Fon, Diğer) değer
 * geçmişi. Hesap defteri paneliyle aynı dil: başlıkta dönem özeti (katkı +
 * getiri + yüzde), satırlarda "ne zamandan ne zamana, önceki→yeni, katkı,
 * getiri". Eski panel yalnız işaretli deltayı listeliyordu ve düşüşler DB
 * kısıtına takılıp hiç yazılmıyordu; hesap saf util'de (`utils/assetValueEvents`).
 *
 * Yazma tarafı "Değer güncelle": değer + o dönem yatırılan katkı + tarih + not,
 * tek RPC. Genel düzenleme formu değeri değiştirirse trigger olayı katkısız
 * yazar; katkıyı ayırmak isteyen bu formu kullanır.
 */
export function AssetValueHistoryPanel({
  asset,
  onChanged,
  formatAmount = formatCurrency,
}: {
  asset: Asset
  onChanged?: () => void | Promise<void>
  formatAmount?: (value: number | null | undefined) => string
}) {
  const [events, setEvents] = useState<AssetValueEvent[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<RangeKey>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [value, setValue] = useState('')
  const [contribution, setContribution] = useState('')
  const [date, setDate] = useState(() => dateInputValue(new Date()))
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const result = await fetchAssetValueEvents(asset.id)
    if (!result.ok) {
      setLoadError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('Varlık değer geçmişi altyapısı', result.error)
          : result.error.message ?? 'Değer geçmişi yüklenemedi.',
      )
      return
    }
    setLoadError('')
    setEvents(result.data)
  }, [asset.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, asset.updated_at])

  async function handleSubmit() {
    const nextValue = parseNumber(value)
    const nextContribution = contribution.trim() ? parseNumber(contribution) : 0
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setError('Geçerli bir değer gir.')
      return
    }
    setBusy(true)
    setError('')
    const occurredAt = date ? new Date(`${date}T12:00:00`).toISOString() : null
    const result = await updateAssetValue({
      assetId: asset.id,
      value: nextValue,
      contribution: nextContribution,
      occurredAt,
      note: note.trim() || null,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error.message ?? 'Değer güncellenemedi.')
      return
    }
    setFormOpen(false)
    setValue('')
    setContribution('')
    setNote('')
    setDate(dateInputValue(new Date()))
    setOpen(true)
    await load()
    await onChanged?.()
  }

  const allRows = events ? buildAssetValueRows(events) : []
  const since = rangeSince(range)
  const rows = since ? allRows.filter((row) => row.event.occurred_at >= since) : allRows
  const summary = summarizeAssetValueEvents(events ?? [], { since })

  return (
    <div className="mt-3 rounded-lg bg-raised p-3 ring-1 ring-line-strong">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-black uppercase text-ink-muted">
          Değer geçmişi{events && events.length > 0 ? ` (${events.length})` : ''}
        </span>
        {open ? <ChevronUp size={14} className="shrink-0 text-ink-muted" /> : <ChevronDown size={14} className="shrink-0 text-ink-muted" />}
      </button>

      {loadError ? <p className="mt-2 text-xs font-semibold text-destructive">{loadError}</p> : null}

      {summary.count > 0 ? (
        <p className="mt-1.5 text-xs font-semibold text-ink-muted">
          {summary.firstAt ? `İlk kayıt ${dayOf(summary.firstAt)}` : null}
          {summary.totalContribution !== 0 ? <> · Katkı {formatAmount(summary.totalContribution)}</> : null}
          {' · Getiri '}
          <span className={`font-black ${summary.totalGrowth > 0 ? 'text-success' : summary.totalGrowth < 0 ? 'text-destructive' : 'text-ink'}`}>
            {summary.totalGrowth > 0 ? '+' : ''}
            {formatAmount(summary.totalGrowth)}
            {summary.growthPct === null ? '' : ` (${formatPercent(summary.growthPct, { signed: true })})`}
          </span>
        </p>
      ) : events && events.length === 0 ? (
        <p className="mt-1.5 text-xs text-ink-muted">Henüz kayıt yok; değer güncelledikçe dönem dönem katkı ve getiri burada birikir.</p>
      ) : null}

      {open && events && events.length > 0 ? (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dönem">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                aria-pressed={range === key}
                className={`rounded-md px-2 py-1 text-[11px] font-bold ${range === key ? 'bg-ink text-page' : 'bg-page text-ink-muted hover:text-ink'}`}
              >
                {RANGE_LABELS[key]}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="mt-2 text-xs text-ink-muted">Bu dönemde kayıt yok.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {rows.slice(0, VISIBLE_ROWS).map((row) => (
                <HistoryRow key={row.event.id} row={row} formatAmount={formatAmount} />
              ))}
              {rows.length > VISIBLE_ROWS ? (
                <p className="text-xs font-semibold text-ink-muted">+{rows.length - VISIBLE_ROWS} kayıt daha</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 border-t border-line-strong pt-3">
        <button
          type="button"
          onClick={() => {
            setFormOpen((prev) => !prev)
            setError('')
            if (!formOpen && !value) setValue(String(asset.estimated_value_try))
          }}
          aria-expanded={formOpen}
          className="text-xs font-black text-info underline-offset-2 hover:underline"
        >
          {formOpen ? 'Güncellemeyi kapat' : 'Değer güncelle'}
        </button>

        {formOpen ? (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink-muted">
              Yeni değer (₺)
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                className="mt-1 tabular-nums"
                aria-label={`${asset.name} yeni değer`}
              />
            </label>
            <label className="text-xs font-semibold text-ink-muted">
              Bu dönem yatırdığın (₺)
              <Input
                value={contribution}
                onChange={(event) => setContribution(event.target.value)}
                type="text"
                inputMode="decimal"
                placeholder="0 — katkı payı, devlet katkısı; çekim için eksi"
                className="mt-1 tabular-nums"
                aria-label={`${asset.name} dönem katkısı`}
              />
            </label>
            <label className="text-xs font-semibold text-ink-muted">
              Tarih
              <Input
                value={date}
                onChange={(event) => setDate(event.target.value)}
                type="date"
                className="mt-1"
                aria-label={`${asset.name} güncelleme tarihi`}
              />
            </label>
            <label className="text-xs font-semibold text-ink-muted">
              Not
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                type="text"
                placeholder="örn. Ağustos ekstresi"
                className="mt-1"
                aria-label={`${asset.name} güncelleme notu`}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy || !value.trim()}
              onClick={() => void handleSubmit()}
            >
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-xs font-semibold text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}

function HistoryRow({
  row,
  formatAmount,
}: {
  row: AssetValueRow<AssetValueEvent>
  formatAmount: (value: number | null | undefined) => string
}) {
  const growthClass = row.growth > 0 ? 'text-success' : row.growth < 0 ? 'text-destructive' : 'text-ink'
  return (
    <div className="rounded-lg bg-page px-2.5 py-2 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-ink-muted">
          {row.periodStart ? `${dayOf(row.periodStart)} → ` : ''}
          <span className="font-bold text-ink">{dayOf(row.event.occurred_at)}</span>
        </span>
        <span className={`shrink-0 font-black tabular-nums ${growthClass}`}>
          {row.growth > 0 ? '+' : ''}
          {formatAmount(row.growth)}
          {row.growthPct === null ? '' : ` (${formatPercent(row.growthPct, { signed: true })})`}
        </span>
      </div>
      <p className="mt-0.5 truncate tabular-nums text-ink-muted">
        {formatAmount(row.valueBefore)} → {formatAmount(row.valueAfter)}
        {row.contribution !== 0 ? <> · katkı {formatAmount(row.contribution)}</> : null}
        {row.event.note ? <span className="italic"> · {row.event.note}</span> : null}
      </p>
    </div>
  )
}
