import { supabase } from '../../lib/supabase'
import { voidResultFromSupabase, type Result } from '../result'

export async function settlePersonalDebt(debtId: string, accountCardId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('settle_personal_debt', {
    p_debt_id: debtId,
    p_account_card_id: accountCardId,
  })

  return voidResultFromSupabase(error, 'Borc kapatma islemi tamamlanamadi.')
}
