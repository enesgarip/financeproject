import { MemoryRouter } from 'react-router'
// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../hooks/useBalancePrivacy'
import type { Card, Payment, TransactionHistory } from '../types/database'

const mocks = vi.hoisted(() => ({ rows: [] as Payment[], snapshot: {} as Record<string, unknown>, open: vi.fn() }))
vi.mock('../app/useFinanceSnapshot', () => ({
  useFinanceSnapshot: () => ({ data: mocks.snapshot, isPending: false, error: null }),
  useInvalidateFinanceSnapshot: () => vi.fn(),
}))
vi.mock('../data/repositories/cardsRepo', () => ({ fetchCards: vi.fn(), reconcileCardPaymentExpenses: vi.fn() }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ snapshotWindowStart: () => new Date('2024-10-01T00:00:00') }))
vi.mock('../data/repositories/crudRepo', () => ({ saveCrudRow: vi.fn() }))
vi.mock('../hooks/useFinancePaymentDrawer', () => ({ useFinancePaymentDrawer: () => ({ drawerProps: {}, openPaymentDrawer: mocks.open }) }))
vi.mock('../components/finance/FinancePaymentDrawer', () => ({ FinancePaymentDrawer: () => null }))
vi.mock('../components/CrudPage', () => ({ CrudPage: ({ renderBeforeList, renderCard, showList }: {
  showList: boolean
  renderBeforeList: (props: { loading: boolean; rows: Payment[]; reload: () => Promise<void> }) => ReactNode
  renderCard: (row: Payment, helpers: { menu: null; reload: () => Promise<void>; setError: () => void }) => ReactNode
}) => <>
  {renderBeforeList({ loading: false, rows: mocks.rows, reload: async () => {} })}
  {showList ? mocks.rows.map(row => <div key={row.id}>{renderCard(row, { menu: null, reload: async () => {}, setError: () => {} })}</div>) : null}
</> }))
import { PaymentsPage } from './PaymentsPage'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00')); localStorage.clear(); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('eşleşen ayı plan ilerlese de gösterir; ay değişimini izler ve manuel planın ödeme yolunu korur', () => {
  const base = { user_id: 'u', created_at: '2026-09-01', updated_at: '2026-10-12' }
  const automatic: Payment = { ...base, id: 'netflix', title: 'Netflix', category: 'Dijital üyelik', amount: 499.99,
    amount_status: 'estimated', due_date: '2026-11-12', status: 'bekliyor', payment_method: 'bank_auto', recurrence: 'monthly',
    recurrence_day: 12, recurrence_end_date: null, auto_source_card_id: 'credit', note: null }
  mocks.rows = [automatic, { ...automatic, id: 'rent', title: 'Kira', category: 'Kira / aidat', payment_method: 'manual', auto_source_card_id: null, due_date: '2026-10-20' }]
  mocks.snapshot = { cards: [{ ...base, id: 'credit', card_type: 'kredi_karti', bank_name: 'Banka', card_name: 'Kart',
    statement_day: null, due_day: null, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0 } as Card],
    loans: [], loanInstallments: [], debts: [], cardInstallments: [], cardStatements: [], cardStatementPayments: [], salaryHistory: [], cardExpenses: [],
    transactionHistory: [{ ...base, id: 'history', occurred_at: '2026-10-12T09:00:00Z', type: 'payment', title: 'Netflix banka kaydıyla eşlendi', amount: 499.99,
      source_table: 'payments', source_id: 'netflix', matched_card_expense_id: 'expense', payment_due_date: '2026-10-12', source_event_id: null, note: null } as TransactionHistory],
  }
  const view = render(<MemoryRouter><BalancePrivacyProvider><PaymentsPage /></BalancePrivacyProvider></MemoryRouter>)
  expect(screen.queryByRole('heading', { name: 'Netflix' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Kayıtlı planlar' }))
  const article = screen.getByRole('heading', { name: 'Netflix' }).closest('article')!
  expect(within(article).getByText('Ekim 2026 · Eşleşti')).toBeTruthy()
  expect(within(article).getByText(/Sıradaki: 12 Kas 2026/)).toBeTruthy()
  expect(within(article).queryByRole('button', { name: /ödeme kaydet/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Kira için ödeme kaydet' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Vadeler' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
  expect(screen.getAllByText('Otomatik takip').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Kayıtlı planlar' }))
  const novemberArticle = screen.getByRole('heading', { name: 'Netflix' }).closest('article')!
  expect(within(novemberArticle).getByText('Kasım 2026 · Henüz eşleşme yok')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Vadeler' }))
  fireEvent.click(screen.getByRole('button', { name: 'Bugün' }))
  fireEvent.click(screen.getByRole('button', { name: 'Kayıtlı planlar' }))
  expect(screen.getByText('Ekim 2026 · Eşleşti')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Kira için ödeme kaydet' }))
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'rent', action: 'pay_payment' }), expect.any(Object))
  view.unmount()
  localStorage.setItem('financeproject.balancePrivacy', 'hidden')
  render(<MemoryRouter><BalancePrivacyProvider><PaymentsPage /></BalancePrivacyProvider></MemoryRouter>)
  expect(screen.queryByText(/499,99/)).toBeNull()
})
