import { useCallback } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { formatSeritParts, type SeritAmountOptions } from '../../utils/formatCurrency'

const MASKED = '••••'

/**
 * Şerit rakamlarını "tutarları gizle" moduna bağlar. Maskede birim korunur ve
 * rakam yerine aynı sayıda nokta gelir; `.serit-num` tabular olduğu için satır
 * genişliği kaymaz (tasarımın açık gereği).
 */
export function useSeritAmount() {
  const { hidden } = useBalancePrivacy()

  return useCallback(
    (value: number | null | undefined, options?: SeritAmountOptions) =>
      hidden ? { amount: MASKED, unit: '₺' } : formatSeritParts(value, options),
    [hidden],
  )
}
