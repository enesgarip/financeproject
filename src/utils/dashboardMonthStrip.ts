/**
 * "Ay şeridi" — Özet ekranının tek YENİ türetilmiş değeri (Şerit tasarımı, `2a`).
 * Kalan ayı bir zaman çizgisi olarak okutur: bugünden ay sonuna kadar her vade,
 * gününe konumlandırılmış bir çubuk olur; yüksekliği tutarını, rengi tipini verir.
 *
 * Pencere kasıtlı olarak "önümüzdeki 30 gün" DEĞİL, **bugünden ay sonuna**:
 * şeridin üstündeki kahraman rakam "ay sonuna kalan" ve başlık "10 / 31 gün"
 * diyor — 30 günlük pencere şeridi bir sonraki aya taşırıp ikisini çelişkiye
 * düşürüyordu. 30 günlük liste ayrı bileşen (vadeler tablosu).
 *
 * Burada renk YOK: tip adı domain'de kalır (`statement`/`installment`/...),
 * token eşlemesi sunum katmanının işi.
 */
import { endOfMonth, startOfDay } from './date'

export type MonthStripTone = 'statement' | 'installment' | 'planned' | 'income'

export type MonthStripInput = {
  id: string
  title: string
  amount: number
  /** Vade tarihi — yerel gün başlangıcı (`Date.getTime()`). */
  sortTime: number
  tone: MonthStripTone
}

export type MonthStripMark = MonthStripInput & {
  /** Ayın günü (1–31). */
  day: number
  /** Şeritteki yatay konum, %. */
  positionPct: number
  /** Çubuk yüksekliği, %. Penceredeki en büyük tutara göre ölçeklenir. */
  heightPct: number
}

export type MonthStrip = {
  startDay: number
  endDay: number
  /** Eksende gösterilecek 5 gün etiketi. */
  axis: number[]
  marks: MonthStripMark[]
}

/** Kuruş mertebesindeki bir vade bile şeritte görünür kalsın diye taban yükseklik. */
const MIN_HEIGHT_PCT = 12
const AXIS_TICKS = 5

/**
 * Ham yükümlülük tipini şeridin dört sinyalinden birine indirir. Lejant dört
 * maddeliktir; yeni bir yükümlülük tipi eklenirse burada bir kovaya düşmeli,
 * beşinci renk açılmamalı.
 */
export function monthStripTone(kind: string): MonthStripTone {
  if (kind === 'card_statement' || kind === 'card_debt') return 'statement'
  if (kind === 'card_installment' || kind === 'loan_installment' || kind === 'legacy_loan_installment') {
    return 'installment'
  }
  if (kind === 'salary' || kind === 'personal_receivable') return 'income'
  return 'planned'
}

export function buildMonthStrip(items: MonthStripInput[], from = new Date()): MonthStrip {
  const today = startOfDay(from)
  const startDay = today.getDate()
  const endDay = endOfMonth(from).getDate()
  const lastTime = startOfDay(endOfMonth(from)).getTime()

  const inWindow = items.filter((item) => item.sortTime >= today.getTime() && item.sortTime <= lastTime)
  const maxAmount = inWindow.reduce((max, item) => Math.max(max, Math.abs(item.amount)), 0)
  const span = endDay - startDay

  const marks = inWindow
    .map((item) => {
      const day = new Date(item.sortTime).getDate()
      return {
        ...item,
        day,
        // Ayın son günündeysek (span 0) tek çubuk ortalanır; 0'a bölmek NaN verirdi.
        positionPct: span === 0 ? 50 : ((day - startDay) / span) * 100,
        heightPct:
          maxAmount === 0
            ? MIN_HEIGHT_PCT
            : Math.max(MIN_HEIGHT_PCT, (Math.abs(item.amount) / maxAmount) * 100),
      }
    })
    .sort((a, b) => a.sortTime - b.sortTime)

  const axis: number[] = []
  for (let index = 0; index < AXIS_TICKS; index += 1) {
    const day = Math.round(startDay + (span * index) / (AXIS_TICKS - 1))
    if (!axis.includes(day)) axis.push(day)
  }

  return { startDay, endDay, axis, marks }
}
