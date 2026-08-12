import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { useChartWidth } from './useChartWidth'
import { DEFAULT_PADDING, buildPathD, formatTickValue, niceScale } from './chartUtils'

export type LineSeriesConfig = {
  key: string
  name: string
  stroke: string
  connectNulls?: boolean
}

export type LineDataPoint = Record<string, string | number | null> & { label: string }

type LineChartProps = {
  data: LineDataPoint[]
  series: LineSeriesConfig[]
  height?: number
}

export function LineChart({ data, series, height = 260 }: LineChartProps) {
  const { formatAmount } = useBalancePrivacy()
  const [chartRef, chartWidth] = useChartWidth()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Erişilebilir ad + cümle özeti (CashFlowChart deseni, denetim §6). Boş nokta
  // "veri yok" olarak okunur — düz çizgi izlenimi görselde de yok (K17).
  const chartSummary = data
    .map((point) => {
      const parts = series.map((s) => {
        const value = point[s.key]
        return `${s.name} ${typeof value === 'number' ? formatAmount(value) : 'veri yok'}`
      })
      return `${point.label}: ${parts.join(', ')}`
    })
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

  const pad = { ...DEFAULT_PADDING, left: 66 }
  const plotW = chartWidth - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const allValues = data.flatMap((d) => series.map((s) => d[s.key]).filter((v): v is number => typeof v === 'number'))

  // Tüm değerler null ise Math.max(...[]) = -Infinity → NaN koordinatlı bozuk
  // SVG üretilirdi; boş-veri kutusuna düş (denetim 2026-08-12 G2).
  if (allValues.length === 0) {
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

  const ticks = niceScale(Math.min(0, ...allValues), Math.max(...allValues))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const yRange = yMax - yMin || 1

  const toX = (i: number) => pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const toY = (v: number) => pad.top + plotH - ((v - yMin) / yRange) * plotH

  const seriesData = series.map((s) => {
    const raw = data.map((d, i) => {
      const v = d[s.key]
      return typeof v === 'number' ? { x: toX(i), y: toY(v), value: v } : null
    })
    const validPoints = raw.filter((p): p is NonNullable<typeof p> => p !== null)
    // connectNulls=false: null noktalar çizgiyi BÖLER — veri boşluğu gerçek
    // boşluk olarak görünür. Eski hali null'ları filtreleyip tek kesintisiz
    // path çiziyordu; eksik ay gerçek trend gibi okunuyordu (K17).
    const segments: (typeof validPoints)[] = []
    if (s.connectNulls) {
      segments.push(validPoints)
    } else {
      let run: typeof validPoints = []
      for (const point of raw) {
        if (point === null) {
          if (run.length > 0) segments.push(run)
          run = []
        } else {
          run.push(point)
        }
      }
      if (run.length > 0) segments.push(run)
    }
    return { ...s, raw, validPoints, segments }
  })

  const hovered = hoverIndex !== null ? data[hoverIndex] : null
  const hoverX = hoverIndex !== null ? toX(hoverIndex) : 0

  return (
    <div
      ref={chartRef}
      role="img"
      aria-label={`Çizgi grafiği. ${chartSummary}`}
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

          {/* X axis labels — thin to avoid overlap */}
          {(() => {
            const charW = 6
            const maxLabelW = Math.max(...data.map((d) => d.label.length)) * charW + 12
            const step = Math.max(1, Math.ceil((data.length * maxLabelW) / Math.max(plotW, 1)))
            const visible = data.filter((_d, i) => i % step === 0 || i === data.length - 1)
            return visible.map((d) => {
              const idx = data.indexOf(d)
              return (
                <text
                  key={d.label}
                  x={toX(idx)}
                  y={height - 4}
                  textAnchor={idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle'}
                  fill="var(--muted-foreground)"
                  fontSize={11}
                >
                  {d.label}
                </text>
              )
            })
          })()}

          {/* Lines + dots */}
          {seriesData.map((s) => {
            const validPoints = s.validPoints
            return (
              <g key={s.key}>
                {s.segments
                  .filter((segment) => segment.length >= 2)
                  .map((segment, si) => (
                    <path
                      key={si}
                      d={buildPathD(segment)}
                      fill="none"
                      stroke={s.stroke}
                      strokeWidth={2.5}
                    />
                  ))}
                {validPoints.map((p, pi) => (
                  <circle
                    key={pi}
                    cx={p.x}
                    cy={p.y}
                    r={hoverIndex !== null && s.raw[hoverIndex] === p ? 5 : 3}
                    fill={s.stroke}
                    stroke="var(--card)"
                    strokeWidth={hoverIndex !== null && s.raw[hoverIndex] === p ? 2 : 0}
                  />
                ))}
              </g>
            )
          })}

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

          {/* Hover cursor line */}
          {hoverIndex !== null ? (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.25}
            />
          ) : null}

          {/* Tooltip */}
          {hovered !== null && hoverIndex !== null ? (
            <foreignObject
              x={Math.max(pad.left, Math.min(hoverX - 90, chartWidth - 188))}
              y={Math.max(0, pad.top)}
              width={180}
              height={24 + series.length * 20}
              style={{ pointerEvents: 'none' }}
            >
              <div className="rounded-xl border border-border/70 bg-card p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">{hovered.label}</p>
                {series.map((s) => {
                  const v = hovered[s.key]
                  if (v == null) return null
                  return (
                    <div key={s.key} className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.stroke }} />
                        <span className="truncate">{s.name}</span>
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        {formatAmount(v as number)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </foreignObject>
          ) : null}
        </svg>
      ) : null}
    </div>
  )
}
