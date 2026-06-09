/**
 * Para katmanı — tüm TL aritmetiği buradan geçer.
 *
 * Neden: uygulama parayı `number` (float) olarak tutuyor. `0.1 + 0.2` gibi
 * ifadeler `0.30000000000000004` üretir; toplamlar birike birike kuruş altı
 * "toz" biriktirir ve "tolerans" hack'leri gerektirir. Buradaki fikir, parayı
 * iç hesapta **tam sayı kuruş** (1 TL = 100 kuruş) olarak işlemek, böylece
 * toplama/çıkarma/eşitlik kesin olsun; gösterim/saklama sınırında TL float'a
 * geri dönmek.
 *
 * Şema değişikliği YOK — bu modül mevcut float dünyasının üstüne köprü kurar.
 * Yeni kod doğrudan kuruş çalışabilir; eski kod `roundTL`/`sumTL`/`equalsTL`
 * ile dürüstleşir.
 */

/** Bir TL float'ı tam sayı kuruşa çevirir (yarımı sıfırdan uzağa yuvarlar). */
export function toKurus(tl: number | null | undefined): number {
  if (tl == null || !Number.isFinite(tl)) return 0
  const sign = tl < 0 ? -1 : 1
  // abs * 100 sonrası küçük bir epsilon, ikili gösterim hatasını telafi eder
  // (örn. 2.675 * 100 = 267.49999… → 268). Büyüklükle orantısız değil; tek
  // kullanıcılık tutarlar için fazlasıyla güvenli.
  return sign * Math.round(Math.abs(tl) * 100 + 1e-6)
}

/** Tam sayı kuruşu TL float'a çevirir (gösterim/saklama sınırı). */
export function toTL(kurus: number | null | undefined): number {
  if (kurus == null || !Number.isFinite(kurus)) return 0
  return Math.trunc(kurus) / 100
}

/**
 * Bir TL float'ı kuruş hassasiyetine sabitler — float tozunu temizler.
 * `roundTL(0.1 + 0.2)` → `0.3`. Eski float kodunun çıktısını dürüstleştirmek
 * için en hızlı köprü.
 */
export function roundTL(tl: number | null | undefined): number {
  return toTL(toKurus(tl))
}

/** İki kuruş değerini toplar (kesin). */
export function addKurus(a: number, b: number): number {
  return Math.trunc(a) + Math.trunc(b)
}

/** İki kuruş değerini çıkarır (kesin). */
export function subKurus(a: number, b: number): number {
  return Math.trunc(a) - Math.trunc(b)
}

/** Kuruş değerlerini kesin toplar. */
export function sumKurus(values: Iterable<number>): number {
  let total = 0
  for (const v of values) total += Math.trunc(v)
  return total
}

/**
 * TL float dizisini kuruş üzerinden kesin toplar ve TL döndürür.
 * `sumTL([0.1, 0.2])` → `0.3` (çıplak `reduce` `0.30000000000000004` verir).
 */
export function sumTL(values: Iterable<number | null | undefined>): number {
  let totalKurus = 0
  for (const v of values) totalKurus += toKurus(v)
  return toTL(totalKurus)
}

/** İki TL değerinin kuruş hassasiyetinde TAM eşitliği (0.01 tolerans hack'inin yerine). */
export function equalsTL(a: number | null | undefined, b: number | null | undefined): boolean {
  return toKurus(a) === toKurus(b)
}

/** a, b'den kesinlikle büyükse (kuruş hassasiyetinde) true. */
export function greaterThanTL(a: number | null | undefined, b: number | null | undefined): boolean {
  return toKurus(a) > toKurus(b)
}

/**
 * İki TL değerinin kuruş hassasiyetinde işaretli farkı (TL).
 * Mutabakat (A3) için: uygulama bakiyesi − gerçek bakiye.
 */
export function diffTL(a: number | null | undefined, b: number | null | undefined): number {
  return toTL(subKurus(toKurus(a), toKurus(b)))
}
