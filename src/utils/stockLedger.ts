import type { StockTrade } from '../types/database'
import { roundTL } from './money'

/**
 * Hisse işlem defterinin (`stock_trades`) saf türetimi.
 *
 * Maliyet yöntemi AĞIRLIKLI ORTALAMA (varlık satırındaki `unit_cost` ile aynı
 * aile, altın defteriyle aynı kural): ortalama yalnız alışlardan türer; satış
 * elde kalanın maliyetini değiştirmez, o anki ortalamadan düşer ve farkı
 * GERÇEKLEŞMİŞ kâr/zarar olarak kaydeder. Fiyatı bilinmeyen açılış satırı
 * adette sayılır, maliyet tabanına girmez (gold_lots deseni).
 *
 * Komisyon: alışta maliyete eklenir, satışta hasılattan düşer.
 *
 * Dönem getirisi NAKİT-AKIŞ DÜZELTİLMİŞ: dönemde yapılan alım kazanç değildir.
 *   kazanç = V1 − V0 − alımlar + satışlar
 *   taban  = V0 + alımlar  (dönemde yatırımda duran para; BES getirisiyle aynı yaklaşım)
 * "Baştan beri" = V0 yok: kazanç = gerçekleşmiş + gerçekleşmemiş.
 *
 * Adet/fiyat 4 hane (para değil, miktar); TL toplamları money.ts ile yuvarlanır.
 */
export type StockTradeLike = Pick<StockTrade, 'symbol' | 'kind' | 'quantity' | 'unit_price' | 'fee' | 'trade_date'>

export type StockPosition = {
  symbol: string
  quantity: number
  /** Ortalama alış maliyeti (komisyon dahil); maliyeti bilinen alış yoksa null. */
  avgCost: number | null
  /** Elde kalan maliyeti bilinen adedin toplam maliyeti. */
  costBasis: number
  /** Maliyeti bilinmeyen (fiyatsız açılış) adet. */
  unknownCostQuantity: number
  realized: number
  buyCash: number
  sellCash: number
}

export type StockTradeRealized<TTrade extends StockTradeLike = StockTradeLike> = {
  trade: TTrade
  /** Yalnız satışlarda: hasılat − ortalama maliyet × adet. Fiyatsız satışta null. */
  realized: number | null
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function sortByDate<T extends StockTradeLike>(trades: T[]): T[] {
  return [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || kindOrder(a.kind) - kindOrder(b.kind))
}

// Aynı gün: açılış → alış → satış (satış, aynı günkü alışın üstüne oturur).
function kindOrder(kind: StockTradeLike['kind']): number {
  return kind === 'opening' ? 0 : kind === 'buy' ? 1 : 2
}

type Pool = { quantity: number; costPoolQty: number; costPool: number; unknownQty: number; realized: number; buyCash: number; sellCash: number }

function emptyPool(): Pool {
  return { quantity: 0, costPoolQty: 0, costPool: 0, unknownQty: 0, realized: 0, buyCash: 0, sellCash: 0 }
}

function applyTrade(pool: Pool, trade: StockTradeLike): number | null {
  const qty = Number(trade.quantity) || 0
  const fee = Number(trade.fee) || 0
  const price = trade.unit_price == null || !Number.isFinite(Number(trade.unit_price)) ? null : Number(trade.unit_price)

  if (trade.kind === 'sell') {
    const avg = pool.costPoolQty > 0 ? pool.costPool / pool.costPoolQty : 0
    // Satış önce maliyeti bilinen havuzdan, kalan fiyatsız adetten düşer.
    const removedKnown = Math.min(qty, pool.costPoolQty)
    const removedUnknown = Math.min(qty - removedKnown, pool.unknownQty)
    pool.costPool -= avg * removedKnown
    pool.costPoolQty -= removedKnown
    pool.unknownQty -= removedUnknown
    pool.quantity = Math.max(0, pool.quantity - qty)
    if (price === null) return null
    const proceeds = qty * price - fee
    pool.sellCash += proceeds
    // Fiyatsız adedin gerçekleşmiş kârı ölçülemez: yalnız bilinen kısım.
    const realized = removedKnown > 0 ? (removedKnown * price - fee * (removedKnown / qty)) - avg * removedKnown : 0
    pool.realized += realized
    return realized
  }

  pool.quantity += qty
  if (price === null) {
    pool.unknownQty += qty
    return null
  }
  pool.costPool += qty * price + fee
  pool.costPoolQty += qty
  pool.buyCash += qty * price + fee
  return null
}

function positionFromPool(symbol: string, pool: Pool): StockPosition {
  const avgCost = pool.costPoolQty > 0 ? round4(pool.costPool / pool.costPoolQty) : null
  return {
    symbol,
    quantity: round4(pool.quantity),
    avgCost,
    costBasis: roundTL(Math.max(0, pool.costPool)),
    unknownCostQuantity: round4(Math.max(0, pool.unknownQty)),
    realized: roundTL(pool.realized),
    buyCash: roundTL(pool.buyCash),
    sellCash: roundTL(pool.sellCash),
  }
}

/** Sembol başına pozisyon; `until` (dahil) verilirse o tarihe kadarki işlemler. */
export function projectStockPositions(trades: StockTradeLike[], until?: string | null): Map<string, StockPosition> {
  const pools = new Map<string, Pool>()
  for (const trade of sortByDate(trades)) {
    if (until && trade.trade_date > until) continue
    const pool = pools.get(trade.symbol) ?? emptyPool()
    pools.set(trade.symbol, pool)
    applyTrade(pool, trade)
  }
  const positions = new Map<string, StockPosition>()
  for (const [symbol, pool] of pools) positions.set(symbol, positionFromPool(symbol, pool))
  return positions
}

/** Her işlemi tarih sırasıyla, satışlara gerçekleşmiş K/Z iliştirerek döner. */
export function annotateRealized<TTrade extends StockTradeLike>(trades: TTrade[]): StockTradeRealized<TTrade>[] {
  const pools = new Map<string, Pool>()
  return sortByDate(trades).map((trade) => {
    const pool = pools.get(trade.symbol) ?? emptyPool()
    pools.set(trade.symbol, pool)
    const realized = applyTrade(pool, trade)
    return { trade, realized: trade.kind === 'sell' ? (realized === null ? null : roundTL(realized)) : null }
  })
}

export type SymbolValuation = {
  position: StockPosition
  price: number | null
  value: number | null
  unrealized: number | null
  unrealizedPct: number | null
}

/** Pozisyon + canlı fiyat → değer ve gerçekleşmemiş K/Z (fiyat yoksa null). */
export function valueStockPosition(position: StockPosition, price: number | null | undefined): SymbolValuation {
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { position, price: null, value: null, unrealized: null, unrealizedPct: null }
  }
  const value = roundTL(position.quantity * price)
  // Gerçekleşmemiş K/Z yalnız maliyeti bilinen adet üzerinden: fiyatsız açılış
  // adedinin "kârı" ölçülemez, sıfır sayılıp toplamı şişirmesin.
  const knownQty = Math.max(0, position.quantity - position.unknownCostQuantity)
  const unrealized = position.avgCost === null ? null : roundTL(knownQty * price - position.costBasis)
  const unrealizedPct = unrealized === null || position.costBasis <= 0 ? null : Math.round((unrealized / position.costBasis) * 10000) / 100
  return { position, price, value, unrealized, unrealizedPct }
}

export type StockPeriodPerformance = {
  start: string | null
  end: string
  startValue: number
  endValue: number
  buys: number
  sells: number
  gain: number
  gainPct: number | null
  /** Dönemdeki satışlardan gerçekleşen K/Z. */
  realized: number
  /** Dönem başında/sonunda fiyatı olmayan semboller — sonuç eksik demektir. */
  missingStartPrices: string[]
  missingEndPrices: string[]
}

/**
 * Nakit-akış düzeltilmiş dönem performansı. Dönem = (start, end]: start
 * günü sonundaki pozisyon başlangıç değeridir; start null = baştan beri.
 */
export function stockPeriodPerformance(
  trades: StockTradeLike[],
  options: {
    start?: string | null
    end: string
    pricesAtStart: Record<string, number | null | undefined>
    pricesAtEnd: Record<string, number | null | undefined>
  },
): StockPeriodPerformance {
  const start = options.start ?? null
  const end = options.end

  const missingStartPrices: string[] = []
  const missingEndPrices: string[] = []
  let startValue = 0
  if (start) {
    for (const position of projectStockPositions(trades, start).values()) {
      if (position.quantity <= 0) continue
      const price = options.pricesAtStart[position.symbol]
      if (price == null || !Number.isFinite(price) || price <= 0) {
        missingStartPrices.push(position.symbol)
        continue
      }
      startValue += position.quantity * price
    }
  }

  let endValue = 0
  for (const position of projectStockPositions(trades, end).values()) {
    if (position.quantity <= 0) continue
    const price = options.pricesAtEnd[position.symbol]
    if (price == null || !Number.isFinite(price) || price <= 0) {
      missingEndPrices.push(position.symbol)
      continue
    }
    endValue += position.quantity * price
  }

  let buys = 0
  let sells = 0
  let realized = 0
  for (const { trade, realized: tradeRealized } of annotateRealized(trades)) {
    if (trade.trade_date > end) continue
    if (start && trade.trade_date <= start) continue
    const price = trade.unit_price == null ? null : Number(trade.unit_price)
    if (price === null || !Number.isFinite(price)) continue
    const qty = Number(trade.quantity) || 0
    const fee = Number(trade.fee) || 0
    if (trade.kind === 'sell') {
      sells += qty * price - fee
      realized += tradeRealized ?? 0
    } else {
      buys += qty * price + fee
    }
  }

  const gain = roundTL(endValue - startValue - buys + sells)
  const base = startValue + buys
  return {
    start,
    end,
    startValue: roundTL(startValue),
    endValue: roundTL(endValue),
    buys: roundTL(buys),
    sells: roundTL(sells),
    gain,
    gainPct: base > 0 ? Math.round((gain / base) * 10000) / 100 : null,
    realized: roundTL(realized),
    missingStartPrices: missingStartPrices.sort(),
    missingEndPrices: missingEndPrices.sort(),
  }
}

export type StockCloseSeries = { t: number[]; c: (number | null)[] }

/** Verilen güne (dahil) kadarki son kapanış; seri boşsa/önceyse null. */
export function closeOnOrBefore(series: StockCloseSeries | null | undefined, date: string): number | null {
  if (!series || series.t.length === 0) return null
  const limit = Date.parse(`${date}T23:59:59+03:00`) / 1000
  let found: number | null = null
  for (let i = 0; i < series.t.length; i += 1) {
    if (series.t[i] > limit) break
    const close = series.c[i]
    if (close != null && Number.isFinite(close) && close > 0) found = close
  }
  return found
}

/** Yahoo `range` değeri: başlangıç tarihini kapsayan en küçük pencere. */
export function historyRangeFor(start: string, now: Date = new Date()): '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max' {
  const days = (now.getTime() - Date.parse(`${start}T00:00:00+03:00`)) / 86_400_000
  if (days <= 25) return '1mo'
  if (days <= 85) return '3mo'
  if (days <= 175) return '6mo'
  if (days <= 355) return '1y'
  if (days <= 720) return '2y'
  if (days <= 1800) return '5y'
  return 'max'
}

/** Defter projeksiyonu ile Varlıklar satırındaki adet arasındaki fark (sembol → defter − varlık). */
export function stockLedgerDrift(
  positions: Map<string, StockPosition>,
  assets: { symbol: string | null; amount: number }[],
): { symbol: string; ledger: number; asset: number }[] {
  const byAsset = new Map<string, number>()
  for (const asset of assets) {
    if (!asset.symbol) continue
    byAsset.set(asset.symbol, (byAsset.get(asset.symbol) ?? 0) + (Number(asset.amount) || 0))
  }
  const symbols = new Set([...positions.keys(), ...byAsset.keys()])
  const drift: { symbol: string; ledger: number; asset: number }[] = []
  for (const symbol of symbols) {
    const ledger = positions.get(symbol)?.quantity ?? 0
    const asset = byAsset.get(symbol) ?? 0
    if (Math.abs(ledger - asset) > 0.0001) drift.push({ symbol, ledger: round4(ledger), asset: round4(asset) })
  }
  return drift.sort((a, b) => a.symbol.localeCompare(b.symbol))
}
