import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { useChartWidth } from './useChartWidth'
import { DEFAULT_PADDING, formatTickValue, niceScale } from './chartUtils'

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
  // söylemiyordu. CashFlowChart'ın deseniyle aynı (denetim 2026-08-12 §6).
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

  const pad = DEFAULT_PADDING
  const plotW = chartWidth - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const allValues = data.flatMap((d) => grouped && d.prevValue != null ? [d.value, d.prevValue] : [d.value])
  const ticks = niceScale(Math.min(0, ...allValues), Math.max(0, ...allValues))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const yRange = yMax - yMin || 1

  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH
  const zeroY = toY(0)

  const barGroupWidth = plotW / data.length
  const barPad = barGroupWidth * 0.32
  const barWidth = grouped ? (barGroupWidth - barPad * 2) / 2 : barGroupWidth - barPad * 2

  // X ekseni etiket seyreltme: uzun serilerde (ör. 30 günlük) her noktaya etiket
  // basınca yazılar üst üste biniyordu. Etiket başına ~44px ayır, aradan atla —
  // ilk ve son nokta her zaman etiketli kalır.
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44))))

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
              fontSize={11}
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

                {/* X label — seyreltilmiş (ilk/son daima) */}
                {i % labelStep === 0 || i === data.length - 1 ? (
                  <text
                    x={groupX + barGroupWidth / 2}
                    y={height - 4}
                    textAnchor="middle"
                    fill="var(--muted-foreground)"
                    fontSize={11}
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            )
          })}

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

