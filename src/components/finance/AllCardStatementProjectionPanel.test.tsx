// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import { CardsSummary } from '../../pages/CardsPage.summary'
import type { Card } from '../../types/database'
import { AllCardStatementProjectionPanel } from './AllCardStatementProjectionPanel'

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }))
vi.mock('../../app/useFinanceSnapshot', () => ({ useFinanceSnapshot: () => mocks.query() }))

function snapshot() {
  return {
    cards: [{ id: 'c1', card_name: 'Kartım', card_type: 'kredi_karti', statement_day: 15, due_day: 25, current_period_spending: 1234.56 }],
    cardInstallments: [], cardExpenses: [], payments: [], missingTables: [] as string[],
  }
}
function show() {
  return render(<BalancePrivacyProvider><AllCardStatementProjectionPanel /></BalancePrivacyProvider>)
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18))
  mocks.refetch.mockReset()
  mocks.query.mockReset()
  mocks.query.mockReturnValue({ data: snapshot(), isError: false, isFetching: false, refetch: mocks.refetch })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })

it('üç kesim ayını ve kırılımı gösterir; kesilmiş borçla ödeme ayını ayırır', () => {
  show()
  expect(screen.getByText('Kasım 2026')).toBeTruthy()
  expect(screen.getByText('Aralık 2026')).toBeTruthy()
  expect(screen.getByText('Ocak 2027')).toBeTruthy()
  expect(screen.getByText(/~1.234,56/)).toBeTruthy()
  expect(screen.getByText(/Son ödeme ayı farklı olabilir/)).toBeTruthy()
  expect(screen.getByText(/Kesilmiş ekstre borçları/)).toBeTruthy()
})
it('gizlilik açıkken toplam ve tüm kırılımları maskeler', () => {
  localStorage.setItem('financeproject.balancePrivacy', 'hidden')
  const { container } = show()
  expect(container.textContent).toContain('••••')
  expect(container.textContent).not.toContain('1.234,56')
  expect(container.textContent).not.toContain('0,00')
})
it('ilk yüklemede doğrulanmamış sıfır toplam göstermez', () => {
  mocks.query.mockReturnValue({ data: undefined, isError: false })
  show()
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText(/~0,00/)).toBeNull()
})
it('arka plan hatasında eski toplamı güvenilir göstermez; tekrar denemeyi bağlar', () => {
  mocks.query.mockReturnValue({ data: snapshot(), isError: true, isFetching: false, refetch: mocks.refetch })
  show()
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.queryByText(/1.234,56/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
  expect(mocks.refetch).toHaveBeenCalledOnce()
})
it('taksit tablosuna erişilemiyorsa eksik toplamı göstermez', () => {
  mocks.query.mockReturnValue({ data: { ...snapshot(), missingTables: ['card_installments'] }, isError: false, refetch: mocks.refetch })
  show()
  expect(screen.getByRole('alert').textContent).toContain('Taksit verilerine erişilemedi')
  expect(screen.queryByText(/1.234,56/)).toBeNull()
})
it('takvimi eksik kartı adlandırır; hesaplanamayan toplamı sıfır saymaz', () => {
  const data = snapshot()
  mocks.query.mockReturnValue({ data: { ...data, cards: [{ ...data.cards[0], statement_day: null }] }, isError: false })
  show()
  expect(screen.getByRole('alert').textContent).toContain('Kartım')
  expect(screen.getByText(/tamamlanınca tahmin gösterilir/)).toBeTruthy()
  expect(screen.queryByText(/~0,00/)).toBeNull()
})

it('tahmini yalnız Borç kırılımı ve dökümler açıldığında kurar; aynı katmanın içinde gösterir', () => {
  const cards = [{ ...snapshot().cards[0], debt_amount: 1234.56, statement_debt_amount: 0, provision_amount: 0 }] as Card[]
  const { container } = render(<BalancePrivacyProvider><CardsSummary rows={cards} installments={[]} statements={[]} statementPayments={[]} installmentsLoading={false} installmentsError="" statementsLoading={false} statementError="" section="kartlar" panel={null} onOpenPanel={vi.fn()} /></BalancePrivacyProvider>)
  expect(mocks.query).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Tüm kartların ekstre tahmini' })).toBeNull()
  const details = screen.getByText('Borç kırılımı ve dökümler').closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(details.contains(screen.getByRole('region', { name: 'Tüm kartların ekstre tahmini' }))).toBe(true)
  expect(screen.getByRole('heading', { name: 'Önümüzdeki 3 ay · tüm kartlar' })).toBeTruthy()
  expect(container.querySelectorAll('details')).toHaveLength(1)
})
