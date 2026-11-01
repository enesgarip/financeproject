// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../hooks/useBalancePrivacy'
import type { AnalysisData } from '../utils/analysisView'
import type { CategoryHistory } from '../utils/categorySpending'
import { CategorySpendingChart } from './AnalysisPage.categories'

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }))
vi.mock('../app/useCategorySpendingHistory', () => ({ useCategorySpendingHistory: () => mocks.query() }))
const data = { cards: [{ id: 'a', card_name: 'Kart A', card_type: 'kredi_karti', statement_day: 4, due_day: 14 }, { id: 'b', card_name: 'Kart B', card_type: 'kredi_karti', statement_day: 20, due_day: 30 }] } as AnalysisData
const h: CategoryHistory = {
  expenses: [{ id: 'oct', card_id: 'a', statement_archive_id: null, spent_at: '2026-10-10', amount: 123.45, description: 'Market alışverişi 123,45 TL', category: 'Market', installment_count: 1, status: 'posted' }, { id: 'nov', card_id: 'b', statement_archive_id: null, spent_at: '2026-11-01', amount: 55, description: 'Yemek', category: 'Yemek', installment_count: 1, status: 'posted' }, { id: 'old', card_id: 'a', statement_archive_id: 's', spent_at: '2026-09-15', amount: 77, description: 'Geçmiş alışveriş', category: 'Market', installment_count: 1, status: 'posted' }],
  installments: [], statements: [{ id: 's', card_id: 'a', statement_date: '2026-10-04', statement_debt_amount: 77 }],
}
function show() { return render(<BalancePrivacyProvider><CategorySpendingChart data={data} /></BalancePrivacyProvider>) }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 2))
  mocks.query.mockReturnValue({ data: h, isPending: false, isError: false, refetch: mocks.refetch })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks() })

it('güncel ekstreyle açılır; kartların farklı tarihleri ve kategori ayrıntıları görünür', () => {
  show()
  expect((screen.getByLabelText('Görünüm') as HTMLSelectElement).value).toBe('statement')
  expect(screen.getByText(/05 Eki 2026 – 04 Kas 2026/)).toBeTruthy()
  expect(screen.getByText(/21 Eki 2026 – 20 Kas 2026/)).toBeTruthy()
  const summary = screen.getByText('Market', { selector: 'summary span.font-semibold' }).closest('summary')!
  fireEvent.click(summary)
  expect(screen.getByText('Market alışverişi 123,45 TL')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Kart'), { target: { value: 'a' } })
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(screen.queryByText('Yemek', { selector: 'summary span.font-semibold' })).toBeNull()
})
it('geçmiş kesim ayına ve takvim ayına geçer; kapsam ve ayrıntılar yenilenir', () => {
  show()
  fireEvent.change(screen.getByLabelText('Dönem'), { target: { value: '2026-10' } })
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(screen.getByText('Geçmiş alışveriş')).toBeTruthy()
  expect(screen.queryByText('Market alışverişi 123,45 TL')).toBeNull()
  expect(screen.getByText(/Kart B: bu ay için kayıtlı ekstre yok/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Görünüm'), { target: { value: 'calendar' } })
  expect((screen.getByLabelText('Dönem') as HTMLSelectElement).value).toBe('2026-11')
  expect(screen.getByText(/01 Kas 2026 – 30 Kas 2026/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Dönem'), { target: { value: '2026-10' } })
  expect(screen.getByText('Market alışverişi 123,45 TL')).toBeTruthy()
})
it('yükleme ve arka plan hatasında eski/sıfır toplam sunmaz; tekrar deneme çalışır', () => {
  mocks.query.mockReturnValue({ data: undefined, isPending: true })
  const view = show()
  expect(screen.getByRole('status').textContent).toContain('yükleniyor')
  view.unmount()
  mocks.query.mockReturnValue({ data: h, isPending: false, isError: true, isFetching: false, refetch: mocks.refetch })
  show()
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByText('Tekrar dene'))
  expect(mocks.refetch).toHaveBeenCalledOnce()
})
it('gizlilik toplamı, satır tutarı, açıklama ve erişilebilir grafik metnini maskeler', () => {
  localStorage.setItem('financeproject.balancePrivacy', 'hidden')
  const { container } = show()
  expect(container.textContent).not.toContain('123,45')
  expect(container.textContent).toContain('••••')
  expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('178,45')
})
it('kategori hareketlerini onarlı sayfalar; toplam sayfaya bağlı değildir', () => {
  mocks.query.mockReturnValue({ data: { ...h, expenses: Array.from({ length: 12 }, (_, i) => ({ ...h.expenses[0], id: String(i).padStart(2, '0'), description: `Alışveriş ${i}` })) }, isPending: false })
  show()
  expect(screen.getAllByRole('listitem')).toHaveLength(10)
  expect(screen.getByText('1 / 2')).toBeTruthy()
  fireEvent.click(screen.getByText('Sonraki'))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('2 / 2')).toBeTruthy()
  expect(screen.getAllByText('1.481,40 ₺').length).toBeGreaterThan(0)
})
