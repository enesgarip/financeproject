// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { CardsSummary, CreditLimitSummary, SharedLimitGroups } from './CardsPage.summary'
import type { CardPanel } from './CardsPage.hooks'

const privacy = vi.hoisted(() => ({ hidden: false }))
vi.mock('../hooks/useBalancePrivacy', () => ({ useBalancePrivacy: () => ({ hidden: privacy.hidden, formatAmount: (value: number) => privacy.hidden ? '••••' : `${value.toFixed(2)} TL` }) }))
vi.mock('../components/finance/AllCardStatementProjectionPanel', () => ({ AllCardStatementProjectionPanel: () => null }))
afterEach(() => { cleanup(); privacy.hidden = false })

const props = {
  rows: [{ id: 'c1', card_type: 'kredi_karti', credit_limit: 1000, current_period_spending: 100, provision_amount: 20, debt_amount: 230, statement_debt_amount: 50 }] as Card[],
  installments: [{ id: 'i1', card_id: 'c1', status: 'scheduled', amount: 60 }, { id: 'i2', card_id: 'c1', status: 'posted', amount: 10 }] as CardInstallment[],
  statements: [{ id: 's1', card_id: 'c1', status: 'open', statement_debt_amount: 50 }] as CardStatementArchive[],
  statementPayments: [{ statement_archive_id: 's1', amount: 10 }] as CardStatementPayment[],
  installmentsLoading: false, installmentsError: '', statementsLoading: false, statementError: '', section: 'kartlar' as const, panel: null, onOpenPanel: vi.fn(),
}

describe('kart özeti', () => {
  it('seçilen dökümü belirtir, seçim değişince vurguyu taşır ve tekrar dokununca kapatır', () => {
    function SummaryHarness() {
      const [panel, setPanel] = useState<CardPanel>(null)
      return <CardsSummary {...props} panel={panel} onOpenPanel={(next) => setPanel(next === panel ? null : next)} />
    }
    render(<SummaryHarness />)
    for (const label of ['Dönem içi toplam', 'Gelecek taksit toplamı', 'Ödenecek ekstre', 'Bekleyen provizyon']) {
      const button = screen.getByRole('button', { name: new RegExp(label) })
      fireEvent.click(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.getAttribute('aria-controls')).toBe('kart-bilgi-dokumu')
      expect(button.className).toContain('bg-primary/10')
      expect(within(button).getByText('Döküm açık · Kapat')).toBeTruthy()
      expect(screen.getAllByText('Döküm açık · Kapat')).toHaveLength(1)
    }
    const selected = screen.getByRole('button', { name: /Bekleyen provizyon/ })
    fireEvent.click(selected)
    expect(selected.getAttribute('aria-expanded')).toBe('false')
    expect(selected.className).not.toContain('bg-primary/10')
    expect(screen.queryByText('Döküm açık · Kapat')).toBeNull()
  })

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

describe('toplam limit ve kullanım', () => {
  const first = { ...props.rows[0], card_name: 'Birinci', limit_group_name: 'Aile', credit_limit: 1000, debt_amount: 230 }
  const second = { ...first, id: 'c2', credit_limit: 900, debt_amount: 170 }
  const standalone = { ...first, id: 'c3', card_name: 'Tekil', limit_group_name: null, credit_limit: 3000, debt_amount: 600 }
  const value = (label: string) => within(screen.getByText('Limit özeti ve kart bazında döküm').closest('summary')!).getByText(label, { exact: true }).nextElementSibling?.textContent

  it('ortak limiti bir kez sayar; toplam oranı kart yüzdelerinin ortalamasından üretmez', () => {
    render(<CreditLimitSummary rows={[first, second, standalone]} />)
    expect(value('Toplam limit')).toBe('4000.00 TL')
    expect(value('Kullanılan limit')).toBe('1000.00 TL')
    expect(value('Kullanılabilir limit')).toBe('3000.00 TL')
    expect(value('Kullanım oranı')).toBe('%25')
  })

  it('bir grubun aşımını başka grubun kullanılabilir limitinden düşmez', () => {
    render(<CreditLimitSummary rows={[
      { ...first, limit_group_name: null, credit_limit: 100, debt_amount: 150 },
      { ...standalone, credit_limit: 900, debt_amount: 90 },
    ]} />)
    expect(value('Kullanılabilir limit')).toBe('810.00 TL')
    expect(value('Kullanım oranı')).toBe('%24')
    expect(screen.getByText(/1 kart veya ortak limit grubunda limit aşımı/)).toBeTruthy()
    const details = screen.getByText('Limit özeti ve kart bazında döküm').closest('details')!
    details.open = true
    expect(screen.getByText('Limit aşımı: 50.00 TL')).toBeTruthy()
    expect(screen.getByText('%150')).toBeTruthy()
  })

  it('gizlilikte toplamları, grup tutarlarını, oranları ve çubuğu gizler', () => {
    privacy.hidden = true
    const { container } = render(<CreditLimitSummary rows={[first, second, standalone]} />)
    expect(value('Toplam limit')).toBe('••••')
    expect(value('Kullanım oranı')).toBe('••••')
    expect(container.textContent).not.toMatch(/4000|1000|3000|%25|%40/)
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('tanımsız limitte yüzde sıfır iddiası üretmez', () => {
    render(<CreditLimitSummary rows={[{ ...first, credit_limit: 0 }]} />)
    expect(value('Kullanım oranı')).toBe('—')
    expect(screen.getByText('Kart limiti tanımlı değil; kullanım oranı hesaplanamadı.')).toBeTruthy()
  })

  it('ödeme sonrası yeni kart verisiyle kullanılan ve kalan limiti yeniler', () => {
    const view = render(<CreditLimitSummary rows={[first]} />)
    expect(value('Kullanılan limit')).toBe('230.00 TL')
    view.rerender(<CreditLimitSummary rows={[{ ...first, debt_amount: 130 }]} />)
    expect(value('Kullanılan limit')).toBe('130.00 TL')
    expect(value('Kullanılabilir limit')).toBe('870.00 TL')
  })
})


describe('ortak limit grupları', () => {
  it('limiti bir kez sayar, tüm kart borçlarını toplar ve kart ayrıntısını açar', () => {
    const first = { ...props.rows[0], bank_name: 'Banka', card_name: 'Birinci kart', limit_group_name: 'Aile', credit_limit: 1000 }
    const second = { ...first, id: 'c2', card_name: 'İkinci kart', credit_limit: 900, debt_amount: 170 }
    const standalone = { ...first, id: 'c3', card_name: 'Tekil kart', limit_group_name: null }
    const onOpenCard = vi.fn()
    render(<SharedLimitGroups rows={[first, second, standalone] as Card[]} onOpenCard={onOpenCard} />)
    const region = screen.getByRole('region', { name: 'Kart ve ortak limit dökümü' })
    fireEvent.click(within(region).getByText('Aile · 2 kart'))
    const family = within(within(region).getByText('Aile · 2 kart').closest('details')!)
    expect(family.getByText('1000.00 TL')).toBeTruthy()
    expect(family.getByText('400.00 TL')).toBeTruthy()
    expect(family.getByText('600.00 TL')).toBeTruthy()
    expect(within(region).getByText('Tekil kart · 1 kart')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'İkinci kart' }))
    expect(onOpenCard).toHaveBeenCalledWith(second)
  })

  it('isimli tek kartlı grubu gösterir', () => {
    render(<SharedLimitGroups rows={[{ ...props.rows[0], limit_group_name: 'Aile', credit_limit: 1000 } as Card]} onOpenCard={vi.fn()} />)
    expect(screen.getByText('Aile · 1 kart')).toBeTruthy()
  })

  it('grup yoksa oluşturma yolunu açıklar', () => {
    render(<SharedLimitGroups rows={[]} onOpenCard={vi.fn()} />)
    expect(screen.getByText('Henüz kredi kartı yok.')).toBeTruthy()
    expect(screen.getByText(/kartı düzenleyip/)).toBeTruthy()
  })
})
