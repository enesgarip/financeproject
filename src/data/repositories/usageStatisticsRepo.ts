import { supabase } from '../../lib/supabase'
import type { UsageDays, UsageEvent, UsageInsights } from '../../utils/usageStatistics'
import { resultFromSupabase, type Result } from '../result'

export async function insertUsageEvent(userId: string, event: UsageEvent) {
  const { kind, subject } = event
  const flowId = 'flowId' in event ? event.flowId : undefined
  const source = 'source' in event ? event.source : undefined
  await supabase.from('usage_events').insert({
    user_id: userId, kind, subject,
    ...(flowId ? { flow_id: flowId } : {}),
    ...(source ? { source } : {}),
  })
}

export async function fetchUsageInsights(days: UsageDays): Promise<Result<UsageInsights | null>> {
  const { data, error } = await supabase.rpc('fetch_usage_insights', { p_days: days })
  return resultFromSupabase(data, error, 'Kullanım istatistikleri yüklenemedi.')
}
