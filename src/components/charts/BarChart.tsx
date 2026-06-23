import { useState } from 'react'
import { formatCurrency } from '@/utils/formatCurrency'
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
  const [chartRef, chartWidth] = useChartWidth()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground"
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

  const hovered = hoverIndex !== null ? data[hoverIndex] : null
  const hoverX = hoverIndex !== null ? pad.left + hoverIndex * barGroupWidth + barGroupWidth / 2 : 0

  return (
    <div ref={chartRef} className="min-w-0" style={{ height, minHeight: height }}>
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

                {/* X label */}
                <text
                  x={groupX + barGroupWidth / 2}
                  y={height - 4}
                  textAnchor="middle"
                  fill="var(--muted-foreground)"
                  fontSize={11}
                >
                  {point.label}
                </text>
              </g>
            )
          })}

          {/* Tooltip */}
          {hovered !== null && hoverIndex !== null ? (
            <foreignObject
              x={Math.min(hoverX - 70, chartWidth - 148)}
              y={Math.max(pad.top, toY(Math.max(hovered.value, hovered.prevValue ?? 0)) - 60)}
              width={140}
              height={grouped ? 72 : 52}
              style={{ pointerEvents: 'none' }}
            >
              <div className="rounded-xl border border-border/70 bg-card p-2 shadow-[var(--shadow-floating)]">
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">{hovered.label}</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-muted-foreground">Tutar</span>
                  <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground">
                    {formatCurrency(hovered.value)}
                  </span>
                </div>
                {grouped && hovered.prevValue != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] text-muted-foreground">Önceki Ay</span>
                    <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground">
                      {formatCurrency(hovered.prevValue)}
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

export function Sparkline({
  data,
  positive = true,
  height = 40,
  width = 100,
}: {
  data: number[]
  positive?: boolean
  height?: number
  width?: number
}) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1

  const pathData = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height * 0.85)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  const color = positive ? 'var(--success)' : 'var(--destructive)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={pathData} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
