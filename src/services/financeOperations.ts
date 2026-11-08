import { supabase } from '../lib/supabase'
import type { Json } from '../types/database'
import { clearOperationAttempt, operationKey, operationSignature, readOperationAttempt, saveOperationAttempt, OPERATION_EVENT, type FinanceOperation, type OperationAttempt } from '../utils/operationAttempt'
import type { SupabaseLikeError } from '../utils/supabaseErrors'

const inFlight = new Set<string>()
export function operationInFlight(attempt: OperationAttempt) { return inFlight.has(operationKey(attempt.userId, attempt.method, attempt.scope)) }
export const uncertainOperation = (error: SupabaseLikeError) => !error.code || /fetch|network|timeout|connection/i.test(error.message ?? '')

/** Makbuz domain yazmasıyla aynı SQL transaction'ındadır; eski RPC'ye kör fallback yok. */
export async function executeFinanceOperation(userId: string, method: FinanceOperation, scope: string, args: Record<string, Json>): Promise<{ error: SupabaseLikeError | null }> {
  if (!userId) return { error: { code: 'LOCAL_VALIDATION', message: 'Oturum bulunamadı.' } }
  let attempt: OperationAttempt
  try {
    const signature = await operationSignature(method, args)
    const allocate = () => {
      const stored = readOperationAttempt(userId, method, scope)
      if (stored && stored.signature !== signature) throw new Error('Önceki işlemin sonucu henüz doğrulanmadı. Üstteki inceleme alanından önce o işlemi doğrula; yeni işlem gönderilmedi.')
      const next = stored ?? { id: crypto.randomUUID(), userId, method, scope, signature, ...(method === 'restore_user_finance_data_tx' ? {} : { args }) }
      saveOperationAttempt(next)
      return next
    }
    attempt = typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request(operationKey(userId, method, scope), allocate)
      : allocate()
  } catch (cause) {
    return { error: { code: 'LOCAL_INTENT', message: cause instanceof Error && /Önceki işlem/.test(cause.message) ? cause.message : 'İşlem kimliği cihazda saklanamadı. Depolamayı kontrol et; finans isteği gönderilmedi.' } }
  }
  const key = operationKey(userId, method, scope)
  inFlight.add(key)
  window.dispatchEvent(new Event(OPERATION_EVENT))
  let error: SupabaseLikeError | null
  try {
    const result = await supabase.rpc('submit_finance_operation', { p_request_id: attempt.id, p_method: method, p_args: args })
    error = result.error
  } catch (cause) { error = { message: cause instanceof Error ? cause.message : 'Bağlantı sonucu doğrulanamadı.' } }
  inFlight.delete(key)
  if (!error || !uncertainOperation(error)) clearOperationAttempt(attempt, !error)
  else window.dispatchEvent(new Event(OPERATION_EVENT))
  return { error: error && uncertainOperation(error) ? { ...error, message: 'İşlemin sonucu doğrulanamadı; uygulanmış olabilir. Aynı bilgilerle yeniden dene veya üstteki inceleme alanından sonucu doğrula.' } : error }
}
