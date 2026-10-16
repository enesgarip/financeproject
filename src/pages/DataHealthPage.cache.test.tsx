// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import type { HealthIssue } from './DataHealth.logic'

const mocks = vi.hoisted(() => ({ load: vi.fn(), fix: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../hooks/useBalancePrivacy', () => ({ useBalancePrivacy: () => ({ formatAmount: (value: number) => String(value), hidden: false }) }))
vi.mock('../hooks/useFinancePaymentDrawer', () => ({ useFinancePaymentDrawer: () => ({ drawerProps: {}, openPaymentDrawer: vi.fn() }) }))
vi.mock('../components/finance/FinancePaymentDrawer', () => ({ FinancePaymentDrawer: () => null }))
vi.mock('../data/repositories/financeSnapshotRepo', () => ({ fetchFinanceSnapshot: vi.fn(), runFinanceMaintenance: vi.fn() }))
vi.mock('../data/repositories/dataHealthRepo', () => ({
  fetchDataHealthRows: mocks.load,
  fetchDataHealthIssueAcknowledgements: async () => ({ ok: true, data: [] }),
  acknowledgeDataHealthIssues: vi.fn(), clearDataHealthIssueAcknowledgements: vi.fn(),
}))
vi.mock('./DataHealth.logic', async (importOriginal) => ({
  ...await importOriginal<typeof import('./DataHealth.logic')>(),
  buildIssues: () => [{ id: 'test-issue', kind: 'cardLedgerDrift', severity: 'warning' }],
}))
vi.mock('./DataHealthPage.actions', () => ({
  fixIssue: mocks.fix, safeRepairBatchForIssues: vi.fn(), safeRepairPlanForIssues: () => [],
}))
vi.mock('./DataHealthPage.components', () => ({
  HealthStat: () => null, FixAllModal: () => null,
  HealthIssueCard: ({ issue, onFix }: { issue: HealthIssue; onFix: (issue: HealthIssue) => void }) => <button onClick={() => onFix(issue)}>Düzeltme uygula</button>,
}))
import { emptyData } from './DataHealth.logic'
import { DataHealthPage } from './DataHealthPage'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('salt okunur taramada cache korunur; düzeltme sonrası ilgili kullanıcının kart/snapshot cache i yenilenir', async () => {
  mocks.load.mockResolvedValue({ ok: true, data: emptyData })
  mocks.fix.mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const keys = [
    ['finance-snapshot', 'u1'],
    ['card-page-data', 'u1', 'statements'],
    ['crud-rows', 'cards', 'u1', 'card_type', false],
  ]
  for (const key of keys) client.setQueryData(key, [])
  client.setQueryData(['card-page-data', 'u2', 'statements'], [])
  try {
    render(<QueryClientProvider client={client}><MemoryRouter><DataHealthPage /></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Düzeltme uygula' }))
    await waitFor(() => { for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true) })
    expect(mocks.fix).toHaveBeenCalledTimes(1)
    expect(mocks.load).toHaveBeenCalledTimes(2)
    expect(client.getQueryState(['card-page-data', 'u2', 'statements'])?.isInvalidated).toBe(false)
  } finally { client.clear() }
})
