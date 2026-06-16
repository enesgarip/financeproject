import { useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
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

export function DonutChart({
  data,
  size = 200,
  innerRadius = 55,
  showLegend = true,
  totalLabel = 'Toplam',
}: DonutChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const total = sumTL(data.map((d) => d.value))
  const active = activeIndex !== null ? data[activeIndex] : null
  const centerValue = active ? formatCurrency(active.value) : formatCurrency(total)
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

  if (data.length === 0 || total === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground"
        style={{ height: size }}
      >
        Veri yok
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Chart */}
      <div className="relative mx-auto min-w-0" style={{ width: size, height: size, minHeight: size }}>
        {/* Center label overlay */}
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

        <PieChart width={size} height={size}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            dataKey="value"
            paddingAngle={2}
            animationBegin={0}
            animationDuration={700}
          >
            {data.map((entry, index) => {
              const isActive = activeIndex === index
              const isAnyActive = activeIndex !== null
              const color = entry.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]

              return (
                <Cell
                  key={entry.name}
                  fill={color}
                  stroke="transparent"
                  opacity={isAnyActive && !isActive ? 0.35 : 1}
                  style={{
                    cursor: 'pointer',
                    transition: 'opacity 0.18s, r 0.18s',
                    // Expand active slice via filter
                    filter: isActive
                      ? 'drop-shadow(0 0 6px color-mix(in srgb, currentColor 40%, transparent))'
                      : undefined,
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              )
            })}
          </Pie>
        </PieChart>
      </div>

      {/* Legend */}
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
                  'flex cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
                  isActive ? 'bg-muted/60' : 'hover:bg-muted/40',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="truncate text-muted-foreground">{entry.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono tabular-nums text-foreground">{formatCurrency(entry.value)}</span>
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
