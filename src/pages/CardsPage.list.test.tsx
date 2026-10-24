// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountLedger, Card } from '../types/database'
import { CreditAccountListCard } from './CardsPage.list'

const mocks = vi.hoisted(() => ({ ledger: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../data/repositories/financePanelsRepo', () => ({ fetchAccountLedgerEvents: mocks.ledger }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const card = { id: 'c1', bank_name: 'Nakit', card_name: 'Cüzdan', card_type: 'banka_karti',
  account_kind: 'cash', current_balance: 100, updated_at: '2026-10-24T09:00:00Z' } as Card
const event = { id: 'e1', kind: 'deposit', amount_kurus: 10000, occurred_at: '2026-10-24T09:00:00Z' } as AccountLedger
function panel(row = card) {
  return <CreditAccountListCard row={row} rows={[row]} statements={[]} installments={[]} menu={null} rowActions={null} onPayDebt={vi.fn()} onToggleFavorite={vi.fn()} />
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  const wrap = (row = card) => <QueryClientProvider client={client}>{panel(row)}</QueryClientProvider>
  const view = render(wrap())
  const details = view.container.querySelector('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  return { client, view, wrap }
}

it('son hareketleri bakiye revizyonuyla yeniler; eski olaya yeni sonrası bakiyesi yazmaz', async () => {
  let finish!: (value: unknown) => void
  mocks.ledger.mockResolvedValueOnce({ ok: true, data: [event] })
    .mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const { client, view, wrap } = setup()
  try {
    await screen.findByText('Son 3 hareket')
    view.rerender(wrap({ ...card, current_balance: 125 }))
    expect(screen.queryByText('Son 3 hareket')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(mocks.ledger).toHaveBeenCalledTimes(2)
    await act(async () => finish({ ok: true, data: [{ ...event, id: 'e2', amount_kurus: 2500 }, event] }))
    expect(within((await screen.findByText('Son 3 hareket')).closest('section')!).getByText('+₺25,00')).toBeTruthy()
  } finally { client.clear() }
})

it('okuma hatasını boş hareket listesi saymaz; tekrar deneme güncel kaydı getirir', async () => {
  mocks.ledger.mockResolvedValueOnce({ ok: false, error: { message: 'Hesap hareketleri okunamadı.' } })
    .mockResolvedValueOnce({ ok: true, data: [event] })
  const { client } = setup()
  try {
    await screen.findByText('Hesap hareketleri okunamadı.')
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await screen.findByText('Son 3 hareket')
    expect(mocks.ledger).toHaveBeenCalledTimes(2)
  } finally { client.clear() }
})
