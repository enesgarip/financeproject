import { useCallback, useEffect, useState } from 'react'
import { formatCurrency } from '../utils/formatCurrency'

const STORAGE_KEY = 'financeproject.balancePrivacy'
const MASKED_AMOUNT = '••••'

function readInitialValue() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === 'hidden'
}

export function formatPrivateCurrency(value: number | null | undefined, hidden: boolean) {
  return hidden ? MASKED_AMOUNT : formatCurrency(value)
}

export function useBalancePrivacy() {
  const [hidden, setHidden] = useState(readInitialValue)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'visible')
  }, [hidden])

  const toggleHidden = useCallback(() => {
    setHidden((current) => !current)
  }, [])

  const formatAmount = useCallback((value: number | null | undefined) => (
    formatPrivateCurrency(value, hidden)
  ), [hidden])

  return {
    formatAmount,
    hidden,
    toggleHidden,
  }
}
