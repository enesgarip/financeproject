/**
 * Otomasyon kapsamı: harcamaların ne kadarı kendiliğinden geldi, ne kadarı
 * elle yazıldı? "Manuel yükü azaltalım" kararının nereye yatırım yapacağını
 * tahminle değil veriyle seçmek için.
 *
 * Kaynak `card_expenses.source` kolonundan gelir (2026-07-27'de eklendi).
 * Kolon NULL olan iki durum vardır:
 *  - Eski kayıtlar → 'unknown'
 *  - `pay_payment` / carryover gibi kolonu yazmayan RPC'ler → note metninden
 *    türetilir (bu RPC'leri yeniden yazmak kazancına göre yüksek riskliydi).
 * Saf fonksiyon; Supabase görmez.
 */
import type { CardExpense, CardExpenseSource } from '../types/database'
import { normalizeSearchText } from './searchText'
import { sumTL } from './money'

export type CoverageBucket = CardExpenseSource | 'unknown'

/** Otomatik sayılan kaynaklar — kullanıcı tek tek yazmadı. */
const AUTOMATIC: ReadonlySet<CoverageBucket> = new Set<CoverageBucket>([
  'sms',
  'statement_import',
  'movement_import',
  'receipt_scan',
  'payment_auto',
  'carryover',
])

export const COVERAGE_LABELS: Record<CoverageBucket, string> = {
  manual: 'Elle giriş',
  sms: 'SMS otomasyonu',
  statement_import: 'Ekstre import',
  movement_import: 'Hareket import',
  receipt_scan: 'Fiş tarama',
  payment_auto: 'Kart talimatı',
  carryover: 'Taksit devri',
  unknown: 'Bilinmiyor (eski kayıt)',
}

/** Kolon boşsa note metninden kaynağı türetir (eski/yan RPC yolları). */
export function classifyExpenseSource(expense: Pick<CardExpense, 'source' | 'note'>): CoverageBucket {
  if (expense.source) return expense.source

  const note = normalizeSearchText(expense.note ?? '')
  if (!note) return 'unknown'
  if (note.includes('odeme kaydindan olusturuldu')) return 'payment_auto'
  if (note.includes('taksit devri') || note.includes('taksit odenmis')) return 'carryover'
  if (note.includes('sms otomasyonu')) return 'sms'
  return 'unknown'
}

export type CoverageRow = {
  bucket: CoverageBucket
  label: string
  count: number
  amount: number
  /** Sayı bazlı pay (%), 0-100. */
  countShare: number
}

export type AutomationCoverage = {
  rows: CoverageRow[]
  totalCount: number
  /** Kaynağı bilinen kayıtlar içinde otomatik gelenlerin payı (%), 0-100. */
  automationRate: number | null
  /** Kaynağı bilinen kayıt sayısı (oranın paydası). */
  classifiedCount: number
  manualCount: number
}

/**
 * Kapsam özeti. `unknown` kayıtlar oranın DIŞINDA tutulur — eski veriyi
 * "elle giriş" saymak otomasyon oranını haksız yere düşürürdü.
 */
export function buildAutomationCoverage(expenses: Pick<CardExpense, 'source' | 'note' | 'amount' | 'status'>[]): AutomationCoverage {
  const active = expenses.filter((expense) => expense.status !== 'cancelled')

  const counts = new Map<CoverageBucket, { count: number; amounts: number[] }>()
  for (const expense of active) {
    const bucket = classifyExpenseSource(expense)
    const entry = counts.get(bucket) ?? { count: 0, amounts: [] }
    entry.count += 1
    entry.amounts.push(expense.amount)
    counts.set(bucket, entry)
  }

  const totalCount = active.length
  const rows: CoverageRow[] = Array.from(counts.entries())
    .map(([bucket, entry]) => ({
      bucket,
      label: COVERAGE_LABELS[bucket],
      count: entry.count,
      amount: sumTL(entry.amounts),
      countShare: totalCount > 0 ? Math.round((entry.count / totalCount) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const classifiedCount = rows
    .filter((row) => row.bucket !== 'unknown')
    .reduce((total, row) => total + row.count, 0)
  const automaticCount = rows
    .filter((row) => AUTOMATIC.has(row.bucket))
    .reduce((total, row) => total + row.count, 0)
  const manualCount = counts.get('manual')?.count ?? 0

  return {
    rows,
    totalCount,
    classifiedCount,
    manualCount,
    automationRate: classifiedCount > 0 ? Math.round((automaticCount / classifiedCount) * 100) : null,
  }
}
