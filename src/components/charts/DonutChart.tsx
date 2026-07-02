import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { cn } from '@/lib/utils'
import { sumTL } from '@/utils/money'

export type DonutSlice = {
  name: string
  value: number
  color?: string
}

const DEFAULT_COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--destructive)',
  'var(--info)',
  '#a78bfa',
  '#fb923c',
  '#38bdf8',
]

type DonutChartProps = {
  data: DonutSlice[]
  size?: number
  innerRadius?: number
  showLegend?: boolean
  totalLabel?: string
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startRad = ((startAngle - 90) * Math.PI) / 180
  const endRad = ((endAngle - 90) * Math.PI) / 180
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}

export function DonutChart({
  data,
  size = 200,
  innerRadius = 55,
  showLegend = true,
  totalLabel = 'Toplam',
}: DonutChartProps) {
  const { formatAmount } = useBalancePrivacy()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const total = sumTL(data.map((d) => d.value))
  const active = activeIndex !== null ? data[activeIndex] : null
  const centerValue = active ? formatAmount(active.value) : formatAmount(total)
  const centerLabel = active ? active.name : totalLabel
  const availableOuterRadius = Math.max(innerRadius + 8, size / 2 - 8)
  const outerRadius = Math.min(innerRadius + 32, availableOuterRadius)
  const centerMaxWidth = Math.max(56, Math.floor(innerRadius * 1.72))
  const valueFontSize = Math.max(
    9,
    Math.min(15, Math.floor((centerMaxWidth / Math.max(centerValue.length, 1)) * 1.55)),
  )
  const labelFontSize = Math.max(
    8,
    Math.min(10, Math.floor((centerMaxWidth / Math.max(centerLabel.length, 1)) * 1.6)),
  )
  const chartSummary = `${totalLabel}: ${formatAmount(total)}. ${data
    .map((slice) => `${slice.name} ${formatAmount(slice.value)}`)
    .join(', ')}.`

  if (data.length === 0 || total === 0) {
    return (
      <div
        role="status"
        className="flex items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground"
        style={{ height: size }}
      >
        Veri yok
      </div>
    )
  }

  const cx = size / 2
  const cy = size / 2
  const midRadius = (innerRadius + outerRadius) / 2
  const gap = 2

  const slices = data.map((slice, i) => {
    const startAngle = data.slice(0, i).reduce((sum, s) => sum + (s.value / total) * 360, 0)
    const sliceAngle = (slice.value / total) * 360
    const paddedStart = startAngle + gap / 2
    const paddedEnd = startAngle + sliceAngle - gap / 2
    const arc = sliceAngle > gap ? describeArc(cx, cy, midRadius, paddedStart, paddedEnd) : ''
    return { ...slice, arc, index: i }
  })

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative mx-auto min-w-0"
        role="img"
        aria-label={chartSummary}
        style={{ width: size, height: size, minHeight: size }}
      >
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5"
          aria-hidden
        >
          <span
            className="block overflow-hidden text-ellipsis whitespace-nowrap text-center font-mono font-semibold tabular-nums text-foreground transition-all duration-200"
            style={{ maxWidth: centerMaxWidth, fontSize: valueFontSize, lineHeight: 1.05 }}
          >
            {centerValue}
          </span>
          <span
            className="block overflow-hidden text-ellipsis whitespace-nowrap text-center font-medium uppercase text-muted-foreground transition-all duration-200"
            style={{ maxWidth: centerMaxWidth, fontSize: labelFontSize, lineHeight: 1.1, letterSpacing: 0 }}
          >
            {centerLabel}
          </span>
        </div>

        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.map((slice) => {
            if (!slice.arc) return null
            const isActive = activeIndex === slice.index
            const isAnyActive = activeIndex !== null
            const color = slice.color ?? DEFAULT_COLORS[slice.index % DEFAULT_COLORS.length]
            return (
              <path
                key={slice.name}
                d={slice.arc}
                fill="none"
                stroke={color}
                strokeWidth={outerRadius - innerRadius}
                strokeLinecap="round"
                opacity={isAnyActive && !isActive ? 0.35 : 1}
                style={{
                  cursor: 'pointer',
                  transition: 'opacity 0.18s',
                  filter: isActive
                    ? 'drop-shadow(0 0 6px color-mix(in srgb, currentColor 40%, transparent))'
                    : undefined,
                }}
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              />
            )
          })}
        </svg>
      </div>

      {showLegend && (
        <ul className="flex flex-col gap-1" role="list">
          {data.slice(0, 6).map((entry, index) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0'
            const color = entry.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
            const isActive = activeIndex === index

            return (
              <li
                key={entry.name}
                className={cn(
                  'flex cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  isActive ? 'bg-muted/60' : 'hover:bg-muted/40',
                )}
                tabIndex={0}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                  <span className="truncate text-muted-foreground">{entry.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono tabular-nums text-foreground">{formatAmount(entry.value)}</span>
                  <span className="w-8 text-right font-medium text-muted-foreground">%{pct}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
