// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Card } from '../types/database'
import type { FinanceObligation } from '../utils/obligations'
import { readPaymentAttempt } from '../utils/paymentAttempt'
import { useFinancePaymentDrawer } from './useFinancePaymentDrawer'

const mocks = vi.hoisted(() => ({ submit: vi.fn(), refresh: vi.fn() }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../services/financePaymentActions', async (original) => ({
  ...await original<typeof import('../services/financePaymentActions')>(),
  submitFinanceObligationPayment: mocks.submit, refreshFinancePaymentState: mocks.refresh,
}))
const intent: FinanceObligation = { id: 'd1', sourceId: 'd1', action: 'settle_debt', kind: 'personal_debt', title: 'Kişi', subtitle: '', date: '2026-11-03', amount: 1000, direction: 'outflow' }
const account = { id: 'bank', card_type: 'banka_karti', current_balance: 10000 } as Card
beforeEach(() => { vi.resetAllMocks(); localStorage.clear() })
afterEach(cleanup)

it('kayıp yanıt sonrası modal/yenileme aynı kimlik, tutar ve tam/kısmi ödeme kararını taşır', async () => {
  mocks.submit.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } }).mockResolvedValueOnce({ error: null })
  const first = renderHook(useFinancePaymentDrawer)
  await act(async () => first.result.current.openPaymentDrawer(intent, { cards: [account] }))
  await act(async () => first.result.current.drawerProps.onSubmit({ account, amount: 100, skipSourceDebit: true }))
  const attempt = readPaymentAttempt('u1', intent)!
  expect(attempt.amount).toBe(100)
  expect(first.result.current.drawerProps.uncertain).toBe(true)
  first.unmount()
  const reopened = renderHook(useFinancePaymentDrawer)
  await act(async () => reopened.result.current.openPaymentDrawer({ ...intent, amount: 900 }, { cards: [account] }))
  expect(reopened.result.current.drawerProps.amountValue).toBe('100')
  await act(async () => reopened.result.current.drawerProps.onSubmit({ account, amount: 999 }))
  expect(mocks.submit.mock.calls[0][0]).toMatchObject({ requestId: attempt.id, amount: 100, skipSourceDebit: true })
  expect(mocks.submit.mock.calls[1][0]).toMatchObject({ requestId: attempt.id, amount: 100, skipSourceDebit: true, obligation: { amount: 1000 } })
  expect(readPaymentAttempt('u1', intent)).toBeNull()
  expect(reopened.result.current.drawerProps.open).toBe(false)
})

it('SQL çakışmasında güncel kalan/bakiyeyi gösterir ve tutar girişini korur', async () => {
  mocks.submit.mockResolvedValue({ error: { code: 'P0001', message: 'Odeme tutari borc/alacak degerinden buyuk olamaz.' } })
  mocks.refresh.mockResolvedValue({ intent: { ...intent, amount: 400, maxPayableAmount: 400 }, accounts: [{ ...account, current_balance: 9400 }] })
  const hook = renderHook(useFinancePaymentDrawer)
  await act(async () => hook.result.current.openPaymentDrawer(intent, { cards: [account], detail: 'Eski 1000' }))
  act(() => hook.result.current.drawerProps.onAmountValueChange('600'))
  await act(async () => hook.result.current.drawerProps.onSubmit({ account, amount: 600 }))
  expect(hook.result.current.drawerProps.intent?.amount).toBe(400)
  expect(hook.result.current.drawerProps.accounts[0].current_balance).toBe(9400)
  expect(hook.result.current.drawerProps.detail).toBeUndefined()
  expect(hook.result.current.drawerProps.amountValue).toBe('600')
  expect(hook.result.current.drawerProps.externalError).toContain('Güncel kalan')
  expect(hook.result.current.drawerProps.externalError).not.toContain('Odeme tutari')
  expect(readPaymentAttempt('u1', intent)).toBeNull()
})

it('aynı render içindeki iki gönderim tek yazma başlatır', async () => {
  let finish!: (value: { error: null }) => void
  mocks.submit.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const hook = renderHook(useFinancePaymentDrawer)
  await act(async () => hook.result.current.openPaymentDrawer(intent, { cards: [account] }))
  await act(async () => {
    const first = hook.result.current.drawerProps.onSubmit({ account, amount: 100 })
    const second = hook.result.current.drawerProps.onSubmit({ account, amount: 100 })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    finish({ error: null })
    await Promise.all([first, second])
  })
})
