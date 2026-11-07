import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { useChartWidth } from './useChartWidth'
import { DEFAULT_PADDING, chartPadding, formatTickValue, niceScale, xAxisLabels } from './chartUtils'

export type BarDataPoint = {
  label: string
  value: number
  prevValue?: number
  color?: string
}

type BarChartProps = {
  data: BarDataPoint[]
  height?: number
  positiveColor?: string
  negativeColor?: string
  grouped?: boolean
}

export function BarChart({
  data,
  height = 200,
  positiveColor = 'var(--primary)',
  negativeColor = 'var(--destructive)',
  grouped = false,
}: BarChartProps) {
  const { formatAmount } = useBalancePrivacy()
  const [chartRef, chartWidth] = useChartWidth()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Erişilebilir ad + cümle özeti: SVG'nin kendisi ekran okuyucuya hiçbir şey
  // söylemiyordu (denetim 2026-08-12 §6; desen LineChart ile ortak).
  // Tutarlar `formatAmount`'tan geçer — gizlilik maskesi burada da geçerli.
  const chartSummary = data
    .map((point) =>
      grouped && point.prevValue != null
        ? `${point.label}: ${formatAmount(point.value)} (önceki ay ${formatAmount(point.prevValue)})`
        : `${point.label}: ${formatAmount(point.value)}`,
    )
    .join('; ')

  if (data.length === 0) {
    return (
      <div
        role="status"
        className="flex items-center justify-center rounded-xl bg-page text-sm text-ink-muted"
        style={{ height }}
      >
        Veri yok
      </div>
    )
  }

  const allValues = data.flatMap((d) => grouped && d.prevValue != null ? [d.value, d.prevValue] : [d.value])
  const ticks = niceScale(Math.min(0, ...allValues), Math.max(0, ...allValues), Math.max(2, Math.floor((height - DEFAULT_PADDING.top - DEFAULT_PADDING.bottom) / 36)))
  const pad = chartPadding(ticks)
  const plotW = Math.max(1, chartWidth - pad.left - pad.right)
  const plotH = Math.max(1, height - pad.top - pad.bottom)
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const yRange = yMax - yMin || 1

  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH
  const zeroY = toY(0)

  const barGroupWidth = plotW / data.length
  const barPad = barGroupWidth * 0.32
  const barWidth = grouped ? (barGroupWidth - barPad * 2) / 2 : barGroupWidth - barPad * 2

  const labels = xAxisLabels(data.map(point => point.label), data.map((_, i) => pad.left + (i + 0.5) * barGroupWidth), pad.left, chartWidth - pad.right)

  const hovered = hoverIndex !== null ? data[hoverIndex] : null
  const hoverX = hoverIndex !== null ? pad.left + hoverIndex * barGroupWidth + barGroupWidth / 2 : 0

  return (
    <div
      ref={chartRef}
      role="img"
      aria-label={`Sütun grafiği. ${chartSummary}`}
      className="min-w-0"
      style={{ height, minHeight: height }}
    >
      {chartWidth > 0 ? (
        <svg
          width={chartWidth}
          height={height}
          className="select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid */}
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={pad.left}
              x2={chartWidth - pad.right}
              y1={toY(tick)}
              y2={toY(tick)}
              stroke="var(--border)"
              strokeOpacity={0.5}
              strokeDasharray="3 3"
            />
          ))}

          {/* Y axis labels */}
          {ticks.map((tick) => (
            <text
              key={tick}
              x={pad.left - 6}
              y={toY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted-foreground)"
              fontSize={12}
            >
              {formatTickValue(tick)}
            </text>
          ))}

          {/* Bars */}
          {data.map((point, i) => {
            const groupX = pad.left + i * barGroupWidth
            const barX = groupX + barPad
            const color = point.color ?? (point.value >= 0 ? positiveColor : negativeColor)
            const barY = point.value >= 0 ? toY(point.value) : zeroY
            const barH = Math.max(1, Math.abs(toY(point.value) - zeroY))

            return (
              <g key={point.label}>
                {/* Hit area */}
                <rect
                  x={groupX}
                  y={pad.top}
                  width={barGroupWidth}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(i)}
                  onPointerDown={() => setHoverIndex(i)}
                />
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barH}
                  rx={Math.min(6, barWidth / 2)}
                  fill={color}
                  opacity={0.85}
                />
                {grouped && point.prevValue != null ? (
                  <rect
                    x={barX + barWidth}
                    y={point.prevValue >= 0 ? toY(point.prevValue) : zeroY}
                    width={barWidth}
                    height={Math.max(1, Math.abs(toY(point.prevValue) - zeroY))}
                    rx={Math.min(6, barWidth / 2)}
                    fill="var(--muted-foreground)"
                    opacity={0.4}
                  />
                ) : null}

              </g>
            )
          })}

          <g data-axis="x">
            {labels.map(label => <text key={label.index} x={label.x} y={height - 6} textAnchor="start" fill="var(--muted-foreground)" fontSize={12}><title>{data[label.index].label}</title>{label.text}</text>)}
          </g>

          {/* Tooltip */}
          {hovered !== null && hoverIndex !== null ? (
            <foreignObject
              x={Math.max(pad.left, Math.min(hoverX - 70, chartWidth - 148))}
              y={Math.max(pad.top, toY(Math.max(hovered.value, hovered.prevValue ?? 0)) - 60)}
              width={140}
              height={grouped ? 72 : 52}
              style={{ pointerEvents: 'none' }}
            >
              <div className="rounded-xl border border-line-strong bg-raised shadow-[var(--shadow-card)] p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase text-ink-muted">{hovered.label}</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-ink-muted">Tutar</span>
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-ink">
                    {formatAmount(hovered.value)}
                  </span>
                </div>
                {grouped && hovered.prevValue != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] text-ink-muted">Önceki Ay</span>
                    <span className="font-mono text-[10px] font-semibold tabular-nums text-ink">
                      {formatAmount(hovered.prevValue)}
                    </span>
                  </div>
                ) : null}
              </div>
            </foreignObject>
          ) : null}
        </svg>
      ) : null}
    </div>
  )
}

