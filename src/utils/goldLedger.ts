import type { GoldLot, GoldType } from '../types/database'

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

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

export function summarizeGoldType(lots: GoldLot[], goldType: GoldType): GoldTypeSummary {
  const rows = lots.filter((lot) => lot.gold_type === goldType)
  let totalQuantity = 0
  let knownQuantity = 0
  let knownCost = 0

  for (const lot of rows) {
    const qty = Number(lot.quantity) || 0
    totalQuantity += qty
    if (lot.unit_price != null && Number.isFinite(lot.unit_price)) {
      knownQuantity += qty
      knownCost += qty * lot.unit_price
    }
  }

  return {
    goldType,
    totalQuantity: round4(totalQuantity),
    knownQuantity: round4(knownQuantity),
    unknownQuantity: round4(totalQuantity - knownQuantity),
    knownCost: round2(knownCost),
    avgUnitCost: knownQuantity > 0 ? round2(knownCost / knownQuantity) : null,
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
  let cumulativeCost = 0
  const points: GoldAccumulationPoint[] = []

  for (const lot of dated) {
    cumulativeQuantity += Number(lot.quantity) || 0
    if (lot.unit_price != null && Number.isFinite(lot.unit_price)) {
      cumulativeCost += (Number(lot.quantity) || 0) * lot.unit_price
    }
    points.push({
      date: String(lot.purchase_date),
      cumulativeQuantity: round4(cumulativeQuantity),
      cumulativeCost: round2(cumulativeCost),
    })
  }

  return points
}
