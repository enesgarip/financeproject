import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { fetchKasaBuckets } from '../data/repositories/kasaBucketsRepo'
import type { CashFlowSummary } from '../utils/financeSummary'
import { totalReservedTL } from '../utils/kasaMode'
import { isMissingSupabaseCapabilityError } from '../utils/supabaseErrors'
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

export const KASA_BUCKETS_QUERY_KEY = ['kasa-buckets'] as const

export type KasaReservedState = {
  reserved: number
  /**
   * false = rezerv henüz doğrulanamadı (yükleniyor ya da sorgu düştü). Bu
   * durumda `reserved` 0'dır ve "harcanabilir" rezervsiz — yani ŞİŞKİN —
   * hesaplanır; gösteren yüzey bunu kullanıcıya söylemeli (denetim K16).
   * Kasa tablosunun hiç kurulmamış olması (missing-capability) bilinçli 0
   * sayılır ve `true` döner.
   */
  reservedKnown: boolean
}

/**
 * Kasa kovalarında ayrılmış toplam (TL). Kasa tablosu yoksa/boşsa 0 kalır ve
 * çağıran hesap yine çalışır.
 *
 * `useSafeToSpend`'in içinden çıkarıldı (Faz D4): rezervi yalnız Dashboard
 * düşüyordu, `PurchaseDecisionPage` ve `PlanningPage` `buildSafeToSpend`'i
 * `reserved` olmadan çağırdığı için aynı isimli sayı orada ayrılmış rezerv
 * kadar FAZLA çıkıyordu — hem de kararın verildiği ekranda.
 *
 * TanStack Query'de tutulur (denetim K16 + O3): eski useEffect sürümü hem hata
 * durumunda sessizce 0'a düşüyordu hem de kova düzenlenince (KasaModuPanel
 * invalidation'ı) aynı sayfadaki hesap bayat kalıyordu.
 */
/**
 * Kovaların kendisi. Rezerv toplamı dışında kova LİSTESİ de gerekiyor: birikim
 * hedefi bir kovaya bağlanabildiği için (bkz. utils/goalSources.ts) hedef paneli
 * hem seçim listesini hem de bağlı kovanın tutarını buradan okur.
 */
export function useKasaBuckets() {
  return useQuery({
    queryKey: KASA_BUCKETS_QUERY_KEY,
    queryFn: async () => {
      const result = await fetchKasaBuckets()
      if (!result.ok) {
        // Tablo hiç kurulmamışsa bu bilinçli bir 0'dır, hata değil.
        if (isMissingSupabaseCapabilityError(result.error)) return []
        throw new Error(result.error.message ?? 'Kasa kovaları yüklenemedi.')
      }
      return result.data
    },
  })
}

export function useKasaReserved(): KasaReservedState {
  const query = useKasaBuckets()

  return {
    reserved: query.data ? totalReservedTL(query.data) : 0,
    reservedKnown: query.isSuccess,
  }
}

export function useSafeToSpend(
  cashFlow: CashFlowSummary,
  liquidCash: number,
): SafeToSpendResult & { buffer: number; setBuffer: (value: number) => void; reservedKnown: boolean } {
  const [buffer, setBuffer] = useState(readSafeToSpendBuffer)
  const { reserved, reservedKnown } = useKasaReserved()

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
    reservedKnown,
  }
}
