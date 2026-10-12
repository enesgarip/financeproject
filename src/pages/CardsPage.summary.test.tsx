// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { CardsSummary, SharedLimitGroups } from './CardsPage.summary'

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


describe('ortak limit grupları', () => {
  it('limiti bir kez sayar, tüm kart borçlarını toplar ve kart ayrıntısını açar', () => {
    const first = { ...props.rows[0], bank_name: 'Banka', card_name: 'Birinci kart', limit_group_name: 'Aile', credit_limit: 1000 }
    const second = { ...first, id: 'c2', card_name: 'İkinci kart', credit_limit: 900, debt_amount: 170 }
    const standalone = { ...first, id: 'c3', card_name: 'Tekil kart', limit_group_name: null }
    const onOpenCard = vi.fn()
    render(<SharedLimitGroups rows={[first, second, standalone] as Card[]} onOpenCard={onOpenCard} />)
    const region = screen.getByRole('region', { name: 'Ortak limit grupları' })
    fireEvent.click(within(region).getByText('Aile · 2 kart'))
    expect(within(region).getByText('1000.00 TL')).toBeTruthy()
    expect(within(region).getByText('400.00 TL')).toBeTruthy()
    expect(within(region).getByText('600.00 TL')).toBeTruthy()
    expect(within(region).queryByText('Tekil kart')).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: 'İkinci kart' }))
    expect(onOpenCard).toHaveBeenCalledWith(second)
  })

  it('isimli tek kartlı grubu gösterir', () => {
    render(<SharedLimitGroups rows={[{ ...props.rows[0], limit_group_name: 'Aile', credit_limit: 1000 } as Card]} onOpenCard={vi.fn()} />)
    expect(screen.getByText('Aile · 1 kart')).toBeTruthy()
  })

  it('grup yoksa oluşturma yolunu açıklar', () => {
    render(<SharedLimitGroups rows={[]} onOpenCard={vi.fn()} />)
    expect(screen.getByText('Henüz ortak limit grubu yok.')).toBeTruthy()
    expect(screen.getByText(/kartı düzenleyip/)).toBeTruthy()
  })
})
