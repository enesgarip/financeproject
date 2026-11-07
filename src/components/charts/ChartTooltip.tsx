import { useLayoutEffect, useRef, useState } from 'react'

type TooltipItem = { label: string; value: string; color?: string }

/** Doğal HTML yüksekliği: tutar/etiket sarılması SVG kırpma alanına bağlı değildir. */
export function ChartTooltip({ label, items, anchorX, anchorY, chartWidth, chartHeight }: {
  label: string
  items: TooltipItem[]
  anchorX: number
  anchorY: number
  chartWidth: number
  chartHeight: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const width = Math.min(280, Math.max(0, chartWidth - 16))
  const left = Math.max(8, Math.min(anchorX - width / 2, chartWidth - width - 8))
  const top = Math.max(8, Math.min(anchorY - tooltipHeight - 12, chartHeight - tooltipHeight - 8))

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTooltipHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-0 rounded-xl border border-line-strong bg-raised p-3 shadow-[var(--shadow-card)]"
      style={{ width, left, top, visibility: tooltipHeight ? 'visible' : 'hidden' }}
    >
      <p className="mb-2 break-words text-xs font-semibold text-ink-muted">{label}</p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="min-w-0">
            <div className="mb-0.5 flex items-start gap-1.5 text-xs text-ink-muted">
              {item.color ? <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: item.color }} /> : null}
              <span className="min-w-0 break-words">{item.label}</span>
            </div>
            <span className="block whitespace-nowrap font-mono text-xs font-semibold tabular-nums text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
