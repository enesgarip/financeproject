import { describe, expect, it } from 'vitest'
import {
  annotateRealized,
  closeOnOrBefore,
  historyRangeFor,
  projectStockPositions,
  stockLedgerDrift,
  stockPeriodPerformance,
  valueStockPosition,
  type StockTradeLike,
} from './stockLedger'

function t(symbol: string, kind: StockTradeLike['kind'], trade_date: string, quantity: number, unit_price: number | null, fee = 0): StockTradeLike {
  return { symbol, kind, trade_date, quantity, unit_price, fee }
}

const thyao = [
  t('THYAO', 'buy', '2026-01-10', 100, 250, 10), // maliyet 25.010
  t('THYAO', 'buy', '2026-03-05', 50, 310, 5), // havuz 40.515 / 150 = 270,10
  t('THYAO', 'sell', '2026-06-01', 60, 330, 6), // hasılat 19.794; maliyet 60×270,1 = 16.206 → +3.588
]

describe('projectStockPositions', () => {
  it('runs a weighted-average cost pool; sells realize against the running average', () => {
    const pos = projectStockPositions(thyao).get('THYAO')!
    expect(pos.quantity).toBe(90)
    expect(pos.avgCost).toBe(270.1)
    expect(pos.costBasis).toBe(24309) // 90 × 270,10
    expect(pos.realized).toBe(3588)
    expect(pos.buyCash).toBe(40515)
    expect(pos.sellCash).toBe(19794)
  })

  it('projects as of a date (inclusive) and orders same-day opening → buy → sell', () => {
    const asOfMarch = projectStockPositions(thyao, '2026-03-05').get('THYAO')!
    expect(asOfMarch.quantity).toBe(150)
    expect(asOfMarch.realized).toBe(0)

    const sameDay = [t('X', 'sell', '2026-02-01', 5, 20), t('X', 'buy', '2026-02-01', 10, 10)]
    const pos = projectStockPositions(sameDay).get('X')!
    expect(pos.quantity).toBe(5)
    expect(pos.realized).toBe(50)
  })

  it('keeps priceless opening quantity out of the cost basis', () => {
    const trades = [t('A', 'opening', '2026-01-01', 40, null), t('A', 'buy', '2026-02-01', 10, 100)]
    const pos = projectStockPositions(trades).get('A')!
    expect(pos.quantity).toBe(50)
    expect(pos.unknownCostQuantity).toBe(40)
    expect(pos.avgCost).toBe(100)
    expect(pos.costBasis).toBe(1000)
  })
})

describe('annotateRealized', () => {
  it('attaches realized P&L only to sells', () => {
    const rows = annotateRealized(thyao)
    expect(rows.map((row) => row.realized)).toEqual([null, null, 3588])
  })

  it('returns null realized for a priceless sell', () => {
    const rows = annotateRealized([t('A', 'buy', '2026-01-01', 10, 10), t('A', 'sell', '2026-02-01', 5, null)])
    expect(rows[1].realized).toBeNull()
  })
})

describe('valueStockPosition', () => {
  it('values the position and computes unrealized over the known-cost quantity', () => {
    const pos = projectStockPositions(thyao).get('THYAO')!
    const v = valueStockPosition(pos, 300)
    expect(v.value).toBe(27000)
    expect(v.unrealized).toBe(2691) // 27.000 − 24.309
    expect(v.unrealizedPct).toBe(11.07)
  })

  it('returns nulls when no price is known', () => {
    const pos = projectStockPositions(thyao).get('THYAO')!
    const v = valueStockPosition(pos, null)
    expect(v.value).toBeNull()
    expect(v.unrealized).toBeNull()
  })
})

describe('stockPeriodPerformance', () => {
  it('since inception equals realized + unrealized', () => {
    const perf = stockPeriodPerformance(thyao, { end: '2026-09-08', pricesAtStart: {}, pricesAtEnd: { THYAO: 300 } })
    expect(perf.startValue).toBe(0)
    expect(perf.endValue).toBe(27000)
    expect(perf.buys).toBe(40515)
    expect(perf.sells).toBe(19794)
    expect(perf.gain).toBe(6279) // 3.588 gerçekleşmiş + 2.691 gerçekleşmemiş
    expect(perf.realized).toBe(3588)
    expect(perf.gainPct).toBe(15.5) // 6.279 / 40.515
  })

  it('adjusts a window for cash flows so a purchase inside the period is not counted as gain', () => {
    // Dönem (2026-02-01, 2026-09-08]: başta 100 adet × 260 = 26.000.
    const perf = stockPeriodPerformance(thyao, {
      start: '2026-02-01',
      end: '2026-09-08',
      pricesAtStart: { THYAO: 260 },
      pricesAtEnd: { THYAO: 300 },
    })
    expect(perf.startValue).toBe(26000)
    expect(perf.buys).toBe(15505) // yalnız Mart alımı
    expect(perf.sells).toBe(19794)
    expect(perf.gain).toBe(5289) // 27.000 − 26.000 − 15.505 + 19.794
    expect(perf.gainPct).toBe(12.74) // 5.289 / 41.505
    expect(perf.realized).toBe(3588)
  })

  it('reports symbols without a start/end price instead of silently dropping value', () => {
    const perf = stockPeriodPerformance(thyao, { start: '2026-02-01', end: '2026-09-08', pricesAtStart: {}, pricesAtEnd: {} })
    expect(perf.missingStartPrices).toEqual(['THYAO'])
    expect(perf.missingEndPrices).toEqual(['THYAO'])
  })
})

describe('closeOnOrBefore / historyRangeFor', () => {
  const day = (d: string) => Date.parse(`${d}T10:00:00+03:00`) / 1000
  const series = { t: [day('2026-03-02'), day('2026-03-03'), day('2026-03-04')], c: [10, null, 12] }

  it('picks the last valid close on or before the day', () => {
    expect(closeOnOrBefore(series, '2026-03-03')).toBe(10)
    expect(closeOnOrBefore(series, '2026-03-04')).toBe(12)
    expect(closeOnOrBefore(series, '2026-03-01')).toBeNull()
    expect(closeOnOrBefore(null, '2026-03-01')).toBeNull()
  })

  it('maps a start date to the smallest covering Yahoo range', () => {
    const now = new Date('2026-09-08T12:00:00+03:00')
    expect(historyRangeFor('2026-09-01', now)).toBe('1mo')
    expect(historyRangeFor('2026-07-01', now)).toBe('3mo')
    expect(historyRangeFor('2026-01-01', now)).toBe('1y')
    expect(historyRangeFor('2020-01-01', now)).toBe('max')
  })
})

describe('stockLedgerDrift', () => {
  it('lists symbols whose ledger quantity differs from the assets row', () => {
    const positions = projectStockPositions(thyao)
    expect(stockLedgerDrift(positions, [{ symbol: 'THYAO', amount: 90 }])).toEqual([])
    expect(stockLedgerDrift(positions, [{ symbol: 'THYAO', amount: 100 }, { symbol: 'ASELS', amount: 5 }])).toEqual([
      { symbol: 'ASELS', ledger: 0, asset: 5 },
      { symbol: 'THYAO', ledger: 90, asset: 100 },
    ])
  })
})
