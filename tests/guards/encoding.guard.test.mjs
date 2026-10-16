import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// İmzalar eski guard ile aynı; bu dosya taranan src/docs/migration alanı dışındadır.
const signatures = ['�', 'Ã§', 'Ã‡', 'Ã¶', 'Ã–', 'Ã¼', 'Ãœ', 'ÅŸ', 'Åž',
  'ÄŸ', 'Äž', 'Ä±', 'Ä°', 'â€™', 'â€œ', 'â€“', 'â€”']
const root = fileURLToPath(new URL('../../', import.meta.url))
const files = globSync(['src/**/*.{ts,tsx,js,jsx,css}', 'docs/**/*.md',
  'supabase/migrations/**/*.sql', 'README.md', 'README.tr.md', 'index.html'], { cwd: root })
  .filter((file) => !file.replaceAll('\\', '/').split('/').some((part) => part.startsWith('.')))

describe('source encoding guard', () => {
  it('keeps Turkish text free of UTF-8 mojibake', () => {
    assert.ok(files.length > 0)
    const offenders = []
    for (const file of files) {
      const content = readFileSync(path.join(root, file), 'utf8')
      const signature = signatures.find((candidate) => content.includes(candidate))
      if (signature) offenders.push(`${file} contains ${JSON.stringify(signature)}`)
    }
    assert.deepEqual(offenders, [])
  })
})
