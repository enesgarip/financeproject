import type { UsageEvent } from '../utils/usageStatistics'

export function recordUsage(userId: string | undefined, event: UsageEvent) {
  if (!import.meta.env.PROD || !userId) return
  // Ölçüm isteği finans işleminden bağımsızdır.
  void import('../data/repositories/usageStatisticsRepo')
    .then(repo => repo.insertUsageEvent(userId, event))
    .catch(() => undefined)
}
