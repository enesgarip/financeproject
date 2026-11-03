/**
 * Günlük hedef fotoğrafı yazımı — useDailyNetWorthSnapshot'ın ikinci yarısı.
 *
 * Ayrı modül olması BOYUT kararı: hook Layout ile entry'ye girer; bu akışın
 * çözümleme zinciri (goalSources + kova repo'su + BIST istemcisi + upsert)
 * entry bütçesini (20 kB gzip) aşırıyordu. Modül dinamik import edildiği için
 * buradaki bağımlılıklar statik kalabilir — chunk zaten lazy.
 */
import { recordSavingsGoalSnapshots } from '../data/repositories/analysisRepo'
import type { FinanceSnapshot } from '../data/repositories/financeSnapshotRepo'
import { fetchKasaBuckets } from '../data/repositories/kasaBucketsRepo'
import { fetchStockPrices, normalizeTicker } from '../lib/stockQuotesClient'
import { buildGoalSnapshotEntries } from '../utils/goalSnapshots'
import { resolveSavingsGoalRows } from '../utils/goalSources'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { effectiveAssetValueWithSource } from '../utils/valuation'

/**
 * Yalnız tam çözülen hedefleri yazar; eksik okuma/fiyat veya yazma hatasında
 * false döner. Net değer ve hedef başarı damgaları bağımsızdır.
 * Kova listesi yalnız kasa-kaynağı bağlı hedef varsa çekilir.
 */
export async function recordDailyGoalSnapshots(
  userId: string,
  snapshot: FinanceSnapshot,
  rates: MarketRatesSnapshot | null,
  isCancelled: () => boolean,
): Promise<boolean> {
  const needsBuckets = snapshot.savingsGoalSources.some((source) => source.kind === 'kasa_bucket')
  const buckets = needsBuckets ? await fetchKasaBuckets() : null
  const tickers = Array.from(new Set(snapshot.assets.map((asset) => normalizeTicker(asset.symbol))))
    .filter((ticker): ticker is string => ticker !== null)
    .sort()
  const stockPrices = tickers.length > 0 ? await fetchStockPrices(tickers).catch(() => null) : null
  if (isCancelled()) return false

  const resolved = resolveSavingsGoalRows(
    snapshot.savingsGoals,
    snapshot.savingsGoalComponents,
    snapshot.savingsGoalSources,
    {
      assets: snapshot.assets,
      cards: snapshot.cards,
      buckets: buckets?.ok ? buckets.data : [],
      snapshot: rates,
      stockPrices,
    },
  )
  // Eksik kaynak veya bayat otomatik fiyat, gerçek sıfır olarak tarihçeye yazılmaz.
  const complete = (goalId: string, componentId: string | null, unit: string) => {
    const resolution = componentId ? resolved.componentResolutions.get(componentId) : resolved.goalResolutions.get(goalId)
    if (resolution && (resolution.missing.length || resolution.unusable.length)) return false
    if (unit !== 'TRY') return true // Altın miktarı kurdan bağımsızdır.
    const sources = snapshot.savingsGoalSources.filter(s => s.goal_id === goalId && s.component_id === componentId)
    return snapshot.assets.every(asset => {
      const used = sources.some(s => s.kind === 'all_assets' || (s.kind === 'asset' && s.asset_id === asset.id) || (s.kind === 'asset_category' && s.asset_category === asset.category))
      return !used || effectiveAssetValueWithSource(asset, rates, stockPrices).source !== 'stored'
    })
  }
  const activeGoals = resolved.goals.filter(g => g.status === 'active')
  const validGoals = activeGoals.filter(goal => goal.value_type === 'composite'
    ? resolved.components.filter(c => c.goal_id === goal.id).every(c => complete(goal.id, c.id, c.value_type))
    : complete(goal.id, null, goal.value_type))
  const entries = buildGoalSnapshotEntries(validGoals)
  if (entries.length === 0) return activeGoals.length === 0
  const result = await recordSavingsGoalSnapshots(userId, entries)
  return result.ok && result.data && entries.length === activeGoals.length
}
