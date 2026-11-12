import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { recordUsage } from '../lib/usageTelemetry'
import type { UsageEvent } from '../utils/usageStatistics'

export function useUsageView(event: UsageEvent | null) {
  const { user } = useAuth()
  const userId = user?.id
  const previous = useRef<string | null>(null)
  const key = userId && event ? `${userId}:${event.kind}:${event.subject}` : null
  useEffect(() => {
    if (previous.current === key) return
    previous.current = key
    if (event) recordUsage(userId, event)
  }, [event, key, userId])
}
