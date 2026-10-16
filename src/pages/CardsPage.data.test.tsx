// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardStatementArchive, CardStatementPayment } from '../types/database'
import { useCardsPageData } from './CardsPage.hooks'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null },
  cards: [] as Card[],
  fetchCrudRows: vi.fn(),
  fetchProvisionExpenses: vi.fn(),
  fetchStatementArchives: vi.fn(),
  fetchStatementPayments: vi.fn(),
  fetchCardInstallments: vi.fn(),
  fetchAccountReconciliations: vi.fn(),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../data/repositories/crudRepo', () => ({ fetchCrudRows: mocks.fetchCrudRows }))
vi.mock('../data/repositories/cardsRepo', () => ({
  fetchProvisionExpenses: mocks.fetchProvisionExpenses,
  fetchStatementArchives: mocks.fetchStatementArchives,
  fetchStatementPayments: mocks.fetchStatementPayments,
  fetchCardInstallments: mocks.fetchCardInstallments,
  applyCardProvision: vi.fn(), setProvisionInstallments: vi.fn(),
}))
vi.mock('../data/repositories/financePanelsRepo', () => ({ fetchAccountReconciliations: mocks.fetchAccountReconciliations }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ fetchFinanceSnapshot: vi.fn(), runFinanceMaintenance: vi.fn() }))
vi.mock('../services/accountMovements', () => ({ submitAccountMovement: vi.fn() }))

const clients: QueryClient[] = []
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } } })
  clients.push(client)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
const bank = { section: 'hesaplar', panel: null, selectedCardId: null } as const
const credit = { section: 'kartlar', panel: null, selectedCardId: null } as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.user = { id: 'u1' }
  mocks.cards = []
  mocks.fetchCrudRows.mockImplementation(async () => ({ ok: true, data: mocks.cards }))
  for (const name of ['fetchProvisionExpenses', 'fetchStatementArchives', 'fetchStatementPayments', 'fetchCardInstallments', 'fetchAccountReconciliations'] as const) {
    mocks[name].mockResolvedValue({ ok: true, data: [] })
  }
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers() })

describe('kart verisi yükleme ve tazelik', () => {
  it('normal hesap görünümünde kredi kartı sorgularını başlatmaz', async () => {
    const { wrapper } = setup()
    renderHook(() => useCardsPageData(bank), { wrapper })
    await waitFor(() => expect(mocks.fetchCrudRows).toHaveBeenCalledTimes(1))
    expect(mocks.fetchStatementArchives).not.toHaveBeenCalled()
    expect(mocks.fetchStatementPayments).not.toHaveBeenCalled()
    expect(mocks.fetchCardInstallments).not.toHaveBeenCalled()
    expect(mocks.fetchProvisionExpenses).not.toHaveBeenCalled()
    expect(mocks.fetchAccountReconciliations).not.toHaveBeenCalled()
  })

  it('kredi özeti için gerekli veriyi alır; kısa dönüşte cache kullanır, eski cache yenilenir', async () => {
    const { wrapper } = setup()
    const first = renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(first.result.current.statementsLoading).toBe(false))
    first.unmount()
    const second = renderHook(() => useCardsPageData(credit), { wrapper })
    expect(second.result.current.statementsLoading).toBe(false)
    expect(mocks.fetchStatementArchives).toHaveBeenCalledTimes(1)
    expect(mocks.fetchCardInstallments).toHaveBeenCalledTimes(1)
    expect(mocks.fetchProvisionExpenses).not.toHaveBeenCalled()
    expect(mocks.fetchAccountReconciliations).not.toHaveBeenCalled()
    second.unmount()
    vi.setSystemTime(Date.now() + 31_000)
    renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(mocks.fetchStatementArchives).toHaveBeenCalledTimes(2))
  })

  it('provizyonu yalnız ilgili dökümde, karşılaştırmayı yalnız kart ayrıntısında alır', async () => {
    const { wrapper } = setup()
    const hook = renderHook((props: Parameters<typeof useCardsPageData>[0]) => useCardsPageData(props), { initialProps: credit as Parameters<typeof useCardsPageData>[0], wrapper })
    await waitFor(() => expect(hook.result.current.statementsLoading).toBe(false))
    hook.rerender({ ...credit, selectedCardId: 'c1', panel: 'provizyon' })
    await waitFor(() => expect(mocks.fetchProvisionExpenses).toHaveBeenCalledTimes(1))
    expect(mocks.fetchAccountReconciliations).toHaveBeenCalledTimes(1)
    expect(mocks.fetchStatementArchives).toHaveBeenCalledTimes(1)
  })

  it('doğrudan hesap açılışında kesim adayı varsa arşiv kontrolünü atlamaz', async () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00'))
    mocks.cards = [{ id: 'c1', card_type: 'kredi_karti', statement_day: 1, current_period_spending: 100 } as Card]
    const { wrapper } = setup()
    const hook = renderHook(() => useCardsPageData(bank), { wrapper })
    await waitFor(() => expect(hook.result.current.statementsLoading).toBe(false))
    expect(mocks.fetchStatementArchives).toHaveBeenCalledTimes(1)
    expect(mocks.fetchCardInstallments).not.toHaveBeenCalled()
    expect(mocks.fetchProvisionExpenses).not.toHaveBeenCalled()
  })

  it('kısmi ödemeler gelmeden ekstreyi doğrulanmış göstermez; hata boş ödeme sayılmaz', async () => {
    let resolvePayments!: (value: { ok: false; error: { message: string } }) => void
    mocks.fetchStatementArchives.mockResolvedValue({ ok: true, data: [{ id: 's1', statement_debt_amount: 100 } as CardStatementArchive] })
    mocks.fetchStatementPayments.mockReturnValue(new Promise(resolve => { resolvePayments = resolve }))
    const { wrapper } = setup()
    const hook = renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(mocks.fetchStatementPayments).toHaveBeenCalledTimes(1))
    expect(hook.result.current.statementsLoading).toBe(true)
    expect(hook.result.current.statements).toEqual([])
    await act(async () => { resolvePayments({ ok: false, error: { message: 'Bağlantı kurulamadı' } }) })
    await waitFor(() => expect(hook.result.current.statementError).toBe('Bağlantı kurulamadı'))
    expect(hook.result.current.statements).toEqual([])
  })

  it('para hareketinden sonra aktif verileri tazeler; kapalı provizyon cache ini de geçersiz kılar', async () => {
    const { client, wrapper } = setup()
    const hook = renderHook((props: Parameters<typeof useCardsPageData>[0]) => useCardsPageData(props), {
      initialProps: { ...credit, panel: 'provizyon' }, wrapper,
    })
    await waitFor(() => expect(hook.result.current.provisionsLoading).toBe(false))
    hook.rerender(credit)
    const reload = vi.fn(async () => {})
    await act(async () => { await hook.result.current.refreshCardsAndProvisions(reload) })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(mocks.fetchStatementArchives).toHaveBeenCalledTimes(2)
    expect(mocks.fetchProvisionExpenses).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(['card-page-data', 'u1', 'provisions'])?.isInvalidated).toBe(true)
    hook.rerender({ ...credit, panel: 'provizyon' })
    await waitFor(() => expect(mocks.fetchProvisionExpenses).toHaveBeenCalledTimes(2))
  })

  it('kullanıcı değişince önceki kullanıcının kısmi ödemelerini göstermez', async () => {
    mocks.fetchStatementPayments.mockResolvedValueOnce({ ok: true, data: [{ id: 'p1', amount: 25 } as CardStatementPayment] })
    const { wrapper } = setup()
    const hook = renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(hook.result.current.statementPayments).toHaveLength(1))
    mocks.auth.user = { id: 'u2' }
    hook.rerender()
    expect(hook.result.current.statementPayments).toEqual([])
    await waitFor(() => expect(hook.result.current.statementsLoading).toBe(false))
    expect(mocks.fetchStatementPayments).toHaveBeenCalledTimes(2)
    expect(hook.result.current.statementPayments).toEqual([])
  })

  it('oturum yokken veri sorgusu başlatmaz', () => {
    mocks.auth.user = null
    const { wrapper } = setup()
    renderHook(() => useCardsPageData(credit), { wrapper })
    expect(mocks.fetchCrudRows).not.toHaveBeenCalled()
    expect(mocks.fetchStatementArchives).not.toHaveBeenCalled()
  })

  it('eski ortamda eksik kısmi ödeme tablosu uyumluluğunu korur', async () => {
    mocks.fetchStatementPayments.mockResolvedValue({ ok: false, error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' } })
    const { wrapper } = setup()
    const hook = renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(hook.result.current.statementsLoading).toBe(false))
    expect(hook.result.current.statementError).toBe('')
    expect(hook.result.current.statementPayments).toEqual([])
  })

  it('taksit sorgusundaki hatayı boş ve doğrulanmış toplam saymaz', async () => {
    mocks.fetchCardInstallments.mockResolvedValue({ ok: false, error: { message: 'Taksitler alınamadı' } })
    const { wrapper } = setup()
    const hook = renderHook(() => useCardsPageData(credit), { wrapper })
    await waitFor(() => expect(hook.result.current.installmentsError).toBe('Taksitler alınamadı'))
    expect(hook.result.current.installments).toEqual([])
  })
})
