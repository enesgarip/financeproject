// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountLedger, Card, CardStatementArchive, CardStatementPayment } from '../types/database'
import { CreditAccountListCard } from './CardsPage.list'

const mocks = vi.hoisted(() => ({ ledger: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../data/repositories/financePanelsRepo', () => ({ fetchAccountLedgerEvents: mocks.ledger }))
vi.mock('../data/repositories/cardsRepo', () => ({ fetchExpensePaceRows: async () => ({ ok: true, data: [] }) }))
vi.mock('../data/repositories/cardAliasesRepo', () => ({ fetchAllCardAliases: async () => ({ ok: true, data: [] }) }))
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

const credit = { ...card, card_type: 'kredi_karti', bank_name: 'Banka', card_name: 'Kartım', credit_limit: 1000, debt_amount: 230, statement_debt_amount: 50, current_period_spending: 100, provision_amount: 20, statement_day: 10, due_day: 20 } as Card
const statement = { id: 's1', card_id: credit.id, status: 'open', statement_debt_amount: 50, due_date: '2026-12-20', statement_date: '2026-12-10' } as CardStatementArchive

function showCredit(statements: CardStatementArchive[], statementPayments: CardStatementPayment[] = [], statementsKnown = true) {
  const onPayStatement = vi.fn()
  const onOpenPanel = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><CreditAccountListCard row={credit} rows={[credit]} statements={statements} statementPayments={statementPayments} installments={[]} menu={null} rowActions={null} onPayDebt={vi.fn()} onToggleFavorite={vi.fn()} onPayStatement={onPayStatement} onOpenPanel={onOpenPanel} statementsKnown={statementsKnown} /></QueryClientProvider>)
  return { onPayStatement, onOpenPanel, client }
}

it('tek kalan ekstrede doğrudan ödeme açar; tamamı ödenmiş açık arşivi seçim saymaz', () => {
  const settled = { ...statement, id: 'settled' }
  const { onPayStatement, onOpenPanel, client } = showCredit([statement, settled], [{ statement_archive_id: 'settled', amount: 50 } as CardStatementPayment])
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Ekstre ödemesi kaydet' }))
    expect(onPayStatement).toHaveBeenCalledWith(statement, credit)
    expect(onOpenPanel).not.toHaveBeenCalled()
    const content = screen.getByText('Açık ekstre').closest('article')!.textContent!
    expect(content.indexOf('Açık ekstre')).toBeLessThan(content.indexOf('Toplam kart yükü'))
  } finally { client.clear() }
})

it('birden fazla kalan ekstrede dönem seçimi için dökümü açar', () => {
  const { onPayStatement, onOpenPanel, client } = showCredit([statement, { ...statement, id: 's2' }])
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Ekstre ödemesi kaydet' }))
    expect(onPayStatement).not.toHaveBeenCalled()
    expect(onOpenPanel).toHaveBeenCalledWith('ekstreler')
  } finally { client.clear() }
})

it('ekstre veya kısmi ödeme doğrulanmamışken ödeme açmaz', () => {
  const { onPayStatement, client } = showCredit([statement], [], false)
  try {
    expect(screen.queryByRole('button', { name: 'Ekstre ödemesi kaydet' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Borç ödemesi kaydet' })).toBeNull()
    expect(onPayStatement).not.toHaveBeenCalled()
    expect(screen.getByText('Doğrulanamadı')).toBeTruthy()
  } finally { client.clear() }
})
