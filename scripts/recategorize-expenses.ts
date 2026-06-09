/**
 * One-off maintenance: fix card_expenses that were mis-categorised as "Ulaşım"
 * by the old substring keyword matcher (notably "taksi" matching inside
 * "taksit"/"taksitli", so instalment purchases landed in Ulaşım).
 *
 * Safety model — only rows where BOTH hold are touched:
 *   • the OLD substring logic returned 'Ulaşım'  (i.e. it was an auto label), and
 *   • the NEW word-boundary logic does NOT return 'Ulaşım'  (so it was a false hit).
 * Rows that are genuinely Ulaşım (e.g. a petrol station labelled via the PDF
 * section, with no keyword) have oldCat = null and are left untouched.
 *
 * The PDF "section" category isn't stored per expense, so rows with no real
 * keyword can't be perfectly restored — they become 'Diğer' (honest) instead of
 * a wrong 'Ulaşım'. Re-importing the statement is the only way to recover the
 * original section category; this script is the in-place alternative.
 *
 * Runs as YOU (anon key + your login), so RLS only lets it update your own rows.
 *
 * Usage (from repo root, Node 22.6+ / 24):
 *   # dry run — prints what WOULD change, writes nothing:
 *   SUPABASE_EMAIL=you@mail.com SUPABASE_PASSWORD='***' node scripts/recategorize-expenses.ts
 *   # apply:
 *   SUPABASE_EMAIL=you@mail.com SUPABASE_PASSWORD='***' node scripts/recategorize-expenses.ts --apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { categoryRules, inferExpenseCategory, normalizeDescription } from '../src/utils/categories.ts'

const FALLBACK_CATEGORY = 'Diğer'

// ── Load Supabase URL + anon key from .env.local (no extra deps) ────────────
function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// Old behaviour, kept here only to identify which rows the bug actually touched.
function oldInferExpenseCategory(description: string): string | null {
  const normalized = normalizeDescription(description)
  if (!normalized) return null
  return categoryRules.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)))?.category ?? null
}

type ExpenseRow = { id: string; description: string; category: string | null; status: string }

async function main() {
  const apply = process.argv.includes('--apply')
  const env = readEnvLocal()
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  const email = process.env.SUPABASE_EMAIL
  const password = process.env.SUPABASE_PASSWORD

  if (!url || !anonKey) {
    console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY bulunamadı (.env.local).')
    process.exit(1)
  }
  if (!email || !password) {
    console.error('SUPABASE_EMAIL ve SUPABASE_PASSWORD ortam değişkenlerini ver.')
    process.exit(1)
  }

  const supabase = createClient(url, anonKey)
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) {
    console.error(`Giriş başarısız: ${authError.message}`)
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('card_expenses')
    .select('id, description, category, status')
  if (error) {
    console.error(`Kayıtlar okunamadı: ${error.message}`)
    process.exit(1)
  }

  const rows = (data ?? []) as ExpenseRow[]
  const fixes = rows
    .filter((row) => row.category === 'Ulaşım')
    .map((row) => ({ row, next: inferExpenseCategory(row.description) ?? FALLBACK_CATEGORY }))
    .filter(({ row, next }) =>
      oldInferExpenseCategory(row.description) === 'Ulaşım' && // bug actually applied
      inferExpenseCategory(row.description) !== 'Ulaşım' &&    // fixed logic disagrees
      next !== 'Ulaşım',
    )

  if (fixes.length === 0) {
    console.log('Düzeltilecek "Ulaşım" kaydı bulunamadı. ✅')
    await supabase.auth.signOut()
    return
  }

  console.log(`\n${fixes.length} kayıt ${apply ? 'GÜNCELLENECEK' : 'DEĞİŞECEK (dry-run)'}:\n`)
  const byTarget: Record<string, number> = {}
  for (const { row, next } of fixes) {
    byTarget[next] = (byTarget[next] ?? 0) + 1
    console.log(`  Ulaşım → ${next.padEnd(10)} | ${row.description}`)
  }
  console.log('\nÖzet:', Object.entries(byTarget).map(([k, v]) => `${k}: ${v}`).join(' · '))

  if (!apply) {
    console.log('\nUygulamak için tekrar --apply ile çalıştır.')
    await supabase.auth.signOut()
    return
  }

  let ok = 0
  for (const { row, next } of fixes) {
    const { error: updErr } = await supabase.from('card_expenses').update({ category: next }).eq('id', row.id)
    if (updErr) console.error(`  ! ${row.id}: ${updErr.message}`)
    else ok++
  }
  console.log(`\n${ok}/${fixes.length} kayıt güncellendi. ✅`)
  await supabase.auth.signOut()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
