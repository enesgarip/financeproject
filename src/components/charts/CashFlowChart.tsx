import { useState } from 'react'
import { formatCurrency } from '@/utils/formatCurrency'
import { useChartWidth } from './useChartWidth'
import { DEFAULT_PADDING, buildAreaD, buildPathD, formatTickValue, niceScale } from './chartUtils'

export type CashFlowPoint = {
  label: string
  income: number
  outflow: number
  net: number
}

type CashFlowChartProps = {
  data: CashFlowPoint[]
  height?: number
}

type SeriesConfig = {
  key: 'income' | 'outflow' | 'net'
  name: string
  stroke: string
  gradId: string
  opacity: number
  dash?: string
}

const SERIES: SeriesConfig[] = [
  { key: 'income', name: 'Gelir', stroke: 'var(--success)', gradId: 'cfIncome', opacity: 0.18 },
  { key: 'outflow', name: 'Gider', stroke: 'var(--destructive)', gradId: 'cfOutflow', opacity: 0.15 },
  { key: 'net', name: 'Net', stroke: 'var(--primary)', gradId: 'cfNet', opacity: 0.2, dash: '5 3' },
]

export function CashFlowChart({ data, height = 220 }: CashFlowChartProps) {
  const [chartRef, chartWidth] = useChartWidth()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const chartSummary = data
    .map((p) => `${p.label}: gelir ${formatCurrency(p.income)}, gider ${formatCurrency(p.outflow)}, net ${formatCurrency(p.net)}`)
    .join('; ')

  if (data.length === 0) {
    return (
      <div
        role="status"
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

  const allValues = data.flatMap((d) => [d.income, d.outflow, d.net])
  const ticks = niceScale(Math.min(0, ...allValues), Math.max(...allValues))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const yRange = yMax - yMin || 1

  const toX = (i: number) => pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH
  const baseline = toY(yMin)

  const seriesPoints = SERIES.map((s) => ({
    ...s,
    points: data.map((d, i) => ({ x: toX(i), y: toY(d[s.key]) })),
  }))

  const hovered = hoverIndex !== null ? data[hoverIndex] : null
  const hoverX = hoverIndex !== null ? toX(hoverIndex) : 0

  return (
    <div
      ref={chartRef}
      role="img"
      aria-label={`Nakit akışı grafiği. ${chartSummary}`}
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
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.gradId} id={s.gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.stroke} stopOpacity={s.opacity} />
                <stop offset="95%" stopColor={s.stroke} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

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

          {/* X axis labels */}
          {data.map((d, i) => (
            <text
              key={d.label}
              x={toX(i)}
              y={height - 4}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize={11}
            >
              {d.label}
            </text>
          ))}

          {/* Areas + lines */}
          {seriesPoints.map((s) => (
            <g key={s.key}>
              <path d={buildAreaD(s.points, baseline)} fill={`url(#${s.gradId})`} />
              <path
                d={buildPathD(s.points)}
                fill="none"
                stroke={s.stroke}
                strokeWidth={2}
                strokeDasharray={s.dash}
              />
            </g>
          ))}

          {/* Hit areas */}
          {data.map((_, i) => {
            const slotW = data.length === 1 ? plotW : plotW / (data.length - 1)
            const x = data.length === 1 ? pad.left : toX(i) - slotW / 2
            return (
              <rect
                key={i}
                x={x}
                y={pad.top}
                width={slotW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
              />
            )
          })}

          {/* Active dots */}
          {hoverIndex !== null
            ? seriesPoints.map((s) => (
                <circle
                  key={s.key}
                  cx={s.points[hoverIndex].x}
                  cy={s.points[hoverIndex].y}
                  r={4}
                  fill={s.stroke}
                  stroke="var(--card)"
                  strokeWidth={2}
                  style={{ pointerEvents: 'none' }}
                />
              ))
            : null}

          {/* Tooltip */}
          {hovered !== null && hoverIndex !== null ? (
            <foreignObject
              x={Math.max(pad.left, Math.min(hoverX - 80, chartWidth - 168))}
              y={Math.max(0, Math.min(...seriesPoints.map((s) => s.points[hoverIndex].y)) - 90)}
              width={160}
              height={86}
              style={{ pointerEvents: 'none' }}
            >
              <div className="rounded-xl border border-border/70 bg-card p-2.5 shadow-[var(--shadow-floating)] backdrop-blur-xl">
                <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">{hovered.label}</p>
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="size-1.5 rounded-full" style={{ background: s.stroke }} />
                      {s.name}
                    </span>
                    <span className="font-mono text-[10px] font-semibold tabular-nums text-foreground">
                      {formatCurrency(hovered[s.key])}
                    </span>
                  </div>
                ))}
              </div>
            </foreignObject>
          ) : null}
        </svg>
      ) : null}
    </div>
  )
}
