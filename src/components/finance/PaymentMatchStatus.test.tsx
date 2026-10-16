// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import { PaymentMatchStatus } from './PaymentMatchStatus'

afterEach(() => { cleanup(); localStorage.clear() })
const month = new Date(2026, 9, 1)
const match = { historyId: 'h', occurredOn: '2026-10-12', amount: 499.99, state: 'matched' as const }

it('ayı, gerçek işlem tarihini ve tutarı gösterir', () => {
  render(<BalancePrivacyProvider><PaymentMatchStatus month={month} match={match} /></BalancePrivacyProvider>)
  expect(screen.getByText(/Ekim 2026 · Eşleşti/)).toBeTruthy()
  expect(screen.getByText(/Banka işlemi: 12 Eki 2026 · 499,99/)).toBeTruthy()
})

it('gizlilik maskesi eşleşmenin gerçek tutarını da kapatır', () => {
  localStorage.setItem('financeproject.balancePrivacy', 'hidden')
  render(<BalancePrivacyProvider><PaymentMatchStatus month={month} match={match} /></BalancePrivacyProvider>)
  expect(screen.queryByText(/499,99/)).toBeNull()
  expect(screen.getByText(/Banka işlemi:.*••••/)).toBeTruthy()
})

it('yüklenmeyen veya hatalı veri eşleşme yok gibi gösterilmez', () => {
  const view = render(<BalancePrivacyProvider><PaymentMatchStatus month={month} loading /></BalancePrivacyProvider>)
  expect(screen.queryByText(/Henüz eşleşme yok/)).toBeNull()
  expect(screen.getByText(/kontrol ediliyor/)).toBeTruthy()
  view.rerender(<BalancePrivacyProvider><PaymentMatchStatus month={month} error /></BalancePrivacyProvider>)
  expect(screen.getByText(/doğrulanamadı/)).toBeTruthy()
})

it('iptal veya geri alma başarı rozeti üretmez', () => {
  render(<BalancePrivacyProvider><PaymentMatchStatus month={month} match={{ ...match, state: 'reversed' }} /></BalancePrivacyProvider>)
  expect(screen.getByText(/Eşleşme geri alınmış/)).toBeTruthy()
  expect(screen.queryByText(/Banka işlemi/)).toBeNull()
})

it('tarihçe penceresi dışındaki ay için eşleşme yok demez; bulunan kanıtı yine gösterir', () => {
  const view = render(<BalancePrivacyProvider><PaymentMatchStatus month={month} historyAvailable={false} /></BalancePrivacyProvider>)
  expect(screen.getByText(/geçmişi tam yüklü değil/)).toBeTruthy()
  expect(screen.queryByText(/Henüz eşleşme yok/)).toBeNull()
  view.rerender(<BalancePrivacyProvider><PaymentMatchStatus month={month} historyAvailable={false} match={match} /></BalancePrivacyProvider>)
  expect(screen.getByText(/· Eşleşti/)).toBeTruthy()
})
