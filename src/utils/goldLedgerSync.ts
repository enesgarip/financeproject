import {
  deleteGoldLedgerAsset,
  fetchGoldLedgerAssets,
  insertGoldLedgerAsset,
  updateGoldLedgerAsset,
} from '../data/repositories/goldLedgerRepo'
import type { Result } from '../data/result'
import type { Asset, GoldLot, GoldType, InsertFor, UpdateFor } from '../types/database'
import {
  GOLD_LEDGER_SOURCE,
  GOLD_TYPE_ASSET_NAME,
  GOLD_TYPE_UNIT,
  summarizeGold,
  type GoldTypeSummary,
} from './goldLedger'
import type { MarketRatesSnapshot } from './marketRates'
import { moneyDiffers, roundTL as round2 } from './money'
import { valueAsset } from './valuation'

export type GoldLedgerAssetSyncResult = {
  inserted: number
  updated: number
  deleted: number
}

function unwrap<T>(result: Result<T>, context: string): T {
  if (!result.ok) throw new Error(`${context}: ${result.error.message}`)
  return result.data
}

function quantityLabel(summary: GoldTypeSummary): string {
  const unit = summary.goldType === 'gram' ? 'gr' : 'adet'
  return `${summary.totalQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${unit}`
}

function noteForSummary(summary: GoldTypeSummary): string {
  const unknown = summary.unknownQuantity
  const missing = unknown > 0
    ? `${unknown.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${summary.goldType === 'gram' ? 'gr' : 'adet'} maliyeti kayıtsız.`
    : 'Tüm işlem maliyetleri kayıtlı.'
  return `Altın defterinden otomatik yönetiliyor. Toplam: ${quantityLabel(summary)}. ${missing}`
}

function currentValue(summary: GoldTypeSummary, snapshot: MarketRatesSnapshot | null, fallbackValue: number | null | undefined): number {
  const liveValue = valueAsset(
    {
      category: 'Altın',
      unit: GOLD_TYPE_UNIT[summary.goldType],
      currency: null,
      amount: summary.totalQuantity,
    },
    snapshot,
  )
  return liveValue ?? fallbackValue ?? summary.knownCost
}

function goldTypeFromAsset(asset: Pick<Asset, 'category' | 'unit'>): GoldType | null {
  if (asset.category !== 'Altın') return null
  if (asset.unit === 'gram') return 'gram'
  if (asset.unit === 'adet') return 'ceyrek'
  return null
}

export function buildGoldLedgerAssetPayload(
  summary: GoldTypeSummary,
  userId: string,
  snapshot: MarketRatesSnapshot | null,
  fallbackValue?: number | null,
): InsertFor<'assets'> {
  return {
    user_id: userId,
    name: GOLD_TYPE_ASSET_NAME[summary.goldType],
    category: 'Altın',
    amount: summary.totalQuantity,
    unit: GOLD_TYPE_UNIT[summary.goldType],
    currency: null,
    symbol: null,
    unit_cost: summary.avgUnitCost,
    estimated_value_try: round2(currentValue(summary, snapshot, fallbackValue)),
    auto_valued: true,
    source: GOLD_LEDGER_SOURCE,
    note: noteForSummary(summary),
  }
}

function differs(next: InsertFor<'assets'>, current: Asset): boolean {
  return (
    next.name !== current.name ||
    next.category !== current.category ||
    next.unit !== current.unit ||
    next.currency !== current.currency ||
    next.symbol !== current.symbol ||
    next.auto_valued !== current.auto_valued ||
    next.source !== current.source ||
    next.note !== current.note ||
    Math.abs(next.amount - current.amount) > 0.0001 ||
    moneyDiffers(next.unit_cost ?? 0, current.unit_cost ?? 0) ||
    moneyDiffers(next.estimated_value_try, current.estimated_value_try)
  )
}

export async function syncGoldLedgerAssets(
  lots: GoldLot[],
  userId: string,
  snapshot: MarketRatesSnapshot | null,
): Promise<GoldLedgerAssetSyncResult> {
  const summaries = summarizeGold(lots)
  const wantedTypes = new Set(summaries.map((summary) => summary.goldType))
  const existing = unwrap(await fetchGoldLedgerAssets(userId), 'Altın varlıkları')
  const existingByType = new Map<GoldType, Asset>()
  for (const asset of existing) {
    const type = goldTypeFromAsset(asset)
    if (type) existingByType.set(type, asset)
  }

  let inserted = 0
  let updated = 0
  let deleted = 0

  for (const summary of summaries) {
    const current = existingByType.get(summary.goldType)
    const payload = buildGoldLedgerAssetPayload(summary, userId, snapshot, current?.estimated_value_try)

    if (!current) {
      unwrap(await insertGoldLedgerAsset(payload), 'Altın varlık ekleme')
      inserted += 1
      continue
    }

    if (!differs(payload, current)) continue
    const updatePayload: UpdateFor<'assets'> = { ...payload, updated_at: new Date().toISOString() }
    unwrap(await updateGoldLedgerAsset(current.id, updatePayload), 'Altın varlık güncelleme')
    updated += 1
  }

  for (const asset of existing) {
    const type = goldTypeFromAsset(asset)
    if (!type || wantedTypes.has(type)) continue
    unwrap(await deleteGoldLedgerAsset(asset.id), 'Altın varlık silme')
    deleted += 1
  }

  return { inserted, updated, deleted }
}
