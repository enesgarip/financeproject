import { supabase } from '../lib/supabase'
import { toKurus } from '../utils/money'
import type { SupabaseLikeError } from '../utils/supabaseErrors'

/**
 * Client wrappers for the card-ledger correction RPCs (roadmap A2.1).
 *
 * The ledger is the authority for a credit card's debt; these two actions let
 * the UI keep `cards.debt_amount` honest against it without any silent
 * overwrite:
 *  - `recomputeCardDebt` resets debt to the exact ledger projection (repair).
 *  - `postCardDebtCorrection` applies a signed adjustment that lands as an
 *    auditable 'adjustment' ledger event with a reason note.
 */

export type CardLedgerActionResult = {
  /** New stored debt after the action (TL), or null on error. */
  debt: number | null
  error: SupabaseLikeError | null
}

/** Pull a card's debt back to the exact ledger projection. */
export async function recomputeCardDebt(cardId: string): Promise<CardLedgerActionResult> {
  const { data, error } = await supabase.rpc('recompute_card_debt_from_ledger', { p_card_id: cardId })
  if (error) return { debt: null, error }
  return { debt: typeof data === 'number' ? data : null, error: null }
}

/**
 * Apply a signed correction (in TL; +increases debt, −decreases) as an
 * 'adjustment' ledger event. `note` is the required reason.
 */
export async function postCardDebtCorrection(
  cardId: string,
  amountTL: number,
  note: string,
): Promise<CardLedgerActionResult> {
  const amountKurus = toKurus(amountTL)
  if (amountKurus === 0) {
    return { debt: null, error: { message: 'Düzeltme tutarı 0 olamaz.' } }
  }
  if (!note.trim()) {
    return { debt: null, error: { message: 'Düzeltme için bir sebep girilmeli.' } }
  }

  const { data, error } = await supabase.rpc('post_card_debt_correction', {
    p_card_id: cardId,
    p_amount_kurus: amountKurus,
    p_note: note.trim(),
  })
  if (error) return { debt: null, error }
  return { debt: typeof data === 'number' ? data : null, error: null }
}
