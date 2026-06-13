import type { InsertFor, PaymentCategory } from '../types/database'
import { dateInputValue } from './date'

/**
 * Türkiye finans takvimi preset'leri (roadmap Y4). Sabit ulusal son-ödeme
 * tarihleri olan yinelenen yükümlülükler. `payments.recurrence` yalnız
 * 'none'|'monthly' desteklediği (yıllık yok) için preset, her kalemin
 * GELECEKTEKİ İLK taksitini tarihli tek-seferlik `payment` satırı olarak
 * oluşturur (tutar 0 + 'estimated' → kullanıcı doldurur). Böylece mevcut
 * yükümlülük/takvim makinesi şema değişmeden çalışır.
 *
 * Tarihler yaklaşıktır (resmi takvim hafta sonuna denk gelince kayabilir);
 * kullanıcı tutarı girerken tarihi de teyit eder.
 */

export type PresetOccurrence = { month: number; day: number; label: string }

export type ObligationPreset = {
  id: string
  title: string
  category: PaymentCategory
  note: string
  occurrences: PresetOccurrence[]
}

export const OBLIGATION_PRESETS: ObligationPreset[] = [
  {
    id: 'mtv',
    title: 'MTV (Motorlu Taşıtlar Vergisi)',
    category: 'Vergi / devlet',
    note: 'İki taksit: Ocak ve Temmuz. Tutar araca göre değişir.',
    occurrences: [
      { month: 1, day: 31, label: '1. taksit' },
      { month: 7, day: 31, label: '2. taksit' },
    ],
  },
  {
    id: 'emlak',
    title: 'Emlak Vergisi',
    category: 'Vergi / devlet',
    note: 'İki taksit: Mayıs ve Kasım. Tutar belediye/taşınmaza göre değişir.',
    occurrences: [
      { month: 5, day: 31, label: '1. taksit' },
      { month: 11, day: 30, label: '2. taksit' },
    ],
  },
  {
    id: 'gelir-vergisi',
    title: 'Yıllık gelir vergisi beyanı',
    category: 'Vergi / devlet',
    note: 'Kira geliri (GMSİ) dahil; Mart beyan, Mart ve Temmuz taksit.',
    occurrences: [
      { month: 3, day: 31, label: '1. taksit / beyan' },
      { month: 7, day: 31, label: '2. taksit' },
    ],
  },
]

export function getPreset(id: string): ObligationPreset | undefined {
  return OBLIGATION_PRESETS.find((p) => p.id === id)
}

/** Bir (ay, gün) için bugünden itibaren gelecekteki ilk tarihi YYYY-MM-DD verir. */
function nextOccurrenceDate(month: number, day: number, today: Date): string {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let candidate = new Date(start.getFullYear(), month - 1, day)
  if (candidate < start) candidate = new Date(start.getFullYear() + 1, month - 1, day)
  return dateInputValue(candidate)
}

/**
 * Bir preset için eklenecek payment satırlarını üretir. Aynı (başlık, tarih)
 * zaten varsa (existing) atlar → mükerrer kayıt olmaz.
 */
export function buildPresetPayments(
  preset: ObligationPreset,
  userId: string,
  today: Date,
  existing: { title: string; due_date: string | null }[] = [],
): InsertFor<'payments'>[] {
  const seen = new Set(existing.map((p) => `${p.title}__${p.due_date ?? ''}`))
  const rows: InsertFor<'payments'>[] = []

  for (const occ of preset.occurrences) {
    const dueDate = nextOccurrenceDate(occ.month, occ.day, today)
    const title = `${preset.title} – ${occ.label}`
    if (seen.has(`${title}__${dueDate}`)) continue
    seen.add(`${title}__${dueDate}`)
    rows.push({
      user_id: userId,
      title,
      category: preset.category,
      amount: 0,
      amount_status: 'estimated',
      due_date: dueDate,
      status: 'bekliyor',
      payment_method: 'manual',
      recurrence: 'none',
      recurrence_day: null,
      recurrence_end_date: null,
      auto_source_card_id: null,
      note: preset.note,
    } as InsertFor<'payments'>)
  }

  return rows
}
