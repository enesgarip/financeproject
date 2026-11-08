import { useEffect, useRef } from 'react'
import { OPERATION_RESOLVED_EVENT, type FinanceOperation, type OperationAttempt } from '../utils/operationAttempt'

/** Eski niyet doğrulandığında aynı kaynağın açık taslağı tekrar gönderilmesin. */
export function useOperationResolution(methods: FinanceOperation[], scope: string | undefined, onResolved: () => void) {
  const callback = useRef(onResolved)
  const methodKey = methods.join('|')
  useEffect(() => { callback.current = onResolved })
  useEffect(() => {
    const resolved = (event: Event) => {
      const attempt = (event as CustomEvent<OperationAttempt>).detail
      if (scope && attempt.scope === scope && methodKey.split('|').includes(attempt.method)) callback.current()
    }
    window.addEventListener(OPERATION_RESOLVED_EVENT, resolved)
    return () => window.removeEventListener(OPERATION_RESOLVED_EVENT, resolved)
  }, [scope, methodKey])
}
