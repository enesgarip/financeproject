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

/**
 * Türetilmiş biriken tutarları bugünün fotoğrafına yazar (en-iyi-çaba;
 * çağıran hatayı yutar — net değer kaydını ve gün damgasını geri almaz).
 * Kova listesi yalnız kasa-kaynağı bağlı hedef varsa çekilir.
 */
export async function recordDailyGoalSnapshots(
  userId: string,
  snapshot: FinanceSnapshot,
  rates: MarketRatesSnapshot | null,
  isCancelled: () => boolean,
): Promise<void> {
  const needsBuckets = snapshot.savingsGoalSources.some((source) => source.kind === 'kasa_bucket')
  const buckets = needsBuckets ? await fetchKasaBuckets() : null
  const tickers = Array.from(new Set(snapshot.assets.map((asset) => normalizeTicker(asset.symbol))))
    .filter((ticker): ticker is string => ticker !== null)
    .sort()
  const stockPrices = tickers.length > 0 ? await fetchStockPrices(tickers).catch(() => null) : null
  if (isCancelled()) return

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
  await recordSavingsGoalSnapshots(userId, buildGoalSnapshotEntries(resolved.goals))
}
