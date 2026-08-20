import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { cn } from '@/lib/utils'
import { formatPercent } from '@/utils/formatCurrency'
import { sumTL } from '@/utils/money'
import { VIZ_NEUTRAL, VIZ_SERIES } from './vizPalette'

/**
 * Parça-bütün kompozisyonu: yatay yığın + sıralı etiketli satırlar.
 *
 * Neden halka (donut) değil:
 *  - **Okuma işi büyüklük karşılaştırmak.** Yay açısı bunun için kötü bir kanal;
 *    %6,5 ile %5,0 arasındaki farkı halkada kimse okuyamıyor, çubukta uzunluk
 *    farkı doğrudan görünüyor.
 *  - **Halka sarmalı yapay bir komşuluk üretiyor.** Son dilim ilk dilime değiyor;
 *    koyu temada slot-7 mor ile slot-1 mavi protanopide ΔE 1.9'a düşüyordu
 *    (eşik 8). Yatay yığında sarmal yok — komşuluk doğrusal.
 *  - **Uzun Türkçe kategori adları** ("Nakit (USD)") halka çevresine sığmıyor,
 *    satır listesinde rahat duruyor.
 *
 * Renk burada ikincil kanal: her segmentin kendi etiketli satırı ve yüzdesi var,
 * segmentler arasında yüzey boşluğu bırakılıyor. Kimlik renge tek başına
 * yüklenmediği için palet komşuluğu tek başına belirleyici olmuyor.
 */

export type CompositionSlice = {
  name: string
  value: number
  color?: string
}

type CompositionBarProps = {
  data: CompositionSlice[]
  /** Ortada gösterilen toplamın etiketi. */
  totalLabel?: string
  /** Satır listesini gizlemek için (nadiren; etiket relief kanalıdır). */
  showRows?: boolean
}

function fallbackColor(index: number): string {
  return index < VIZ_SERIES.length ? VIZ_SERIES[index] : VIZ_NEUTRAL
}


export function CompositionBar({
  data,
  totalLabel = 'Toplam',
  showRows = true,
}: CompositionBarProps) {
  const { formatAmount } = useBalancePrivacy()
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState<string | null>(null)

  const total = sumTL(data.map((d) => d.value))

  if (data.length === 0 || total <= 0) {
    return (
      <div role="status" className="rounded-xl bg-page p-4 text-sm text-ink-muted">
        Veri yok
      </div>
    )
  }

  const withColor = data.map((slice, index) => ({
    ...slice,
    color: slice.color ?? fallbackColor(index),
    pct: (slice.value / total) * 100,
  }))

  // Satırlar büyükten küçüğe: rakam okuma sırası. Çubuk verilen (kanonik) sırayı
  // korur ki renk komşuluğu ve düzen aylar arasında sabit kalsın.
  const rows = [...withColor].sort((a, b) => b.value - a.value)

  const summary = `${totalLabel}: ${formatAmount(total)}. ${withColor
    .map((s) => `${s.name} ${formatAmount(s.value)}`)
    .join(', ')}.`

  const activeName = previewName ?? selectedName
  const active = activeName ? withColor.find((s) => s.name === activeName) ?? null : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="finance-label">{active ? active.name : totalLabel}</span>
        <span className="finance-value text-lg font-bold text-ink">
          {formatAmount(active ? active.value : total)}
        </span>
      </div>

      {/* Yığın: segmentler arasında yüzey boşluğu — renkler birbirine yapışmasın. */}
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={summary}>
        {withColor.map((slice) => (
          <div
            key={slice.name}
            className="h-full first:rounded-l-full last:rounded-r-full transition-opacity duration-150"
            style={{
              width: `${slice.pct}%`,
              background: slice.color,
              opacity: activeName && activeName !== slice.name ? 0.35 : 1,
            }}
          />
        ))}
      </div>

      {showRows && (
        <ul className="flex flex-col gap-0.5" role="list">
          {rows.map((slice) => {
            const isSelected = selectedName === slice.name
            return (
              <li key={slice.name}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className={cn(
                    'finance-touch-target flex w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-xs transition-colors',
                    activeName === slice.name ? 'bg-page' : 'hover:bg-black/[.03] dark:hover:bg-white/[.04]',
                  )}
                  onClick={() => setSelectedName((current) => (current === slice.name ? null : slice.name))}
                  onMouseEnter={() => setPreviewName(slice.name)}
                  onMouseLeave={() => setPreviewName(null)}
                  onFocus={() => setPreviewName(slice.name)}
                  onBlur={() => setPreviewName(null)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{ background: slice.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-ink-muted">{slice.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="finance-value text-ink">{formatAmount(slice.value)}</span>
                    <span className="w-12 text-right font-semibold tabular-nums text-ink-muted">
                      {formatPercent(slice.pct)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
