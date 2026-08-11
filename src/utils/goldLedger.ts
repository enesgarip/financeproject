import type { GoldLot, GoldType } from '../types/database'
import { roundTL as round2 } from './money'

/**
 * Pure aggregation over the gold purchase ledger (`gold_lots`).
 *
 * Lots without a `unit_price` (cost unknown) still count toward the held
 * quantity but are excluded from cost-basis math, so the average cost reflects
 * only what was actually paid. Side-effect-free and unit-testable.
 */

export const GOLD_TYPE_LABELS: Record<GoldType, string> = {
  gram: 'Gram altın',
  ceyrek: 'Çeyrek altın',
}

export const GOLD_LEDGER_SOURCE = 'gold_ledger'

export const GOLD_TYPE_ASSET_NAME: Record<GoldType, string> = {
  gram: 'Altın Defteri - Gram',
  ceyrek: 'Altın Defteri - Çeyrek',
}

/** Asset unit used by the managed aggregate row for each gold type. */
export const GOLD_TYPE_UNIT: Record<GoldType, 'gram' | 'adet'> = {
  gram: 'gram',
  ceyrek: 'adet',
}

export type GoldTypeSummary = {
  goldType: GoldType
  totalQuantity: number
  knownQuantity: number
  unknownQuantity: number
  knownCost: number
  /** Average cost per unit across lots with a known price; null when none. */
  avgUnitCost: number | null
}

// Gram altın miktarı (TL değil), 4 hane — money.ts'e bağlama; miktar precision (Faz C).
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

export function summarizeGoldType(lots: GoldLot[], goldType: GoldType): GoldTypeSummary {
  const rows = lots.filter((lot) => lot.gold_type === goldType)
  let totalQuantity = 0
  let knownQuantity = 0
  // Ağırlıklı ortalama maliyet yöntemi: ortalama YALNIZ alışlardan türetilir.
  // Satış elde kalanın maliyetini değiştirmez (satış fiyatı ortalamaya karışırsa,
  // kârlı satış kalan altının maliyetini yapay düşürüp k/z'yi şişirir).
  let buyQuantity = 0
  let buyCost = 0

  for (const lot of rows) {
    const qty = Number(lot.quantity) || 0
    if (lot.direction === 'sell') {
      // Satış fiyatının bilinip bilinmemesi maliyet tabanını İLGİLENDİRMEZ:
      // satılan altın elden çıkar ve bilinen-maliyetli havuzdan düşer. Eski
      // sürüm fiyatsız satışı atlıyordu → knownCost elde kalandan fazla
      // miktar üzerinden hesaplanıp şişiyordu (denetim 2026-08-12 O1).
      // Clamp DÖNGÜ SONUNDA (heldKnownQuantity): satırlar tarih sırasında
      // gelmeyebilir, ara clamp satışı yutar.
      totalQuantity -= qty
      knownQuantity -= qty
    } else {
      totalQuantity += qty
      if (lot.unit_price != null && Number.isFinite(lot.unit_price)) {
        knownQuantity += qty
        buyQuantity += qty
        buyCost += qty * lot.unit_price
      }
    }
  }

  const avgUnitCost = buyQuantity > 0 ? round2(buyCost / buyQuantity) : null
  const heldKnownQuantity = Math.max(0, knownQuantity)
  // Elde kalan bilinen-maliyetli miktarın maliyet tabanı = ortalama alış × kalan adet.
  const knownCost = avgUnitCost != null ? round2(avgUnitCost * heldKnownQuantity) : 0

  return {
    goldType,
    totalQuantity: round4(Math.max(0, totalQuantity)),
    knownQuantity: round4(heldKnownQuantity),
    unknownQuantity: round4(Math.max(0, totalQuantity - knownQuantity)),
    knownCost,
    avgUnitCost,
  }
}

/** One summary per gold type that has at least one lot, in stable order. */
export function summarizeGold(lots: GoldLot[]): GoldTypeSummary[] {
  const order: GoldType[] = ['gram', 'ceyrek']
  return order
    .filter((type) => lots.some((lot) => lot.gold_type === type))
    .map((type) => summarizeGoldType(lots, type))
}

export type GoldAccumulationPoint = {
  date: string
  cumulativeQuantity: number
  cumulativeCost: number
}

/**
 * Cumulative quantity/cost over time for the accumulation chart. Only dated
 * lots are plotted (undated lots can't be placed on a timeline). When
 * `goldType` is omitted, all types are combined.
 */
export function buildGoldAccumulation(lots: GoldLot[], goldType?: GoldType): GoldAccumulationPoint[] {
  const dated = lots
    .filter((lot) => lot.purchase_date && (!goldType || lot.gold_type === goldType))
    .sort((a, b) => String(a.purchase_date).localeCompare(String(b.purchase_date)))

  let cumulativeQuantity = 0
  // Maliyet havuzu ağırlıklı ortalama ile yürütülür: satış, maliyeti o anki
  // ortalamadan düşer (satış fiyatından değil) — özet ile aynı yöntem.
  let costPoolQuantity = 0
  let costPool = 0
  const points: GoldAccumulationPoint[] = []

  for (const lot of dated) {
    const qty = Number(lot.quantity) || 0
    const isSell = lot.direction === 'sell'
    cumulativeQuantity += qty * (isSell ? -1 : 1)
    if (isSell) {
      // Satışta fiyat bilgisi gereksiz: maliyet havuzundan her zaman o anki
      // ortalama maliyet düşer (fiyatsız satış da havuzu küçültür — O1).
      const avg = costPoolQuantity > 0 ? costPool / costPoolQuantity : 0
      const removed = Math.min(qty, costPoolQuantity)
      costPool -= avg * removed
      costPoolQuantity -= removed
    } else if (lot.unit_price != null && Number.isFinite(lot.unit_price)) {
      costPool += qty * lot.unit_price
      costPoolQuantity += qty
    }
    points.push({
      date: String(lot.purchase_date),
      cumulativeQuantity: round4(cumulativeQuantity),
      cumulativeCost: round2(Math.max(0, costPool)),
    })
  }

  return points
}
