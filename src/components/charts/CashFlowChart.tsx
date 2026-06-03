import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
import { useChartWidth } from './useChartWidth'

export type CashFlowPoint = {
  label: string
  income: number
  outflow: number
  net: number
}

interface TooltipPayload {
  dataKey: string
  name: string
  value: number
  fill?: string
  stroke?: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-[160px] rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-floating)] backdrop-blur-xl">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      {payload.map((entry) => {
        const colorMap: Record<string, string> = {
          income:  'var(--success)',
          outflow: 'var(--destructive)',
          net:     'var(--primary)',
        }
        const color = colorMap[entry.dataKey] ?? 'var(--foreground)'
        return (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full" style={{ background: color }} />
              {entry.name}
            </span>
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {formatCurrency(entry.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

type CashFlowChartProps = {
  data: CashFlowPoint[]
  height?: number
}

export function CashFlowChart({ data, height = 220 }: CashFlowChartProps) {
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
        <AreaChart width={chartWidth} height={height} data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--success)"     stopOpacity={0.22} />
            <stop offset="95%" stopColor="var(--success)"     stopOpacity={0} />
          </linearGradient>
          <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--destructive)" stopOpacity={0.18} />
            <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--primary)"     stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--primary)"     stopOpacity={0} />
          </linearGradient>
        </defs>

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
        <Tooltip content={<CustomTooltip /> as any} />

        <Area
          type="monotone"
          dataKey="income"
          name="Gelir"
          stroke="var(--success)"
          strokeWidth={2}
          fill="url(#incomeGrad)"
          dot={false}
          activeDot={{ r: 4, fill: 'var(--success)', stroke: 'var(--card)', strokeWidth: 2 }}
        />
        <Area
          type="monotone"
          dataKey="outflow"
          name="Gider"
          stroke="var(--destructive)"
          strokeWidth={2}
          fill="url(#outflowGrad)"
          dot={false}
          activeDot={{ r: 4, fill: 'var(--destructive)', stroke: 'var(--card)', strokeWidth: 2 }}
        />
        <Area
          type="monotone"
          dataKey="net"
          name="Net"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="5 3"
          fill="url(#netGrad)"
          dot={false}
          activeDot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--card)', strokeWidth: 2 }}
        />
      </AreaChart>
      ) : null}
    </div>
  )
}
