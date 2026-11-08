import type { Json } from '../types/database'

export type FinanceOperation = 'record_manual_account_movement' | 'transfer_between_accounts' | 'trade_asset_with_account' | 'update_asset_value' | 'contribute_to_goal_bucket' | 'restore_user_finance_data_tx'
export type OperationAttempt = { id: string; userId: string; method: FinanceOperation; scope: string; signature: string; args?: Record<string, Json> }
export const OPERATION_EVENT = 'denge:operation-change'
export const OPERATION_RESOLVED_EVENT = 'denge:operation-resolved'
const prefix = (userId: string) => `denge:operation-attempt:v1:${userId}:`
export const operationKey = (userId: string, method: FinanceOperation, scope: string) => `${prefix(userId)}${method}:${scope}`

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]))
  return value
}
export async function operationSignature(method: FinanceOperation, args: Record<string, Json>) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical({ method, args }))))
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
export function readOperationAttempt(userId: string, method: FinanceOperation, scope: string): OperationAttempt | null {
  const raw = localStorage.getItem(operationKey(userId, method, scope))
  if (!raw) return null
  const value = JSON.parse(raw) as OperationAttempt
  if (!value || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.id) || !/^[\da-f]{64}$/i.test(value.signature) || value.userId !== userId || value.method !== method || value.scope !== scope) throw new Error('Önceki işlem kimliği okunamadı. Yeni kayıt girmeden işlem geçmişini kontrol et.')
  return value
}
export function saveOperationAttempt(attempt: OperationAttempt) {
  localStorage.setItem(operationKey(attempt.userId, attempt.method, attempt.scope), JSON.stringify(attempt))
  window.dispatchEvent(new Event(OPERATION_EVENT))
}
export function clearOperationAttempt(attempt: OperationAttempt, resolved: boolean) {
  try { localStorage.removeItem(operationKey(attempt.userId, attempt.method, attempt.scope)) } catch { /* Kalan kayıt aynı makbuzu doğrular. */ }
  window.dispatchEvent(new Event(OPERATION_EVENT))
  if (resolved) window.dispatchEvent(new CustomEvent(OPERATION_RESOLVED_EVENT, { detail: attempt }))
}
export function pendingOperations(userId: string): OperationAttempt[] {
  const result: OperationAttempt[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix(userId))) continue
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as OperationAttempt | null
    if (value) {
      const checked = readOperationAttempt(userId, value.method, value.scope)
      if (checked) result.push(checked)
    }
  }
  return result
}
