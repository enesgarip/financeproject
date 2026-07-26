import { useCallback, useEffect, useRef, useState } from 'react'
import { postCardDebtCorrection } from '../services/cardLedgerActions'
import { payPaymentFromCard } from '../services/financePaymentActions'
import type { Card, Payment } from '../types/database'
import { getAutoPayableDuePayments, toAutoPayResult, type AutoPayResult } from '../utils/autoPayment'

const PROCESSED_KEY = 'autoPayProcessed'

function getSessionProcessed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(PROCESSED_KEY)
    return raw ? new Set<string>(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function markSessionProcessed(ids: string[]) {
  const existing = getSessionProcessed()
  for (const id of ids) existing.add(id)
  sessionStorage.setItem(PROCESSED_KEY, JSON.stringify([...existing]))
}

async function processAutoPayments(
  pending: Array<{ payment: Payment; card: Card }>,
  onMutate?: () => Promise<void>,
): Promise<AutoPayResult[]> {
  const results: AutoPayResult[] = []
  for (const { payment, card } of pending) {
    const { error } = await payPaymentFromCard(payment.id, card.id, payment.amount)
    if (!error) {
      results.push(toAutoPayResult(payment, card, payment.amount))
    }
  }

  if (results.length > 0) {
    markSessionProcessed(results.map((r) => r.paymentId))
    await onMutate?.()
  }
  return results
}

export function useAutoPayments(payments: Payment[], cards: Card[], onMutate?: () => Promise<void>) {
  const [results, setResults] = useState<AutoPayResult[]>([])
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current || payments.length === 0 || cards.length === 0) return
    ranRef.current = true

    const due = getAutoPayableDuePayments(payments, cards)
    const alreadyDone = getSessionProcessed()
    const pending = due.filter((d) => !alreadyDone.has(d.payment.id))
    if (pending.length === 0) return

    void processAutoPayments(pending, onMutate).then(setResults)
  }, [payments, cards, onMutate])

  const dismiss = useCallback((paymentId: string) => {
    setResults((prev) => prev.filter((r) => r.paymentId !== paymentId))
  }, [])

  const dismissAll = useCallback(() => {
    setResults([])
  }, [])

  const adjustAmount = useCallback(async (paymentId: string, cardId: string, oldAmount: number, newAmount: number) => {
    const delta = newAmount - oldAmount
    if (delta === 0) return

    await postCardDebtCorrection(
      cardId,
      delta,
      `Otomatik odeme tutar duzeltmesi: ${oldAmount} → ${newAmount}`,
    )
    await onMutate?.()

    setResults((prev) =>
      prev.map((r) =>
        r.paymentId === paymentId ? { ...r, amount: newAmount } : r,
      ),
    )
  }, [onMutate])

  return {
    autoPayResults: results,
    dismiss,
    dismissAll,
    adjustAmount,
  }
}
