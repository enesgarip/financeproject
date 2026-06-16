import {
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
import { useChartWidth } from './useChartWidth'

export type BarDataPoint = {
  label: string
  value: number
  prevValue?: number
  color?: string
}

interface TooltipPayload {
  dataKey: string
  name: string
  value: number
  fill?: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-[140px] rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-floating)]">
      <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: entry.fill }} />
            {entry.name}
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
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

  return (
    <div ref={chartRef} className="min-w-0" style={{ height, minHeight: height }}>
      {chartWidth > 0 ? (
        <ReBarChart width={chartWidth} height={height} data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="32%">
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          strokeOpacity={0.5}
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          width={60}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `₺${(v / 1000).toFixed(0)}K` : `₺${v}`
          }
        />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Tooltip content={<CustomTooltip /> as any} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />

        <Bar dataKey="value" name="Tutar" radius={[6, 6, 0, 0]} animationDuration={600}>
          {data.map((entry) => (
            <Cell
              key={entry.label}
              fill={entry.color ?? (entry.value >= 0 ? positiveColor : negativeColor)}
              opacity={0.85}
            />
          ))}
        </Bar>

        {grouped && (
          <Bar
            dataKey="prevValue"
            name="Önceki Ay"
            radius={[6, 6, 0, 0]}
            fill="var(--muted-foreground)"
            opacity={0.4}
            animationDuration={600}
          />
        )}
      </ReBarChart>
      ) : null}
    </div>
  )
}

/** Sparkline — compact inline chart for trend display */
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
