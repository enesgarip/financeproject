// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import type { Asset, Card, Debt } from '../../types/database'
import type { FinanceSummaryInput } from '../../utils/financeSummary'
import { CardPaymentCyclePanel } from './CardPaymentCyclePanel'

afterEach(cleanup)

it('vadesiz borcu senaryonun hem nakit akışından hem rezervinden iki kez düşmez', () => {
  const data: FinanceSummaryInput = {
    assets: [{ category: 'Nakit', estimated_value_try: 1000 } as Asset],
    cards: [{ id: 'credit', card_name: 'Kart', card_type: 'kredi_karti', statement_day: 25, due_day: 5, debt_amount: 0, current_period_spending: 0, statement_debt_amount: 0 } as Card],
    debts: [{ id: 'debt', status: 'açık', direction: 'borç_aldım', due_date: null, estimated_value_try: 200 } as Debt],
    loans: [], loanInstallments: [], payments: [], cardInstallments: [], salaryHistory: [],
  }
  render(<BalancePrivacyProvider><CardPaymentCyclePanel data={data} from={new Date(2026, 10, 3)} buffer={100} reserved={50} reservedKnown /></BalancePrivacyProvider>)
  fireEvent.change(screen.getByLabelText('Kayıtlı planların dışında aylık yeni kart harcaması (TL)'), { target: { value: '0' } })
  const table = screen.getByRole('table', { hidden: true })
  expect(within(table).getAllByText(/650,00/)).toHaveLength(12)
  expect(within(table).queryByText(/450,00/)).toBeNull()
})
