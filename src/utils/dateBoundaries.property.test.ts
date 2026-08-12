import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { getCardStatementPeriod, getNextCardPaymentDueDate } from './cardStatement'
import { addMonths, dateInMonth, dateInputValue, daysUntil, isDateInMonth, isUpcomingDate, monthlyOccurrenceDate } from './date'

/**
 * Tarih sınırı invariantları (ayın 29/30/31'i, Şubat, yıl geçişi).
 * Bu sınıftaki hatalar tek tek örnekle kovalanamayacak kadar çok kombinasyonlu;
 * burada kural sabitlenir, fast-check uzayı tarar. Bir karşı örnek çıkarsa
 * mesajdaki seed ile birebir tekrar üretilebilir.
 */

const dayArb = fc.integer({ min: 1, max: 31 })
// 2024 (artık yıl) → 2027 arası her gün: Şubat 29 ve yıl geçişleri dahil.
const dateArb = fc
  .date({ min: new Date(2024, 0, 1), max: new Date(2027, 11, 31), noInvalidDate: true })
  .map((value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()))

function creditCard(statementDay: number, dueDay: number): Pick<Card, 'card_type' | 'statement_day' | 'due_day'> {
  return { card_type: 'kredi_karti', statement_day: statementDay, due_day: dueDay }
}

describe('dateInMonth', () => {
  it('istenen günü ayın son gününe kırpar, asla sonraki aya taşmaz', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2024, max: 2027 }), fc.integer({ min: 0, max: 11 }), dayArb, (year, month, day) => {
        const result = dateInMonth(year, month, day)
        expect(result.getMonth()).toBe(month)
        expect(result.getFullYear()).toBe(year)
        expect(result.getDate()).toBeLessThanOrEqual(day)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('monthlyOccurrenceDate', () => {
  it('her zaman istenen ayın içinde kalır', () => {
    fc.assert(
      fc.property(dayArb, dateArb, (day, month) => {
        const occurrence = monthlyOccurrenceDate(day, month)
        expect(occurrence).not.toBeNull()
        expect(isDateInMonth(occurrence, month)).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('addMonths', () => {
  it('ay sonu günlerinde bir sonraki aya taşmaz (31 Ocak + 1 ay = Şubat sonu)', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -24, max: 24 }), (value, months) => {
        const result = addMonths(value, months)
        const expectedMonth = (((value.getMonth() + months) % 12) + 12) % 12
        expect(result.getMonth()).toBe(expectedMonth)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('getCardStatementPeriod', () => {
  it('harcama tarihi her zaman döndürülen dönemin içindedir', () => {
    fc.assert(
      fc.property(dayArb, dayArb, dateArb, (statementDay, dueDay, spentAt) => {
        const period = getCardStatementPeriod(creditCard(statementDay, dueDay), spentAt)
        expect(period).not.toBeNull()
        const spent = dateInputValue(spentAt)
        expect(period!.periodStart <= spent).toBe(true)
        expect(spent <= period!.periodEnd).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })

  it('son ödeme tarihi ekstre tarihinden önce olamaz', () => {
    fc.assert(
      fc.property(dayArb, dayArb, dateArb, (statementDay, dueDay, spentAt) => {
        const period = getCardStatementPeriod(creditCard(statementDay, dueDay), spentAt)!
        expect(period.dueDate > period.statementDate).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })

  it('ardışık dönemler boşluk ve örtüşme bırakmaz', () => {
    fc.assert(
      fc.property(dayArb, dayArb, dateArb, (statementDay, dueDay, spentAt) => {
        const card = creditCard(statementDay, dueDay)
        const period = getCardStatementPeriod(card, spentAt)!
        // Dönem bitiminin ertesi günü bir sonraki döneme ait olmalı.
        const nextDay = new Date(`${period.periodEnd}T00:00:00`)
        nextDay.setDate(nextDay.getDate() + 1)
        const nextPeriod = getCardStatementPeriod(card, nextDay)!
        expect(nextPeriod.periodStart).toBe(dateInputValue(nextDay))
      }),
      { numRuns: 3000 },
    )
  })
})

describe('getNextCardPaymentDueDate', () => {
  it('geçmiş bir vade döndürmez', () => {
    fc.assert(
      fc.property(dayArb, dateArb, (dueDay, from) => {
        const due = getNextCardPaymentDueDate(creditCard(15, dueDay), from)
        expect(due).not.toBeNull()
        expect(due! >= dateInputValue(from)).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })

  it('vade en fazla bir ay ilerideki gündür', () => {
    fc.assert(
      fc.property(dayArb, dateArb, (dueDay, from) => {
        const due = new Date(`${getNextCardPaymentDueDate(creditCard(15, dueDay), from)}T00:00:00`)
        const limit = addMonths(from, 1)
        limit.setDate(limit.getDate() + 1)
        expect(due <= limit).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })
})

describe('daysUntil — ISO saatli/timestamptz girdi (Faz F)', () => {
  // Bulgu: string girdiye körlemesine `T00:00:00` ekleniyordu; değer zaten saat
  // taşıyorsa ("…T13:00:00+03:00") sonuç Invalid Date → NaN gün oluyordu.
  // NaN her karşılaştırmada false verir, yani "yaklaşan" uyarıları SESSİZCE
  // kaybolur. Artık gün kısmı alınır (CLAUDE.md formatDate tuzağının kardeşi).
  const iso = (date: Date) => dateInputValue(date)

  it('date-only ve aynı günün timestamptz hâli aynı sonucu verir', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 23 }), (date, hour) => {
        const dayOnly = iso(date)
        const withTime = `${dayOnly}T${String(hour).padStart(2, '0')}:00:00+03:00`
        const expected = daysUntil(dayOnly)
        expect(expected).not.toBeNull()
        expect(Number.isNaN(expected!)).toBe(false)
        expect(daysUntil(withTime)).toBe(expected)
      }),
      { numRuns: 1000 },
    )
  })

  it('bugünün timestamptz hâli için 0 döner ve isUpcomingDate true kalır', () => {
    const today = iso(new Date())
    expect(daysUntil(`${today}T13:00:00+03:00`)).toBe(0)
    expect(isUpcomingDate(`${today}T13:00:00+03:00`)).toBe(true)
  })

  it('okunamayan tarihte NaN yerine null döner', () => {
    expect(daysUntil('bugün')).toBeNull()
    expect(isUpcomingDate('bugün')).toBe(false)
  })
})
