/**
 * Aylık finansal özeti paylaşılabilir bir PNG kartına çizer (canvas).
 *
 * Gizlilik kuralı: kart çıktısı HESAP/BANKA/KİŞİ adı içermez — yalnız toplam
 * rakamlar ve kategori dağılımı. Sosyal paylaşım için güvenli olsun diye.
 * Retina netliği için canvas 2x ölçekte çizilir. `downloadShareableCard` PNG indirir.
 */
import type { CashFlowSummary } from './financeSummary'
import type { MonthlySummaryResult } from './monthlySummary'
import { roundTL } from './money'

type ShareableCardInput = {
  cashFlow: CashFlowSummary
  summary: MonthlySummaryResult
}

function formatTL(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(roundTL(value))
}

export function renderShareableCard(input: ShareableCardInput): HTMLCanvasElement {
  const { cashFlow, summary } = input
  const W = 720
  const H = 480
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.roundRect(16, 16, W - 32, H - 32, 20)
  ctx.fill()

  ctx.fillStyle = '#f8fafc'
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif'
  ctx.fillText(`${cashFlow.monthLabel} — Finansal Özet`, 40, 56)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '13px system-ui, -apple-system, sans-serif'
  ctx.fillText(`Oluşturulma: ${new Date().toLocaleDateString('tr-TR')}`, 40, 78)

  const statY = 108
  const statW = (W - 80 - 36) / 4

  const stats = [
    { label: 'GELİR', value: `${formatTL(cashFlow.income)} ₺`, color: '#22c55e' },
    { label: 'KART HARCAMASI', value: `${formatTL(summary.currentMonthTotal)} ₺`, color: '#ef4444' },
    { label: 'NAKİT ÇIKIŞI', value: `${formatTL(cashFlow.outflow)} ₺`, color: '#ef4444' },
    { label: 'NET NAKİT', value: `${cashFlow.netFlow >= 0 ? '+' : ''}${formatTL(cashFlow.netFlow)} ₺`, color: cashFlow.netFlow >= 0 ? '#22c55e' : '#ef4444' },
  ]

  stats.forEach((stat, i) => {
    const x = 40 + i * (statW + 12)
    ctx.fillStyle = '#334155'
    ctx.beginPath()
    ctx.roundRect(x, statY, statW, 68, 12)
    ctx.fill()

    ctx.fillStyle = '#94a3b8'
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif'
    ctx.fillText(stat.label, x + 14, statY + 22)

    ctx.fillStyle = stat.color
    ctx.font = 'bold 20px system-ui, -apple-system, sans-serif'
    ctx.fillText(stat.value, x + 14, statY + 50)
  })

  const catY = 200
  ctx.fillStyle = '#94a3b8'
  ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
  ctx.fillText('KATEGORİ DAĞILIMI', 40, catY)

  if (summary.changePercent !== null) {
    const changeText = `Geçen aya göre: ${summary.changePercent > 0 ? '+' : ''}%${summary.changePercent}`
    ctx.fillStyle = summary.changePercent > 0 ? '#ef4444' : '#22c55e'
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
    const changeWidth = ctx.measureText(changeText).width
    ctx.fillText(changeText, W - 40 - changeWidth, catY)
  }

  const barColors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4']
  const topCats = summary.categories.slice(0, 5)
  const maxAmount = topCats.length > 0 ? topCats[0].amount : 0

  topCats.forEach((cat, i) => {
    const y = catY + 16 + i * 38
    const barW = maxAmount > 0 ? ((W - 240) * cat.amount) / maxAmount : 0

    ctx.fillStyle = '#f8fafc'
    ctx.font = '13px system-ui, -apple-system, sans-serif'
    ctx.fillText(cat.category, 40, y + 14)

    ctx.fillStyle = barColors[i % barColors.length]
    ctx.beginPath()
    ctx.roundRect(160, y, barW, 20, 6)
    ctx.fill()

    ctx.fillStyle = '#f8fafc'
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif'
    const amountText = `${formatTL(cat.amount)} ₺ (%${cat.percentage})`
    const amountWidth = ctx.measureText(amountText).width
    ctx.fillText(amountText, W - 40 - amountWidth, y + 14)
  })

  const footY = H - 40
  ctx.fillStyle = '#475569'
  ctx.font = '11px system-ui, -apple-system, sans-serif'
  ctx.fillText('Kişisel finans özeti · Hesap/banka/kişi adı içermez', 40, footY)

  return canvas
}

export function downloadShareableCard(canvas: HTMLCanvasElement, monthLabel: string) {
  const url = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = url
  link.download = `finansal-ozet-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.png`
  link.click()
}
