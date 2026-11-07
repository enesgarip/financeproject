import { formatCompactCurrency } from '@/utils/formatCurrency'

export type Padding = { top: number; right: number; bottom: number; left: number }

export const DEFAULT_PADDING: Padding = { top: 12, right: 12, left: 60, bottom: 32 }

/** 12px eksen yazısı için korumalı genişlik; veri noktaları seyreltilmez. */
export const axisTextWidth = (text: string) => Array.from(text).length * 8

export function chartPadding(ticks: number[]): Padding {
  return { ...DEFAULT_PADDING, left: Math.max(44, ...ticks.map(tick => axisTextWidth(formatTickValue(tick)) + 16)) }
}

/** Gerçek konumları karşılaştırır; son etiketi eklemek komşusunu ezemez. */
export function xAxisLabels(labels: string[], positions: number[], left: number, right: number) {
  const available = Math.max(1, right - left)
  const candidates = labels.map((label, index) => {
    const maxChars = Math.max(1, Math.floor(available / 8))
    const text = Array.from(label).length > maxChars ? `${Array.from(label).slice(0, Math.max(0, maxChars - 1)).join('')}…` : label
    const width = axisTextWidth(text)
    const x = Math.max(left, Math.min(positions[index] - width / 2, right - width))
    return { index, text, x, end: x + width }
  })
  if (candidates.length < 2) return candidates
  const first = candidates[0]
  const last = candidates[candidates.length - 1]
  if (first.end + 12 > last.x) return [first]
  const visible = [first]
  for (const candidate of candidates.slice(1, -1)) {
    if (candidate.x >= visible[visible.length - 1].end + 12 && candidate.end + 12 <= last.x) visible.push(candidate)
  }
  return [...visible, last]
}

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

/** Eksen etiketi ortak kısa TL biçimini kullanır (bkz. formatCompactCurrency). */
export const formatTickValue = formatCompactCurrency

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
