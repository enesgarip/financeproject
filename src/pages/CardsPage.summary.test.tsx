// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { CardsSummary } from './CardsPage.summary'

vi.mock('../hooks/useBalancePrivacy', () => ({ useBalancePrivacy: () => ({ formatAmount: (value: number) => `${value.toFixed(2)} TL` }) }))
afterEach(cleanup)

const props = {
  rows: [{ id: 'c1', card_type: 'kredi_karti', current_period_spending: 100, provision_amount: 20, debt_amount: 230, statement_debt_amount: 50 }] as Card[],
  installments: [{ id: 'i1', card_id: 'c1', status: 'scheduled', amount: 60 }, { id: 'i2', card_id: 'c1', status: 'posted', amount: 10 }] as CardInstallment[],
  statements: [{ id: 's1', card_id: 'c1', status: 'open', statement_debt_amount: 50 }] as CardStatementArchive[],
  statementPayments: [{ statement_archive_id: 's1', amount: 10 }] as CardStatementPayment[],
  installmentsLoading: false, installmentsError: '', statementsLoading: false, statementError: '', section: 'kartlar' as const, panel: null, onOpenPanel: vi.fn(),
}

describe('kart özeti', () => {
  it('dönem içi, provizyon, gelecek taksit ve ekstre kalanını ayrı gösterir', () => {
    render(<CardsSummary {...props} />)
    expect(within(screen.getByRole('button', { name: /Dönem içi toplam/ })).getByText('100.00 TL')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /Gelecek taksit toplamı/ })).getByText('60.00 TL')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /Ödenecek ekstre/ })).getByText('40.00 TL')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: /Bekleyen provizyon/ })).getByText('20.00 TL')).toBeTruthy()
  })

  it('taksit sorgusu hata verince sıfır toplam iddiası üretmez', () => {
    render(<CardsSummary {...props} installments={[]} installmentsError="Bağlantı kurulamadı" />)
    const total = screen.getByRole('button', { name: /Gelecek taksit toplamı/ })
    expect(within(total).getByText('—')).toBeTruthy()
    expect(within(total).getByText('Bağlantı kurulamadı')).toBeTruthy()
    expect(within(total).queryByText('0.00 TL')).toBeNull()
  })
})
