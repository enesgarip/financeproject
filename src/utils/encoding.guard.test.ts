import { describe, expect, it } from 'vitest'

/**
 * Guard against UTF-8 mojibake regressing Turkish copy (KNOWN_RISKS #1).
 *
 * When UTF-8 text is saved/read as Windows-1252 or Latin-1, Turkish letters
 * leave tell-tale digraphs (ç -> "Ã§", ş -> "ÅŸ", ...). Smart punctuation leaves
 * "â€" sequences, and unrepresentable bytes become the replacement char. If any
 * of these appear in source, docs, or migrations, the encoding broke somewhere.
 *
 * Files are read as raw text at transform time via Vite's `?raw` glob, so the
 * guard needs no Node fs access and stays inside the browser tsconfig.
 */
const MOJIBAKE_SIGNATURES = [
  '�', // replacement character
  'Ã§', 'Ã‡', // ç / Ç
  'Ã¶', 'Ã–', // ö / Ö
  'Ã¼', 'Ãœ', // ü / Ü
  'ÅŸ', 'Åž', // ş / Ş
  'ÄŸ', 'Äž', // ğ / Ğ
  'Ä±', 'Ä°', // ı / İ
  'â€™', 'â€œ', 'â€“', 'â€”', // smart quotes / dashes
]

const sources: Record<string, string> = {
  ...import.meta.glob<string>('/src/**/*.{ts,tsx,js,jsx,css}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('/docs/**/*.md', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('/supabase/migrations/**/*.sql', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('/{README.md,index.html}', { query: '?raw', import: 'default', eager: true }),
}

// This file necessarily contains the literal signatures above, so it excludes
// itself from the scan to avoid a false positive.
const SELF = 'encoding.guard.test.ts'

describe('source encoding guard', () => {
  it('keeps Turkish text free of UTF-8 mojibake', () => {
    const offenders: string[] = []
    for (const [path, content] of Object.entries(sources)) {
      if (path.endsWith(SELF)) continue
      const hit = MOJIBAKE_SIGNATURES.find((signature) => content.includes(signature))
      if (hit) offenders.push(`${path} contains ${JSON.stringify(hit)}`)
    }

    expect(Object.keys(sources).length).toBeGreaterThan(0) // never pass by scanning nothing
    expect(offenders).toEqual([])
  })
})
