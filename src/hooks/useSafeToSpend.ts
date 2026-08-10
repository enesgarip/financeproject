import { useCallback, useEffect, useState } from 'react'
import { fetchKasaBuckets } from '../data/repositories/kasaBucketsRepo'
import type { CashFlowSummary } from '../utils/financeSummary'
import { totalReservedTL } from '../utils/kasaMode'
import { buildSafeToSpend, DEFAULT_BUFFER, type SafeToSpendResult } from '../utils/safeToSpend'

/**
 * "Bu ay ne kadar harcayabilirim" hesabının iki yan girdisini toplar: cihazda
 * tutulan güvenlik tamponu ve kasa kovalarında ayrılmış tutar. Hesabın kendisi
 * `utils/safeToSpend.ts`'te (saf) kalır.
 *
 * SafeToSpendCard'ın içinden çıkarıldı: Şerit'te aynı sayı ekranın kahraman
 * rakamı olduğu için kartın dışında da gerekiyor.
 */
const BUFFER_KEY = 'denge:safe-to-spend-buffer'

export function readSafeToSpendBuffer(): number {
  try {
    const raw = localStorage.getItem(BUFFER_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUFFER
  } catch {
    return DEFAULT_BUFFER
  }
}

export function writeSafeToSpendBuffer(value: number) {
  try {
    localStorage.setItem(BUFFER_KEY, String(value))
  } catch {
    /* noop — tampon cihaz tercihi, kalıcı olamazsa hesap yine çalışır */
  }
}

export function useSafeToSpend(
  cashFlow: CashFlowSummary,
  liquidCash: number,
): SafeToSpendResult & { buffer: number; setBuffer: (value: number) => void } {
  const [buffer, setBuffer] = useState(readSafeToSpendBuffer)
  // Kasa tablosu yoksa/boşsa 0 kalır ve hesap yine çalışır.
  const [reserved, setReserved] = useState(0)

  useEffect(() => {
    let active = true
    void fetchKasaBuckets().then((result) => {
      if (active && result.ok) setReserved(totalReservedTL(result.data))
    })
    return () => {
      active = false
    }
  }, [])

  // Tampon başka bir sekmede/ekranda değişebilir; pencereye dönüşte tazele.
  useEffect(() => {
    const sync = () => setBuffer(readSafeToSpendBuffer())
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  const commitBuffer = useCallback((value: number) => {
    const next = Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUFFER
    setBuffer(next)
    writeSafeToSpendBuffer(next)
  }, [])

  return {
    ...buildSafeToSpend({
      liquidCash,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer,
      reserved,
    }),
    buffer,
    setBuffer: commitBuffer,
  }
}
