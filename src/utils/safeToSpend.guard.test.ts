import { describe, expect, it } from 'vitest'

/**
 * "Harcanabilir" tek bir sayı olmalı — her ekranda AYNI sayı (Faz D4).
 *
 * `buildSafeToSpend` saf ve doğru; hata çağrı yerlerindeydi: Dashboard
 * (`useSafeToSpend` üzerinden) kasa kovalarındaki rezervi düşüyor, ama
 * `PurchaseDecisionPage` ve `PlanningPage` `reserved` alanını hiç geçmiyordu.
 * Sonuç: "bunu alsam ne olur?" ekranı — kararın fiilen verildiği yer —
 * harcanabilir tutarı ayrılmış rezerv kadar FAZLA gösteriyordu.
 *
 * Bu sınıf hata (aynı hesabın bir ekranda eksik girdiyle çağrılması) birim
 * testiyle yakalanamaz: fonksiyon her iki çağrıda da "doğru" çalışır. O yüzden
 * kaynak metni taranır — `docs.guard`/`encoding.guard` ile aynı desen, Vite'ın
 * `?raw` glob'u üzerinden (Node fs yok, browser tsconfig'i içinde kalır).
 */
const sources: Record<string, string> = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Bir `buildSafeToSpend(` çağrısının parantezlerini dengeleyerek metnini alır. */
function callArguments(content: string, startIndex: number): string {
  let depth = 0
  for (let i = startIndex; i < content.length; i++) {
    const char = content[i]
    if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return content.slice(startIndex, i + 1)
    }
  }
  return content.slice(startIndex)
}

// Saf hesabın kendi tanımı ve testleri doğal olarak `reserved`siz senaryolar
// kurar; kapsam ürün kodudur.
const EXCLUDED = ['/src/utils/safeToSpend.ts', '/src/utils/safeToSpend.test.ts', '/src/utils/safeToSpend.guard.test.ts']

describe('safeToSpend çağrı yeri guard', () => {
  it('her buildSafeToSpend çağrısı kasa rezervini geçer', () => {
    const offenders: string[] = []

    for (const [path, content] of Object.entries(sources)) {
      if (EXCLUDED.includes(path)) continue

      let index = content.indexOf('buildSafeToSpend(')
      while (index !== -1) {
        const args = callArguments(content, index + 'buildSafeToSpend'.length)
        if (!/\breserved\b/.test(args)) {
          offenders.push(`${path} → buildSafeToSpend çağrısında \`reserved\` yok`)
        }
        index = content.indexOf('buildSafeToSpend(', index + 1)
      }
    }

    expect(offenders).toEqual([])
  })

  it('taramanın gerçekten çağrı bulduğunu doğrular (glob boşsa test yalancı yeşil olurdu)', () => {
    const callSites = Object.entries(sources).filter(
      ([path, content]) => !EXCLUDED.includes(path) && content.includes('buildSafeToSpend('),
    )
    expect(callSites.length).toBeGreaterThanOrEqual(3)
  })
})
