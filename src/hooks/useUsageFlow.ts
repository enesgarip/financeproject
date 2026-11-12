import { useCallback, useEffect, useRef } from 'react'
import { recordUsage } from '../lib/usageTelemetry'
import type { UsageFlowAction, UsageSource } from '../utils/usageStatistics'

type Flow = {
  id: string
  userId: string
  subject: UsageFlowAction
  source: UsageSource
  closing: boolean
  completed: boolean
}

export function useUsageFlow(
  userId: string | undefined,
  subject: UsageFlowAction,
  source: UsageSource,
  visible = true,
) {
  const current = useRef<Flow | null>(null)
  useEffect(() => {
    if (!import.meta.env.PROD || !userId || !visible) return
    let flow = current.current
    if (flow?.userId !== userId || flow.subject !== subject || flow.source !== source) {
      flow = { id: crypto.randomUUID(), userId, subject, source, closing: false, completed: false }
      current.current = flow
      recordUsage(userId, { kind: 'opened', subject, flowId: flow.id, source })
    }
    const opened = flow
    opened.closing = false
    return () => {
      opened.closing = true
      // StrictMode aynı etkiyi yeniden kurarsa görünür form hâlâ açıktır.
      queueMicrotask(() => {
        if (!opened.closing) return
        if (current.current === opened) current.current = null
        if (!opened.completed) recordUsage(opened.userId, { kind: 'closed', subject, flowId: opened.id })
      })
    }
  }, [userId, subject, source, visible])

  const attempt = useCallback(() => {
    const flow = current.current
    const flowId = flow && flow.userId === userId && !flow.completed ? flow.id : undefined
    recordUsage(userId, { kind: 'attempted', subject, flowId })
    return (outcome: 'completed' | 'failed') => {
      if (flowId && flow && outcome === 'completed') flow.completed = true
      recordUsage(userId, { kind: outcome, subject, flowId })
    }
  }, [userId, subject])

  const complete = useCallback(() => {
    const flow = current.current
    if (!flow || flow.completed) return
    flow.completed = true
    recordUsage(flow.userId, { kind: 'completed', subject: flow.subject, flowId: flow.id })
  }, [])

  return { attempt, complete }
}
