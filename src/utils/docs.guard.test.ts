import { describe, expect, it } from 'vitest'

/**
 * Guard against AI-context docs drifting from the real source tree.
 *
 * Stale docs are worse than no docs: they send a cold AI session (Codex/Claude)
 * to files that moved or vanished, costing extra tool turns and risking wrong
 * edits. Two checks keep the navigation docs honest, both at transform time via
 * Vite's `?raw` / lazy glob (no Node fs, stays inside the browser tsconfig):
 *
 *   1. Broken-pointer guard — every concrete `*.ts/.tsx/.sql` path referenced in
 *      the curated docs must exist on disk.
 *   2. Structural-coverage guard — every repository and route-level page must be
 *      named in AI_CONTEXT_INDEX.md, so new data/UI surfaces get a map entry.
 *
 * Scope is the curated navigation set only (the docs whose whole job is correct
 * pointers). Narrative/historical docs (BACKLOG, KNOWN_RISKS, ...) are out of
 * scope on purpose — they may cite illustrative or retired paths.
 */

// --- file universe (keys only; lazy glob does not load file contents) ---------
const fileSet = new Set(
  Object.keys({
    ...import.meta.glob('/src/**/*'),
    ...import.meta.glob('/supabase/**/*'),
  }).map((p) => p.replace(/^\//, '')),
)

// --- curated docs, read as raw text ------------------------------------------
// Scope = the navigation docs whose whole job is correct pointers. Narrative/
// historical docs (BACKLOG, KNOWN_RISKS, ...) are out of scope on purpose.
const CURATED = new Set([
  '/AGENTS.md',
  '/CLAUDE.md',
  '/docs/AI_CONTEXT_INDEX.md',
  '/docs/PROJECT_CONTEXT.md',
  '/docs/CODEX_GUIDE.md',
  '/docs/PIPELINE.md',
])
const docs: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...import.meta.glob<string>('/*.md', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('/docs/*.md', { query: '?raw', import: 'default', eager: true }),
  }).filter(([path]) => CURATED.has(path)),
)

const KNOWN_EXT = ['.ts', '.tsx', '.sql']
// Bare layer prefixes used in the index's konu→dosya table resolve under `src/`.
const SRC_PREFIXES = ['utils/', 'pages/', 'components/', 'data/', 'services/', 'app/', 'lib/', 'auth/', 'types/', 'hooks/']

/** Pull backtick-wrapped tokens that name a concrete source file. */
function extractFilePointers(content: string): string[] {
  // Strip fenced ```code``` blocks first: their triple backticks otherwise
  // misalign the inline-backtick matcher and swallow whole table regions.
  const inlineOnly = content.replace(/```[\s\S]*?```/g, '')
  const tokens = inlineOnly.match(/`([^`]+)`/g) ?? []
  const out: string[] = []
  for (const raw of tokens) {
    let token = raw.slice(1, -1).trim().replace(/:\d+$/, '') // strip backticks + optional :line
    if (!token.includes('/')) continue // bare names are ambiguous → skip
    if (/[*{}]/.test(token)) continue // glob / brace patterns are not concrete files
    if (!KNOWN_EXT.some((ext) => token.endsWith(ext))) continue // only guard real file refs
    if (SRC_PREFIXES.some((p) => token.startsWith(p))) token = `src/${token}`
    if (!token.startsWith('src/') && !token.startsWith('supabase/')) continue // ignore non-repo paths
    out.push(token)
  }
  return out
}

describe('AI-context docs guard', () => {
  it('never scans an empty doc/file set', () => {
    expect(fileSet.size).toBeGreaterThan(0)
    expect(Object.keys(docs).length).toBeGreaterThan(0)
  })

  it('keeps every file pointer in the curated docs pointing at a real file', () => {
    const broken: string[] = []
    let checked = 0
    for (const [path, content] of Object.entries(docs)) {
      for (const ref of extractFilePointers(content)) {
        checked++
        if (!fileSet.has(ref)) broken.push(`${path} → \`${ref}\` does not exist`)
      }
    }
    expect(checked).toBeGreaterThan(40) // teeth: the curated docs cite many real files
    expect(broken).toEqual([])
  })

  it('names every repository and route-level page in AI_CONTEXT_INDEX.md', () => {
    const navMap = docs['/docs/AI_CONTEXT_INDEX.md'] ?? ''
    expect(navMap.length).toBeGreaterThan(0)

    // Route-level pages = *Page.tsx / *Hub.tsx (helper/section splits excluded).
    const PAGE_EXEMPT = new Set(['LoginPage']) // auth shell, not a task target
    const surfaces = [...fileSet]
      .filter(
        (p) =>
          (/^src\/data\/repositories\/[^/]+\.ts$/.test(p) && !p.endsWith('.test.ts')) ||
          /^src\/pages\/[^/]+(Page|Hub)\.tsx$/.test(p),
      )
      .map((p) => p.split('/').pop()!.replace(/\.tsx?$/, ''))
      .filter((name) => !PAGE_EXEMPT.has(name))

    const missing = surfaces.filter((name) => !navMap.includes(name))
    expect(missing).toEqual([])
  })
})
