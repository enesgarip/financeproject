import { expect, it } from 'vitest'
import { chartPadding, xAxisLabels } from './chartUtils'

it('dar ekranda uzun ve son etiketleri çakıştırmaz, tüm etiketler sınırlar içinde kalır', () => {
  for (const width of [180, 240, 320, 390, 800]) {
    for (const count of [1, 2, 6, 12, 30]) {
      const labels = Array.from({ length: count }, (_, i) => `${i + 1} Kasım 2026`)
      const positions = labels.map((_, i) => 60 + i * (width - 72) / Math.max(1, count - 1))
      const visible = xAxisLabels(labels, positions, 60, width - 12)
      for (const [i, label] of visible.entries()) {
        expect(label.x).toBeGreaterThanOrEqual(60)
        expect(label.end).toBeLessThanOrEqual(width - 12)
        if (i) expect(label.x - visible[i - 1].end).toBeGreaterThanOrEqual(12)
      }
    }
  }
})

it('uzun Y ekseni tutarına yeterli boşluk ayırır', () => {
  expect(chartPadding([-999_000_000_000, 0, 999_000_000_000]).left).toBeGreaterThan(chartPadding([0, 10]).left)
})
