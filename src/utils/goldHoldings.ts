import type { Asset, GoldLot, GoldType } from '../types/database'
import { GOLD_LEDGER_SOURCE, GOLD_TYPE_UNIT, summarizeGold } from './goldLedger'
import type { MarketRatesSnapshot } from './marketRates'
import { diffTL, roundTL, sumTL } from './money'
import { valueAsset } from './valuation'

export type GoldHolding = {
  goldType: GoldType
  quantity: number
  knownQuantity: number
  unknownQuantity: number
  knownCost: number
  avgUnitCost: number | null
  ayars: number[]
  hasUnspecifiedAyar: boolean
  value: number | null
  knownValue: number | null
}

function liveValue(goldType: GoldType, quantity: number, snapshot: MarketRatesSnapshot | null): number | null {
  if (quantity === 0) return 0
  return valueAsset({ category: 'Altın', unit: GOLD_TYPE_UNIT[goldType], currency: null, amount: quantity }, snapshot)
}

/** Defter varsa kaynak odur; yoksa bağımsız varlık kayıtları kullanılır, iki kaynak toplanmaz. */
export function buildGoldHoldings(lots: GoldLot[], assets: Asset[], snapshot: MarketRatesSnapshot | null) {
  const source = lots.length > 0 ? 'ledger' : 'assets'
  let usesStoredValue = false
  const holdings: GoldHolding[] = source === 'ledger'
    ? summarizeGold(lots).map((summary) => {
        const rows = lots.filter((lot) => lot.gold_type === summary.goldType)
        return {
          goldType: summary.goldType,
          quantity: summary.totalQuantity,
          knownQuantity: summary.knownQuantity,
          unknownQuantity: summary.unknownQuantity,
          knownCost: summary.knownCost,
          avgUnitCost: summary.avgUnitCost,
          // Ayarlar kayıt meta bilgisidir; kalan miktarın ayara göre dağılımı iddia edilmez.
          ayars: [...new Set(rows.flatMap((row) => row.ayar === null ? [] : [row.ayar]))].sort((a, b) => a - b),
          hasUnspecifiedAyar: rows.some((row) => row.ayar === null),
          value: liveValue(summary.goldType, summary.totalQuantity, snapshot),
          knownValue: liveValue(summary.goldType, summary.knownQuantity, snapshot),
        }
      })
    : (['gram', 'ceyrek'] as GoldType[]).flatMap((goldType) => {
        const rows = assets.filter((asset) => asset.category === 'Altın' && asset.source !== GOLD_LEDGER_SOURCE && asset.unit === GOLD_TYPE_UNIT[goldType])
        if (rows.length === 0) return []
        const knownRows = rows.filter((row) => row.unit_cost !== null)
        // Miktar para değildir: gold_lots ile aynı dört ondalık hassasiyeti.
        const quantity = Number(rows.reduce((total, row) => total + row.amount, 0).toFixed(4))
        const knownQuantity = Number(knownRows.reduce((total, row) => total + row.amount, 0).toFixed(4))
        const knownCost = sumTL(knownRows.map((row) => roundTL(row.amount * row.unit_cost!)))
        const values = rows.map((row) => {
          const live = valueAsset(row, snapshot)
          if (live !== null) return live
          usesStoredValue = true
          return row.estimated_value_try
        })
        return [{
          goldType,
          quantity,
          knownQuantity,
          unknownQuantity: Number((quantity - knownQuantity).toFixed(4)),
          knownCost,
          avgUnitCost: knownQuantity > 0 ? roundTL(knownCost / knownQuantity) : null,
          ayars: [],
          hasUnspecifiedAyar: true,
          value: sumTL(values),
          knownValue: sumTL(values.filter((_value, index) => rows[index].unit_cost !== null)),
        }]
      })
  const totalKnownCost = sumTL(holdings.map((holding) => holding.knownCost))
  const totalValue = holdings.some((holding) => holding.value === null) ? null : sumTL(holdings.map((holding) => holding.value!))
  const knownValue = holdings.some((holding) => holding.knownValue === null) ? null : sumTL(holdings.map((holding) => holding.knownValue!))
  const profit = knownValue === null || totalKnownCost <= 0 ? null : diffTL(knownValue, totalKnownCost)
  return { source, holdings, usesStoredValue, totalValue, totalKnownCost, profit }
}
