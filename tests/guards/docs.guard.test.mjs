import assert from 'node:assert/strict'
import { globSync, readFileSync, statSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Aynı pointer/harita kontrolleri; dosya içerikleri Vite modülüne dönüştürülmez.
const root = fileURLToPath(new URL('../../', import.meta.url))
const fileSet = new Set(globSync(['src/**/*', 'supabase/**/*'], { cwd: root })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => !file.split('/').some((part) => part.startsWith('.')))
  .filter((file) => statSync(path.join(root, file)).isFile()))
const curated = ['AGENTS.md', 'CLAUDE.md', 'docs/AI_CONTEXT_INDEX.md',
  'docs/PROJECT_CONTEXT.md', 'docs/CODEX_GUIDE.md', 'docs/PIPELINE.md']
const docs = Object.fromEntries(curated.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
const sourcePrefixes = ['utils/', 'pages/', 'components/', 'data/', 'services/', 'app/', 'lib/', 'auth/', 'types/', 'hooks/']

function extractFilePointers(content) {
  const inlineOnly = content.replace(/```[\s\S]*?```/g, '')
  const pointers = []
  for (const raw of inlineOnly.match(/`([^`]+)`/g) ?? []) {
    let token = raw.slice(1, -1).trim().replace(/:\d+$/, '')
    if (!token.includes('/') || /[*{}]/.test(token)) continue
    if (!['.ts', '.tsx', '.sql'].some((extension) => token.endsWith(extension))) continue
    if (sourcePrefixes.some((prefix) => token.startsWith(prefix))) token = `src/${token}`
    if (token.startsWith('src/') || token.startsWith('supabase/')) pointers.push(token)
  }
  return pointers
}

describe('AI-context docs guard', () => {
  it('never scans an empty doc/file set', () => {
    assert.ok(fileSet.size > 0)
    assert.ok(Object.keys(docs).length > 0)
  })

  it('keeps every file pointer in the curated docs pointing at a real file', () => {
    const broken = []
    let checked = 0
    for (const [file, content] of Object.entries(docs)) {
      for (const reference of extractFilePointers(content)) {
        checked++
        if (!fileSet.has(reference)) broken.push(`${file} → \`${reference}\` does not exist`)
      }
    }
    assert.ok(checked > 40, `En az 41 kaynak pointer'ı bekleniyor; bulunan: ${checked}`)
    assert.deepEqual(broken, [])
  })

  it('names every repository and route-level page in AI_CONTEXT_INDEX.md', () => {
    const index = docs['docs/AI_CONTEXT_INDEX.md']
    assert.ok(index.length > 0)
    const surfaces = [...fileSet]
      .filter((file) => (/^src\/data\/repositories\/[^/]+\.ts$/.test(file) && !file.endsWith('.test.ts'))
        || /^src\/pages\/[^/]+(Page|Hub)\.tsx$/.test(file))
      .map((file) => file.split('/').pop().replace(/\.tsx?$/, ''))
      .filter((name) => name !== 'LoginPage')
    assert.deepEqual(surfaces.filter((name) => !index.includes(name)), [])
  })
})
