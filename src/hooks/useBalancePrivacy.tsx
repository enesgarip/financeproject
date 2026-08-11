import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { formatSeritAmount } from '../utils/formatCurrency'

const STORAGE_KEY = 'financeproject.balancePrivacy'
const MASKED_AMOUNT = '••••'

function readInitialValue() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === 'hidden'
}

/**
 * Ekranda görünen TÜM tutarların tek biçimlendirme yolu. Şerit'e geçişte
 * `formatCurrency`'den (₺ önde, hep 2 ondalık) `formatSeritAmount`'a alındı:
 * sembol sonda, kuruş korunuyor. Aksi halde aynı blokta "196.680 ₺" ile
 * "₺196.680,00" yan yana düşüyordu.
 *
 * `formatCurrency` yerinde duruyor ve dışa aktarım/PDF/rapor yollarında
 * kullanılmaya devam ediyor — orada sembolün önde olması beklenen çıktı.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function formatPrivateCurrency(value: number | null | undefined, hidden: boolean) {
  return hidden ? MASKED_AMOUNT : formatSeritAmount(value, { decimals: 2 })
}

type BalancePrivacyContextValue = {
  formatAmount: (value: number | null | undefined) => string
  hidden: boolean
  toggleHidden: () => void
}

const BalancePrivacyContext = createContext<BalancePrivacyContextValue | null>(null)

export function BalancePrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(readInitialValue)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'visible')
  }, [hidden])

  const toggleHidden = useCallback(() => {
    setHidden((current) => !current)
  }, [])

  const formatAmount = useCallback(
    (value: number | null | undefined) => formatPrivateCurrency(value, hidden),
    [hidden],
  )

  return (
    <BalancePrivacyContext.Provider value={{ formatAmount, hidden, toggleHidden }}>
      {children}
    </BalancePrivacyContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBalancePrivacy() {
  const ctx = useContext(BalancePrivacyContext)
  if (!ctx) throw new Error('useBalancePrivacy must be used inside BalancePrivacyProvider')
  return ctx
}
