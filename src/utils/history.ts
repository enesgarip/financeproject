import { supabase } from '../lib/supabase'
import type { InsertFor, TransactionHistory } from '../types/database'

type HistoryInput = Omit<InsertFor<'transaction_history'>, 'created_at' | 'updated_at' | 'occurred_at'> & {
  occurred_at?: string
}

export async function addTransactionHistory(input: HistoryInput) {
  const payload: InsertFor<'transaction_history'> = {
    ...input,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
  }

  const { error } = await supabase.from('transaction_history').insert(payload)
  return error
}

export function historyAmount(value: number | null | undefined): TransactionHistory['amount'] {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
