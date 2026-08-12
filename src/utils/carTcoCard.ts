import type { CarSummary } from './carExpenses'
import { roundTL } from './money'

function formatTL(value: number): string {
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(roundTL(value))} ₺`
}

/**
 * Kilometre başına maliyet için 2 ondalık. ₺/km tek haneli bir sayıdır (ör.
 * 2,45); tam sayıya yuvarlanınca "2 ₺/km" oluyordu ve %20'ye varan fark
 * görünmez kalıyordu — yıllık toplamla aynı biçimi paylaşamaz.
 */
function formatRateTL(value: number): string {
  return `${new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundTL(value))} ₺`
}

export function renderCarTcoCard(summary: CarSummary, year: number = new Date().getFullYear()): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 1440
  canvas.height = 960
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  const width = 720
  const height = 480
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(20, 20, width - 40, height - 40, 24); ctx.fill()
  ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 28px system-ui'; ctx.fillText(`${year} Araç Maliyet Karnesi`, 48, 72)
  ctx.fillStyle = '#94a3b8'; ctx.font = '16px system-ui'; ctx.fillText('Toplam sahip olma maliyeti · saf gider raporu', 48, 100)

  const stats = [
    ['YILLIK TOPLAM', formatTL(summary.yearTotal)],
    ['GÜNLÜK MALİYET', `${formatTL(summary.costPerDay)} / gün`],
    ['YAKIT MALİYETİ', summary.fuel.costPerKm == null ? 'Ölçüm bekliyor' : `${formatRateTL(summary.fuel.costPerKm)} / km`],
  ]
  stats.forEach(([label, value], index) => {
    const x = 48 + index * 210
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.roundRect(x, 132, 192, 92, 14); ctx.fill()
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px system-ui'; ctx.fillText(label, x + 16, 160)
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 20px system-ui'; ctx.fillText(value, x + 16, 196)
  })

  ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 12px system-ui'; ctx.fillText('EN BÜYÜK GİDERLER', 48, 270)
  const max = summary.categories[0]?.total ?? 0
  summary.categories.slice(0, 4).forEach((category, index) => {
    const y = 292 + index * 36
    ctx.fillStyle = '#f8fafc'; ctx.font = '14px system-ui'; ctx.fillText(category.category, 48, y + 15)
    ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.roundRect(190, y, max > 0 ? (300 * category.total) / max : 0, 20, 6); ctx.fill()
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 13px system-ui'; ctx.fillText(formatTL(category.total), 520, y + 15)
  })
  ctx.fillStyle = '#475569'; ctx.font = '11px system-ui'; ctx.fillText('Araç/plaka ve hesap bilgisi içermez · FinanceProject', 48, height - 36)
  return canvas
}

export function downloadCarTcoCard(canvas: HTMLCanvasElement, year: number) {
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `arac-maliyet-karnesi-${year}.png`
  link.click()
}
