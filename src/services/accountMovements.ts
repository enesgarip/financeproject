import { executeFinanceOperation } from './financeOperations'
import type { Card } from '../types/database'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../utils/supabaseErrors'

export type AccountMovementType = 'in' | 'out' | 'transfer'

export type AccountMovementResult = {
  error: SupabaseLikeError | null
}

export async function submitAccountMovement({
  sourceAccount,
  targetAccount,
  type,
  amount,
}: {
  sourceAccount: Card
  targetAccount?: Card | null
  type: AccountMovementType
  amount: number
}): Promise<AccountMovementResult> {
  if (!Number.isFinite(amount) || amount <= 0) return { error: { message: 'Tutar 0’dan büyük olmalı.' } }

  if (type === 'transfer') {
    if (!targetAccount) return { error: { message: 'Hedef hesap seçmelisin.' } }
    if (targetAccount.id === sourceAccount.id) return { error: { message: 'Kaynak ve hedef hesap aynı olamaz.' } }

    const { error } = await executeFinanceOperation(sourceAccount.user_id, 'transfer_between_accounts', sourceAccount.id, {
      p_source_card_id: sourceAccount.id,
      p_target_card_id: targetAccount.id,
      p_amount: amount,
    })

    return {
      error: error && isMissingSupabaseCapabilityError(error)
        ? { message: missingSupabaseCapabilityMessage('Transfer altyapısı', error), code: error.code }
        : error,
    }
  }


  // Atomic: the RPC updates the balance and writes transaction_history in one
  // transaction (Faz 4). The Faz 3 account_ledger trigger also records the delta
  // inside the same transaction — balance, ledger event and feed row commit together.
  const { error } = await executeFinanceOperation(sourceAccount.user_id, 'record_manual_account_movement', sourceAccount.id, {
    p_card_id: sourceAccount.id,
    p_amount: amount,
    p_direction: type,
  })

  return {
    error: error && isMissingSupabaseCapabilityError(error)
      ? { message: missingSupabaseCapabilityMessage('Para giriş/çıkış altyapısı', error), code: error.code }
      : error,
  }
}
