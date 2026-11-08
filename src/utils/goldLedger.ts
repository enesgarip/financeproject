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

type GoldPool = { totalQuantity: number; knownQuantity: number; knownCost: number }

function sortedLots(lots: GoldLot[]): GoldLot[] {
  // Undated opening holdings precede dated trades; same-day buys precede sells.
  return [...lots].sort((a, b) => (a.purchase_date ?? '').localeCompare(b.purchase_date ?? '') ||
    Number(a.direction === 'sell') - Number(b.direction === 'sell') ||
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

function applyLot(pool: GoldPool, lot: GoldLot) {
  const qty = Number(lot.quantity) || 0
  if (lot.direction === 'sell') {
    const removed = Math.min(qty, pool.knownQuantity)
    const average = pool.knownQuantity > 0 ? pool.knownCost / pool.knownQuantity : 0
    pool.knownCost = Math.max(0, pool.knownCost - average * removed)
    pool.knownQuantity -= removed
    pool.totalQuantity = round4(pool.totalQuantity - qty)
  } else {
    pool.totalQuantity += qty
    if (lot.unit_price != null && Number.isFinite(lot.unit_price)) {
      pool.knownQuantity += qty
      pool.knownCost += qty * lot.unit_price
    }
  }
}

export function summarizeGoldType(lots: GoldLot[], goldType: GoldType): GoldTypeSummary {
  const pool: GoldPool = { totalQuantity: 0, knownQuantity: 0, knownCost: 0 }
  for (const lot of sortedLots(lots.filter((row) => row.gold_type === goldType))) applyLot(pool, lot)
  return {
    goldType,
    totalQuantity: round4(pool.totalQuantity),
    knownQuantity: round4(pool.knownQuantity),
    unknownQuantity: round4(Math.max(0, pool.totalQuantity - pool.knownQuantity)),
    knownCost: round2(pool.knownCost),
    avgUnitCost: pool.knownQuantity > 0 ? round2(pool.knownCost / pool.knownQuantity) : null,
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
  const dated = sortedLots(lots.filter((lot) => lot.purchase_date && (!goldType || lot.gold_type === goldType)))
  const pools = new Map<GoldType, GoldPool>()
  return dated.map((lot) => {
    const pool = pools.get(lot.gold_type) ?? { totalQuantity: 0, knownQuantity: 0, knownCost: 0 }
    pools.set(lot.gold_type, pool)
    applyLot(pool, lot)
    const values = [...pools.values()]
    return {
      date: String(lot.purchase_date),
      cumulativeQuantity: round4(values.reduce((total, row) => total + row.totalQuantity, 0)),
      cumulativeCost: round2(values.reduce((total, row) => total + row.knownCost, 0)),
    }
  })
}

/** SQL deferred constraint ile aynı tarih/yön/kimlik sırası. */
export function validateGoldInventory(lots: GoldLot[]): string | null {
  const balance = new Map<GoldType, number>()
  for (const lot of sortedLots(lots)) {
    if (!Number.isFinite(lot.quantity) || lot.quantity <= 0) return 'Altın miktarı sıfırdan büyük olmalı.'
    const next = (balance.get(lot.gold_type) ?? 0) + Math.round(lot.quantity * 10000) * (lot.direction === 'sell' ? -1 : 1)
    if (next < 0) return `${GOLD_TYPE_LABELS[lot.gold_type]}: ${lot.purchase_date ?? 'tarihsiz'} işleminde stok eksiye düşüyor. Sonraki satışları korumak için miktar, tarih ve türü kontrol et.`
    balance.set(lot.gold_type, next)
  }
  return null
}
