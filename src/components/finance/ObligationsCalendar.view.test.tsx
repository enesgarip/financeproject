// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import type { Card, Payment } from '../../types/database'
import type { FinanceObligationsInput } from '../../utils/obligations'
import { ObligationsCalendar } from './ObligationsCalendar'

const payment = { id: 'internet', title: 'İnternet', category: 'Fatura', amount: 700, due_date: '2026-10-20', status: 'bekliyor', recurrence: 'none', payment_method: 'manual' } as Payment
const data: FinanceObligationsInput = { cards: [], payments: [payment], loans: [], loanInstallments: [], debts: [], cardInstallments: [], cardStatements: [] }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T12:00:00+03:00'))
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('yaklaşanlar varsayılandır; ödeme düğmesi aynı kanonik yükümlülüğü aktarır', () => {
  const onPay = vi.fn()
  render(<BalancePrivacyProvider><ObligationsCalendar data={data} onPayObligation={onPay} /></BalancePrivacyProvider>)
  expect(screen.getByRole('button', { name: 'Yaklaşanlar' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('İnternet')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Ödeme kaydet' }))
  expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'internet', action: 'pay_payment', amount: 700, date: '2026-10-20' }))
})

it('takvim seçimini hatırlar; takvimden gün seçince aynı ödeme eylemi erişilebilir', () => {
  const view = render(<BalancePrivacyProvider><ObligationsCalendar data={data} onPayObligation={() => {}} /></BalancePrivacyProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Takvim' }))
  expect(localStorage.getItem('denge:payments-view')).toBe('calendar')
  view.unmount()
  render(<BalancePrivacyProvider><ObligationsCalendar data={data} onPayObligation={() => {}} /></BalancePrivacyProvider>)
  expect(screen.getByRole('button', { name: 'Takvim' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: /20 Eki 2026, 1 kayıt/ }))
  expect(screen.getByRole('button', { name: 'Ödeme kaydet' })).toBeTruthy()
})

it('gizlilik tercihi yeni liste görünümünde de tutarları maskeler', () => {
  localStorage.setItem('financeproject.balancePrivacy', 'hidden')
  render(<BalancePrivacyProvider><ObligationsCalendar data={data} /></BalancePrivacyProvider>)
  expect(screen.queryByText(/700,00/)).toBeNull()
  expect(screen.getAllByText('••••').length).toBeGreaterThan(0)
})

it('aylık kart talimatını ödeme düğmesi yerine otomatik takip olarak gösterir', () => {
  const automatic = { ...payment, recurrence: 'monthly', recurrence_day: 20, payment_method: 'bank_auto', auto_source_card_id: 'credit' } as Payment
  render(<BalancePrivacyProvider><ObligationsCalendar data={{ ...data, payments: [automatic], cards: [{ id: 'credit', card_type: 'kredi_karti', debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, due_day: null } as Card] }} onPayObligation={vi.fn()} /></BalancePrivacyProvider>)
  expect(screen.queryByRole('button', { name: 'Ödeme kaydet' })).toBeNull()
  expect(screen.getByText('Otomatik takip')).toBeTruthy()
})

it('ay seçimini abonelik eşleşme göstergesine iletir', () => {
  const onMonthChange = vi.fn()
  render(<BalancePrivacyProvider><ObligationsCalendar data={data} onMonthChange={onMonthChange} /></BalancePrivacyProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
  expect(onMonthChange).toHaveBeenLastCalledWith(new Date(2026, 10, 1))
  fireEvent.click(screen.getByRole('button', { name: 'Bugün' }))
  expect(onMonthChange).toHaveBeenLastCalledWith(new Date(2026, 9, 1))
})
