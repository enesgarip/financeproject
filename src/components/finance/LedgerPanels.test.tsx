// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result } from '../../data/result'
import type { Card, CardLedger } from '../../types/database'
import { toKurus } from '../../utils/money'
import { AccountLedgerPanel } from './AccountLedgerPanel'
import { CardLedgerPanel } from './CardLedgerPanel'

const mocks = vi.hoisted(() => ({ account: vi.fn(), credit: vi.fn(), correction: vi.fn() }))
vi.mock('../../data/repositories/financePanelsRepo', () => ({
  fetchAccountLedgerEvents: mocks.account,
  fetchCardLedgerEvents: mocks.credit,
}))
vi.mock('../../services/accountLedgerActions', () => ({ postAccountBalanceCorrection: mocks.correction, recomputeAccountBalance: vi.fn() }))
vi.mock('../../services/cardLedgerActions', () => ({ postCardDebtCorrection: mocks.correction, recomputeCardDebt: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)

describe.each(['cash', 'bank', 'credit'] as const)('%s ledger tazeliği', (kind) => {
  const Panel = kind === 'credit' ? CardLedgerPanel : AccountLedgerPanel
  const fetchEvents = kind === 'credit' ? mocks.credit : mocks.account
  const card = {
    id: 'c1', user_id: 'u1', created_at: '2026-10-24T08:00:00Z', updated_at: '2026-10-24T09:00:00Z',
    bank_name: kind === 'cash' ? 'Nakit' : 'Banka', card_name: 'Günlük',
    card_type: kind === 'credit' ? 'kredi_karti' : 'banka_karti', account_kind: kind === 'cash' ? 'cash' : 'bank',
    holder_name: null, account_number: null, limit_group_name: null, current_balance: 100, credit_limit: 1000,
    debt_amount: 100, statement_debt_amount: 0, current_period_spending: 100, provision_amount: 0,
    statement_day: null, due_day: null, note: null,
  } satisfies Card
  type Events = CardLedger[]
  function events(amount: number, id = 'opening'): Events {
    return [{ id, user_id: 'u1', card_id: 'c1', created_at: card.created_at, updated_at: card.updated_at,
      occurred_at: card.updated_at, kind: 'opening', amount_kurus: toKurus(amount), note: null,
      source_table: null, source_id: null,
      statement_delta_kurus: null, current_delta_kurus: null, provision_delta_kurus: null }]
  }
  const changed = (amount: number, version = '2026-10-24T10:00:00Z') => ({
    ...card, current_balance: amount, debt_amount: amount, updated_at: version,
  })
  const warning = () => screen.queryByRole('button', { name: /ledger'a göre düzelt/i })

  it.each([75, 125])('hareket sonrası %s TL için gezinmeden yeniler, beklerken sahte düzeltme sunmaz', async (amount) => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
    const pending = deferred<Result<Events>>()
    fetchEvents.mockReturnValueOnce(pending.promise)
    const view = render(<Panel card={card} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    view.rerender(<Panel card={changed(amount)} />)
    expect(warning()).toBeNull()
    expect(fetchEvents).toHaveBeenCalledTimes(2)
    await act(async () => pending.resolve({ ok: true, data: events(amount) }))
    expect(warning()).toBeNull()
    expect(screen.getAllByText(new RegExp(`${amount},00`)).length).toBeGreaterThan(0)
  })

  it('zaman damgası aynı kalsa bile tutar değiştiğinde yeniden okur', async () => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
      .mockResolvedValueOnce({ ok: true, data: events(125) })
    const view = render(<Panel card={card} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    view.rerender(<Panel card={changed(125, card.updated_at)} />)
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2))
    expect(warning()).toBeNull()
  })

  it('tutar aynı olsa da yeni revizyonda ledgerı yeniler, sıradan render sorgu başlatmaz', async () => {
    fetchEvents.mockResolvedValue({ ok: true, data: events(100) })
    const view = render(<Panel card={card} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    view.rerender(<Panel card={{ ...card }} />)
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    view.rerender(<Panel card={changed(100)} />)
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2))
    expect(warning()).toBeNull()
  })

  it('geciken eski sorgu güncel hareketleri ezmez', async () => {
    const old = deferred<Result<Events>>()
    fetchEvents.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, data: events(125) })
    const view = render(<Panel card={card} />)
    view.rerender(<Panel card={changed(125)} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    await act(async () => old.resolve({ ok: true, data: events(100) }))
    expect(warning()).toBeNull()
    expect(screen.getAllByText(/125,00/).length).toBeGreaterThan(0)
  })

  it('yenileme hatasını gösterir, eski kayıtlardan düzeltme önermez', async () => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
      .mockResolvedValueOnce({ ok: false, error: { type: 'supabase', message: 'Hareketler okunamadı.' } })
    const view = render(<Panel card={card} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    view.rerender(<Panel card={changed(125)} />)
    await screen.findByText('Hareketler okunamadı.')
    expect(warning()).toBeNull()
  })

  it('başka hesaba geçişte eski hesabın yanıtı ve hatası yeni hesabı bozmaz', async () => {
    const old = deferred<Result<Events>>()
    fetchEvents.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, data: events(125) })
    const view = render(<Panel card={card} />)
    view.rerender(<Panel card={{ ...changed(125), id: 'c2' }} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    expect(fetchEvents).toHaveBeenLastCalledWith('c2')
    await act(async () => old.resolve({ ok: false, error: { type: 'supabase', message: 'Eski hesap hatası' } }))
    expect(screen.queryByText('Eski hesap hatası')).toBeNull()
    expect(warning()).toBeNull()
  })

  it('ters kayıt sonrası üst satır yenilenene kadar geçici fark sunmaz', async () => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
      .mockResolvedValue({ ok: true, data: events(125) })
    mocks.correction.mockResolvedValue({ error: null })
    const parentReload = deferred<void>()
    const onChanged = vi.fn(() => parentReload.promise)
    const view = render(<Panel card={card} onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Düzelt (ters kayıt)' }))
    fireEvent.change(screen.getByRole('textbox', { name: /düzeltme tutarı/ }), { target: { value: '25' } })
    fireEvent.change(screen.getByRole('textbox', { name: /düzeltme sebebi/ }), { target: { value: 'Banka kontrolü' } })
    fireEvent.click(screen.getByRole('button', { name: 'Düzeltmeyi kaydet' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(warning()).toBeNull()
    view.rerender(<Panel card={changed(125)} onChanged={onChanged} />)
    await act(async () => parentReload.resolve())
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    expect(warning()).toBeNull()
    expect(mocks.correction).toHaveBeenCalledWith('c1', 25, 'Banka kontrolü')
  })

  it('güncel sorguda gerçek fark varsa düzeltme eylemini korur', async () => {
    fetchEvents.mockResolvedValue({ ok: true, data: events(75) })
    render(<Panel card={card} />)
    expect(await screen.findByRole('button', { name: /ledger'a göre düzelt/i })).toBeTruthy()
    expect(screen.getByText(/25,00.*hareketlerle açıklanamıyor/)).toBeTruthy()
  })

  it('bekleyen düzeltmenin eski callbacki güncel revizyonu yüklemede bırakmaz', async () => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
      .mockResolvedValue({ ok: true, data: events(125) })
    const correction = deferred<{ error: null }>()
    mocks.correction.mockReturnValue(correction.promise)
    const view = render(<Panel card={card} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Düzelt (ters kayıt)' }))
    fireEvent.change(screen.getByRole('textbox', { name: /düzeltme tutarı/ }), { target: { value: '25' } })
    fireEvent.change(screen.getByRole('textbox', { name: /düzeltme sebebi/ }), { target: { value: 'Kontrol' } })
    fireEvent.click(screen.getByRole('button', { name: 'Düzeltmeyi kaydet' }))
    view.rerender(<Panel card={changed(125)} />)
    await screen.findByText(/Hareketlerin neti|Borçlanma/)
    await act(async () => correction.resolve({ error: null }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(warning()).toBeNull()
    expect(fetchEvents).toHaveBeenCalledTimes(2)
  })
})
