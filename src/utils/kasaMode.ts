/**
 * Kasa modu: banka bakiyesini zihinsel kovalara ayırma (planlama katmanı, saf).
 *
 * Kovalar gerçek bakiyeyi/ledger'ı DEĞİŞTİRMEZ; yalnız "gerçek harcanabilir"
 * hesabını besler: harcanabilir = likit − rezerve kovalar. Rezerve toplamı likidi
 * aşarsa sonuç negatif olur (aşırı ayırma uyarısı) — kırpılmaz.
 * Para toplamı/farkı money.ts ile.
 */
import type { KasaBucket } from '../types/database'
import { diffTL, roundTL, sumTL } from './money'

export function totalReservedTL(buckets: Pick<KasaBucket, 'reserved_amount'>[]): number {
  return roundTL(sumTL(buckets.map((bucket) => bucket.reserved_amount)))
}

export function spendableAfterReserves(
  liquidCash: number,
  buckets: Pick<KasaBucket, 'reserved_amount'>[],
): number {
  return roundTL(diffTL(liquidCash, totalReservedTL(buckets)))
}
