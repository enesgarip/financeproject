import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { buildCategorySpending, calendarPeriodRange, categoryMonthLabel, categoryPeriodOptions, type CategoryHistory, type CategorySelection } from './categorySpending'

const today = new Date(2026, 10, 2)
const cards = [
  { id: 'a', card_name: 'Dördünde kesilen', card_type: 'kredi_karti', statement_day: 4, due_day: 14 },
  { id: 'b', card_name: 'Yirmisinde kesilen', card_type: 'kredi_karti', statement_day: 20, due_day: null },
  { id: 'bank', card_name: 'Hesap', card_type: 'banka_karti' },
] as Card[]
const selection: CategorySelection = { mode: 'statement', cardId: 'all', period: 'current' }
const expense = (id: string, overrides: Partial<CategoryHistory['expenses'][number]> = {}): CategoryHistory['expenses'][number] => ({ id, card_id: 'a', spent_at: '2026-10-10', statement_archive_id: null, amount: 100, description: id, category: 'Market', installment_count: 1, status: 'posted', ...overrides })
const installment = (id: string, overrides: Partial<CategoryHistory['installments'][number]> = {}): CategoryHistory['installments'][number] => ({ id, card_id: 'a', card_expense_id: 'parent', statement_archive_id: null, due_month: '2026-11-01', amount: 50, description: id, category: 'Giyim', installment_no: 2, installment_count: 3, status: 'posted', ...overrides })
const history = (overrides: Partial<CategoryHistory> = {}): CategoryHistory => ({ expenses: [], installments: [], statements: [], ...overrides })

describe('kategori dönemi', () => {
  it('ayın ikisinde dördünde kesilen kartın Ekim harcamalarını korur; her kart kendi aralığını kullanır', () => {
    const result = buildCategorySpending(cards, history({ expenses: [expense('oct'), expense('nov', { spent_at: '2026-11-02' }), expense('too-old', { spent_at: '2026-10-04' }), expense('b-old', { card_id: 'b', spent_at: '2026-10-20' }), expense('b-new', { card_id: 'b', spent_at: '2026-10-21' }), expense('bank', { card_id: 'bank' })] }), selection, today)
    expect(result.total).toBe(300)
    expect(result.periods.map(row => [row.start, row.end])).toEqual([['2026-10-05', '2026-11-04'], ['2026-10-21', '2026-11-20']])
    expect(result.warnings).toEqual([])
  })
  it('tek kart, iptal, provizyon, gelecek tarih ve eski ekstre bağını ayırır', () => {
    const result = buildCategorySpending(cards, history({ expenses: [expense('ok'), expense('cancel', { status: 'cancelled' }), expense('provision', { status: 'provision' }), expense('future', { spent_at: '2026-11-03' }), expense('archived', { statement_archive_id: 'old' }), expense('other', { card_id: 'b' })] }), { ...selection, cardId: 'a' }, today)
    expect(result.total).toBe(100)
    expect(result.categories[0].rows.map(row => row.id)).toEqual(['expense:ok'])
  })
  it('kesim günü dahil, ertesi gün yeni dönemdir; kesim bugün kaydedilmişse yeni döneme geçer', () => {
    const h = history({ expenses: [expense('cut', { spent_at: '2026-11-04' })] })
    expect(buildCategorySpending(cards, h, { ...selection, cardId: 'a' }, new Date(2026, 10, 4)).total).toBe(100)
    expect(buildCategorySpending(cards, h, { ...selection, cardId: 'a' }, new Date(2026, 10, 5)).total).toBe(0)
    h.statements.push({ id: 'cut', card_id: 'a', statement_date: '2026-11-04', statement_debt_amount: 100 })
    expect(buildCategorySpending(cards, h, { ...selection, cardId: 'a' }, new Date(2026, 10, 4)).periods[0].start).toBe('2026-11-05')
  })
  it('ay sonunu, Şubat ve yıl geçişini ortak tarih kuralıyla hesaplar', () => {
    const monthEndCards = [{ ...cards[0], statement_day: 31 }]
    expect(buildCategorySpending(monthEndCards, history(), selection, new Date(2026, 2, 2)).periods[0]).toMatchObject({ start: '2026-03-01', end: '2026-03-31' })
    expect(buildCategorySpending(cards, history(), selection, new Date(2027, 0, 2)).periods[0]).toMatchObject({ start: '2026-12-05', end: '2027-01-04' })
  })
  it('kesim günü eksik kartı dışlar ve adlandırır; vade günü gerekmez', () => {
    const result = buildCategorySpending([{ ...cards[0], statement_day: null }, cards[1]], history(), selection, today)
    expect(result.periods.map(row => row.cardId)).toEqual(['b'])
    expect(result.warnings[0]).toContain('Dördünde kesilen')
  })
  it('geçmişi gerçek arşiv bağlantısından bulur; bugünkü kesim gününü geçmişe uygulamaz', () => {
    const h = history({ statements: [{ id: 'prev', card_id: 'a', statement_date: '2026-09-08', statement_debt_amount: 0 }, { id: 'oct', card_id: 'a', statement_date: '2026-10-08', statement_debt_amount: 150 }], expenses: [expense('old-date', { spent_at: '2026-08-10', statement_archive_id: 'oct' }), expense('unlinked'), expense('parent', { amount: 150, installment_count: 3, statement_archive_id: 'oct' })], installments: [installment('paid', { statement_archive_id: 'oct', status: 'paid' })] })
    const result = buildCategorySpending(cards, h, { ...selection, cardId: 'a', period: '2026-10' }, today)
    expect(result.total).toBe(150)
    expect(result.periods[0]).toMatchObject({ start: '2026-09-09', end: '2026-10-08' })
    expect(result.warnings).toEqual([])
  })
  it('taksitte parent toplamı eklenmez; posted/paid çocuk sayılır, scheduled ve iptal parent çocuğu sayılmaz', () => {
    const h = history({ expenses: [expense('parent', { amount: 150, installment_count: 3 }), expense('cancelled', { status: 'cancelled', installment_count: 2 })], installments: [installment('posted'), installment('paid', { status: 'paid', amount: 25 }), installment('planned', { status: 'scheduled' }), installment('cancelled-child', { card_expense_id: 'cancelled' }), installment('future', { due_month: '2026-12-01' })] })
    const result = buildCategorySpending(cards, h, selection, today)
    expect(result.total).toBe(75)
    expect(result.categories[0].rows[0].installment).toBe('2/3 taksit')
  })
  it('eksik ekstre ve tutar farkı kısmi veri olarak açıklanır; ilk arşivin başlangıcı uydurulmaz', () => {
    const result = buildCategorySpending(cards, history({ statements: [{ id: 'oct', card_id: 'a', statement_date: '2026-10-04', statement_debt_amount: 900 }], expenses: [expense('partial', { statement_archive_id: 'oct' })] }), { ...selection, period: '2026-10' }, today)
    expect(result.total).toBe(100)
    expect(result.periods[0].start).toBeNull()
    expect(result.warnings.join(' ')).toContain('tamamını temsil etmeyebilir')
    expect(result.warnings.join(' ')).toContain('Yirmisinde kesilen: bu ay için kayıtlı ekstre yok')
  })
  it('takvim ayında alışveriş toplamı ve banka harcaması sayılır; çocuk taksit tekrar eklenmez', () => {
    const result = buildCategorySpending(cards, history({ expenses: [expense('parent', { installment_count: 3, amount: 150 }), expense('bank', { card_id: 'bank' }), expense('nov', { spent_at: '2026-11-01' })], installments: [installment('child', { due_month: '2026-10-01' })] }), { mode: 'calendar', cardId: 'all', period: '2026-10' }, today)
    expect(result.total).toBe(250)
    expect(result.periods).toEqual([])
  })
  it('kuruş toplamı, boş kategori ve tüm kategoriler korunur', () => {
    const result = buildCategorySpending(cards, history({ expenses: [expense('a', { amount: 0.1, category: '' }), expense('b', { amount: 0.2, category: '' }), ...Array.from({ length: 10 }, (_, i) => expense(`c${i}`, { category: `Kategori ${i}` }))] }), selection, today)
    expect(result.total).toBe(1000.3)
    expect(result.categories).toHaveLength(11)
    expect(result.categories.at(-1)).toMatchObject({ category: 'Diğer', amount: 0.3 })
  })
  it('geçmiş seçenekleri kart/kapsam bazında, tarih sınırı olmadan sıralanır', () => {
    const h = history({ statements: [{ id: 'old', card_id: 'a', statement_date: '2021-05-04', statement_debt_amount: 0 }, { id: 'b', card_id: 'b', statement_date: '2026-10-20', statement_debt_amount: 0 }], expenses: [expense('old', { spent_at: '2021-05-01' }), expense('pending', { spent_at: '2020-01-01', status: 'provision' })] })
    expect(categoryPeriodOptions(h, selection, today)).toEqual(['2026-10', '2021-05'])
    expect(categoryPeriodOptions(h, { ...selection, cardId: 'a' }, today)).toEqual(['2021-05'])
    expect(categoryPeriodOptions(h, { ...selection, mode: 'calendar' }, today)).toEqual(['2026-11', '2021-05'])
    expect(calendarPeriodRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(categoryMonthLabel('2026-11')).toBe('Kasım 2026')
  })
})
