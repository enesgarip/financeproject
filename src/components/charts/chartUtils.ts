export type Padding = { top: number; right: number; bottom: number; left: number }

export const DEFAULT_PADDING: Padding = { top: 8, right: 8, left: 60, bottom: 28 }

export function niceScale(min: number, max: number, ticks = 5): number[] {
  if (min === max) {
    const v = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= v
    max += v
  }
  const range = max - min
  const roughStep = range / (ticks - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / mag
  const niceStep = residual <= 1.5 ? mag : residual <= 3 ? 2 * mag : residual <= 7 ? 5 * mag : 10 * mag

  const niceMin = Math.floor(min / niceStep) * niceStep
  const niceMax = Math.ceil(max / niceStep) * niceStep
  const result: number[] = []
  for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
    result.push(Math.round(v * 1e6) / 1e6)
  }
  return result
}

export function formatTickValue(v: number): string {
  if (Math.abs(v) >= 1000) return `₺${(v / 1000).toFixed(0)}K`
  return `₺${v}`
}

export function buildPathD(points: { x: number; y: number }[], smooth = true): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (!smooth) return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const cpx = (prev.x + curr.x) / 2
    d += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
  }
  return d
}

export function buildAreaD(points: { x: number; y: number }[], baseline: number, smooth = true): string {
  if (points.length === 0) return ''
  const line = buildPathD(points, smooth)
  const last = points[points.length - 1]
  const first = points[0]
  return `${line} L ${last.x.toFixed(1)} ${baseline.toFixed(1)} L ${first.x.toFixed(1)} ${baseline.toFixed(1)} Z`
}
