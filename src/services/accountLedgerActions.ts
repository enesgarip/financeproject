import { supabase } from '../lib/supabase'
import { toKurus } from '../utils/money'
import type { SupabaseLikeError } from '../utils/supabaseErrors'

/**
 * Client wrappers for the account-ledger correction RPCs (roadmap Faz 3.1).
 * Mirrors services/cardLedgerActions.ts for bank accounts:
 *  - `recomputeAccountBalance` resets balance to the exact ledger projection.
 *  - `postAccountBalanceCorrection` applies a signed adjustment that lands as an
 *    auditable 'adjustment' ledger event with a reason note.
 */

export type AccountLedgerActionResult = {
  /** New stored balance after the action (TL), or null on error. */
  balance: number | null
  error: SupabaseLikeError | null
}

/** Pull an account's balance back to the exact ledger projection. */
export async function recomputeAccountBalance(cardId: string): Promise<AccountLedgerActionResult> {
  const { data, error } = await supabase.rpc('recompute_account_balance_from_ledger', { p_card_id: cardId })
  if (error) return { balance: null, error }
  return { balance: typeof data === 'number' ? data : null, error: null }
}

/**
 * Apply a signed correction (in TL; +raises balance, −lowers) as an 'adjustment'
 * ledger event. `note` is the required reason.
 */
export async function postAccountBalanceCorrection(
  cardId: string,
  amountTL: number,
  note: string,
): Promise<AccountLedgerActionResult> {
  const amountKurus = toKurus(amountTL)
  if (amountKurus === 0) {
    return { balance: null, error: { message: 'Düzeltme tutarı 0 olamaz.' } }
  }
  if (!note.trim()) {
    return { balance: null, error: { message: 'Düzeltme için bir sebep girilmeli.' } }
  }

  const { data, error } = await supabase.rpc('post_account_balance_correction', {
    p_card_id: cardId,
    p_amount_kurus: amountKurus,
    p_note: note.trim(),
  })
  if (error) return { balance: null, error }
  return { balance: typeof data === 'number' ? data : null, error: null }
}
