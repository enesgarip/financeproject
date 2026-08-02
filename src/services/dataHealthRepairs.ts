import { supabase } from '../lib/supabase'
import type { Json } from '../types/database'
import type { SupabaseLikeError } from '../utils/supabaseErrors'

export type DataHealthSafeRepairRule =
  | 'card_ledger_recompute'
  | 'account_ledger_recompute'
  | 'loan_summary_recompute'
  | 'card_split_clamp'

export type DataHealthSafeRepair = {
  rule: DataHealthSafeRepairRule
  targetId: string
  expectedUpdatedAt: string
}

export type DataHealthRepairReceipt = {
  runId: string
  status: 'running' | 'succeeded' | 'conflict' | 'failed'
  planned: number
  applied: number
  skipped: number
  message: string | null
  idempotentReplay: boolean
}

type RepairResult = {
  receipt: DataHealthRepairReceipt | null
  error: SupabaseLikeError | null
}

export function createDataHealthRepairIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  throw new Error('Güvenli düzeltme için UUID desteği bulunamadı.')
}

function parseReceipt(value: Json | null): DataHealthRepairReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const runId = value.runId
  const status = value.status
  const planned = value.planned
  const applied = value.applied
  const skipped = value.skipped
  const message = value.message
  const idempotentReplay = value.idempotentReplay

  if (
    typeof runId !== 'string' ||
    !['running', 'succeeded', 'conflict', 'failed'].includes(String(status)) ||
    typeof planned !== 'number' ||
    typeof applied !== 'number' ||
    typeof skipped !== 'number' ||
    (message !== null && typeof message !== 'string') ||
    typeof idempotentReplay !== 'boolean'
  ) {
    return null
  }

  return {
    runId,
    status: status as DataHealthRepairReceipt['status'],
    planned,
    applied,
    skipped,
    message,
    idempotentReplay,
  }
}

export async function applyDataHealthSafeRepairs(
  repairs: DataHealthSafeRepair[],
  idempotencyKey = createDataHealthRepairIdempotencyKey(),
): Promise<RepairResult> {
  const { data, error } = await supabase.rpc('apply_data_health_safe_repairs', {
    p_repairs: repairs as unknown as Json,
    p_idempotency_key: idempotencyKey,
  })

  if (error) return { receipt: null, error }

  const receipt = parseReceipt(data)
  if (!receipt) {
    return {
      receipt: null,
      error: { message: 'Güvenli düzeltme sunucudan geçersiz bir sonuç döndürdü.' },
    }
  }

  return { receipt, error: null }
}
