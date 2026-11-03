// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('tüm hareket türlerinde açıklamayı gösterir ve gizlilik biçimleyicisini uygular', async () => {
    const row = { ...events(100)[0], note: 'Alışveriş 100 TL' }
    fetchEvents.mockResolvedValue({ ok: true, data: [row] })
    render(<Panel card={card} maskText={(text) => text.replace('100 TL', '•••• ₺')} />)
    expect(await screen.findByText('Alışveriş •••• ₺')).toBeTruthy()
    expect(screen.queryByText('Alışveriş 100 TL')).toBeNull()
  })

  if (kind !== 'credit') it('hesap geçmişinin tamamına sayfalarla ulaşır ve her sayfada gerçek sonraki bakiyeyi korur', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const history = Array.from({ length: 19 }, (_, i) => ({ ...events(1, `event-${i}`)[0], kind: 'deposit', note: `Hesap açıklaması ${i}` }))
    fetchEvents.mockResolvedValue({ ok: true, data: history })
    render(<Panel card={{ ...card, current_balance: 19 }} />)
    const list = await screen.findByRole('list', { name: 'Hesap hareketi kayıtları' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByText('1–8 / 19 hareket · Sayfa 1 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'En eski' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('Hesap açıklaması 18')).toBeTruthy()
    expect(warning()).toBeNull()
    expect(document.activeElement).toBe(list)
    fireEvent.click(screen.getByRole('button', { name: 'Daha yeni' }))
    expect(screen.getByText('9–16 / 19 hareket · Sayfa 2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'En yeni' }))
    expect(within(list).getByText('Hesap açıklaması 0')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Hareketlerde ara' }), { target: { value: 'açıklaması 18' } })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Hesap açıklaması 18')).toBeTruthy()
    expect(within(list).getByText('₺1,00')).toBeTruthy()
    expect(screen.getByText('1 / 19 hareket bulundu')).toBeTruthy()
    expect(screen.getByText('19 kayıt · Toplamlar tüm geçmiş içindir')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'olmayan kayıt' } })
    expect(screen.getByText('Aramana uygun hareket yok.')).toBeTruthy()
    scroll.mockRestore()
  })

  if (kind === 'credit') it('uzun geçmişi 10 kayıtlık sayfalarda gösterir; tam toplam ve uzun not korunur', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const history = Array.from({ length: 25 }, (_, i) => ({ ...events(1, `event-${i}`)[0], kind: 'adjustment' as const, note: `Uzun açıklama ${i}: Banka karşılaştırmasında verilen açıklamanın tamamı okunabilmeli.` }))
    fetchEvents.mockResolvedValue({ ok: true, data: history })
    render(<Panel card={{ ...card, debt_amount: 25 }} />)
    const list = await screen.findByRole('list', { name: 'Kart borç hareketi kayıtları' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(within(list).getByText(history[0].note)).toBeTruthy()
    expect(screen.getByText('1–10 / 25 hareket · Sayfa 1 / 3')).toBeTruthy()
    expect(warning()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Daha eski' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(within(list).getByText(history[10].note)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Daha eski' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('21–25 / 25 hareket · Sayfa 3 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Daha yeni' }))
    expect(screen.getByText('11–20 / 25 hareket · Sayfa 2 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'En eski' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'En yeni' }))
    expect(within(list).getByText(history[0].note)).toBeTruthy()
    expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    expect(document.activeElement).toBe(list)
    scroll.mockRestore()
  })

  it.each([75, 125])('hareket sonrası %s TL için gezinmeden yeniler, beklerken sahte düzeltme sunmaz', async (amount) => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
    const pending = deferred<Result<Events>>()
    fetchEvents.mockReturnValueOnce(pending.promise)
    const view = render(<Panel card={card} />)
    await screen.findByText('Hareketlerin neti')
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
    await screen.findByText('Hareketlerin neti')
    view.rerender(<Panel card={changed(125, card.updated_at)} />)
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledTimes(2))
    expect(warning()).toBeNull()
  })

  it('tutar aynı olsa da yeni revizyonda ledgerı yeniler, sıradan render sorgu başlatmaz', async () => {
    fetchEvents.mockResolvedValue({ ok: true, data: events(100) })
    const view = render(<Panel card={card} />)
    await screen.findByText('Hareketlerin neti')
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
    await screen.findByText('Hareketlerin neti')
    await act(async () => old.resolve({ ok: true, data: events(100) }))
    expect(warning()).toBeNull()
    expect(screen.getAllByText(/125,00/).length).toBeGreaterThan(0)
  })

  it('yenileme hatasını gösterir, eski kayıtlardan düzeltme önermez', async () => {
    fetchEvents.mockResolvedValueOnce({ ok: true, data: events(100) })
      .mockResolvedValueOnce({ ok: false, error: { type: 'supabase', message: 'Hareketler okunamadı.' } })
    const view = render(<Panel card={card} />)
    await screen.findByText('Hareketlerin neti')
    view.rerender(<Panel card={changed(125)} />)
    await screen.findByText('Hareketler okunamadı.')
    expect(warning()).toBeNull()
  })

  it('başka hesaba geçişte eski hesabın yanıtı ve hatası yeni hesabı bozmaz', async () => {
    const old = deferred<Result<Events>>()
    fetchEvents.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, data: events(125) })
    const view = render(<Panel card={card} />)
    view.rerender(<Panel card={{ ...changed(125), id: 'c2' }} />)
    await screen.findByText('Hareketlerin neti')
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
    await screen.findByText('Hareketlerin neti')
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
    await screen.findByText('Hareketlerin neti')
    await act(async () => correction.resolve({ error: null }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(warning()).toBeNull()
    expect(fetchEvents).toHaveBeenCalledTimes(2)
  })
})
