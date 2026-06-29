import type { Asset } from '../types/database'
import { buildFinancialPosition, sum, type FinanceSummaryInput } from './financeSummary'
import type { MarketRatesSnapshot } from './marketRates'
import { roundTL } from './money'
import { effectiveAssetValue } from './valuation'

/**
 * Zakat estimator aligned with the Diyanet (TR) ruling:
 * - Nisab = value of 80.18 g gold (priced live from the gram-gold rate).
 * - Rate  = 2.5% (1/40).
 * - Zakatable wealth = cash + gold + tradeable holdings (Hisse/Fon) + strong
 *   receivables, MINUS debts (credit card + loan + personal).
 * - Personal-use assets (Araç, Diğer) are excluded; BES is excluded by default
 *   (locked pension) but can be opted in.
 *
 * This is an ESTIMATE: it cannot verify the one-lunar-year (hawl) condition and
 * uses a simplified market-value treatment of stocks/funds. Pure & testable.
 */

export const ZAKAT_NISAB_GOLD_GRAMS = 80.18
export const ZAKAT_RATE = 0.025

export type ZakatOptions = {
  includeReceivables?: boolean // strong/collectible receivables (default true)
  includeBes?: boolean // locked pension (default false)
  deductDebts?: boolean // subtract debts before nisab check (default true)
}

export type ZakatComponent = {
  key: string
  label: string
  amount: number
  /** +1 adds to zakatable wealth, -1 is a deduction. */
  sign: 1 | -1
}

export type ZakatSummary = {
  zakatableAssets: number
  deductibleDebts: number
  netWealth: number
  gramGoldPrice: number | null
  nisabTry: number | null
  meetsNisab: boolean
  zakatDue: number
  components: ZakatComponent[]
}

const TRADEABLE_CATEGORIES = new Set(['Hisse', 'Fon'])

function categoryTotal(assets: Asset[], match: (category: string) => boolean): number {
  return sum(
    assets.filter((asset) => match(asset.category)),
    (asset) => Number(asset.estimated_value_try) || 0,
  )
}

export function computeZakat(
  data: FinanceSummaryInput,
  snapshot: MarketRatesSnapshot | null | undefined,
  options: ZakatOptions = {},
): ZakatSummary {
  const includeReceivables = options.includeReceivables ?? true
  const includeBes = options.includeBes ?? false
  const deductDebts = options.deductDebts ?? true

  const position = buildFinancialPosition(data)

  const cash = position.totalCashAssets // Nakit assets + bank-card balances
  // Gold is valued from the SAME live snapshot that sets the nisab, so a gold
  // price move shifts the holding and the nisab threshold together. Auto-valued
  // rows use the live price; manual rows fall back to their stored value.
  const gold = sum(data.assets.filter((asset) => asset.category === 'Altın'), (asset) => effectiveAssetValue(asset, snapshot))
  const tradeable = categoryTotal(data.assets, (c) => TRADEABLE_CATEGORIES.has(c))
  const bes = categoryTotal(data.assets, (c) => c === 'BES')
  const receivables = position.totalReceivables

  const components: ZakatComponent[] = [
    { key: 'cash', label: 'Nakit (TL + banka)', amount: roundTL(cash), sign: 1 },
    { key: 'gold', label: 'Altın', amount: roundTL(gold), sign: 1 },
    { key: 'tradeable', label: 'Hisse / Fon', amount: roundTL(tradeable), sign: 1 },
  ]
  if (includeReceivables) {
    components.push({ key: 'receivables', label: 'Alacaklar', amount: roundTL(receivables), sign: 1 })
  }
  if (includeBes) {
    components.push({ key: 'bes', label: 'BES', amount: roundTL(bes), sign: 1 })
  }

  const zakatableAssets = roundTL(
    cash + gold + tradeable + (includeReceivables ? receivables : 0) + (includeBes ? bes : 0),
  )

  const debts = position.totalCreditCardDebt + position.totalLoanDebt + position.totalPersonalDebts
  const deductibleDebts = deductDebts ? roundTL(debts) : 0
  if (deductDebts && deductibleDebts > 0) {
    components.push({ key: 'debts', label: 'Borçlar (kart + kredi + kişisel)', amount: deductibleDebts, sign: -1 })
  }

  const netWealth = roundTL(zakatableAssets - deductibleDebts)

  const gramGoldPrice = snapshot?.rates?.GRA?.buying ?? null
  const hasPrice = typeof gramGoldPrice === 'number' && Number.isFinite(gramGoldPrice) && gramGoldPrice > 0
  const gramGoldPriceValue = hasPrice ? gramGoldPrice : null
  const nisabTry = hasPrice ? roundTL(ZAKAT_NISAB_GOLD_GRAMS * gramGoldPrice) : null
  const meetsNisab = nisabTry !== null && netWealth >= nisabTry
  const zakatDue = meetsNisab ? roundTL(netWealth * ZAKAT_RATE) : 0

  return {
    zakatableAssets,
    deductibleDebts,
    netWealth,
    gramGoldPrice: gramGoldPriceValue,
    nisabTry,
    meetsNisab,
    zakatDue,
    components,
  }
}
