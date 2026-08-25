/**
 * Günlük hedef fotoğrafı (savings_goal_snapshots) sorgusunun paylaşılan
 * TanStack anahtarı. Yazan taraf `useDailyNetWorthSnapshot` bu prefix'i
 * invalidate eder; okuyanlar (SavingsGoalsPanel tempo/varış şeridi,
 * PurchaseDecisionPage vazgeçme önizlemesi) aynı anahtarı kullanır —
 * string kopyası sessizce ayrışmasın (financeSnapshotKey emsali).
 */
export const SAVINGS_GOAL_SNAPSHOTS_QUERY_KEY = ['savings-goal-snapshots'] as const
