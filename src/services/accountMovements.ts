import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import { addTransactionHistory } from '../utils/history'
import { isMissingSupabaseCapabilityError, type SupabaseLikeError } from '../utils/supabaseErrors'

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
  if (amount <= 0) return { error: { message: 'Tutar 0’dan büyük olmalı.' } }

  if (type === 'transfer') {
    if (!targetAccount) return { error: { message: 'Hedef hesap seçmelisin.' } }
    if (targetAccount.id === sourceAccount.id) return { error: { message: 'Kaynak ve hedef hesap aynı olamaz.' } }
    if (sourceAccount.current_balance < amount) return { error: { message: 'Kaynak hesap bakiyesi yetersiz.' } }

    const { error } = await supabase.rpc('transfer_between_accounts', {
      p_source_card_id: sourceAccount.id,
      p_target_card_id: targetAccount.id,
      p_amount: amount,
    })

    return {
      error: error && isMissingSupabaseCapabilityError(error)
        ? { message: 'Transfer altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.', code: error.code }
        : error,
    }
  }

  const nextBalance = type === 'in' ? sourceAccount.current_balance + amount : sourceAccount.current_balance - amount
  if (nextBalance < 0) return { error: { message: 'Giden tutar mevcut bakiyeden büyük olamaz.' } }

  const { error } = await supabase
    .from('cards')
    .update({ current_balance: nextBalance, updated_at: new Date().toISOString() })
    .eq('id', sourceAccount.id)

  if (error) return { error }

  const historyError = await addTransactionHistory({
    user_id: sourceAccount.user_id,
    type: 'transfer',
    title: `${sourceAccount.card_name} ${type === 'in' ? 'para girişi' : 'para çıkışı'}`,
    amount,
    source_table: 'cards',
    source_id: sourceAccount.id,
    note: type === 'in' ? 'Banka kartına para geldi.' : 'Banka kartından para çıktı.',
  })

  return { error: historyError }
}
