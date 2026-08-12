import { describe, expect, it } from 'vitest'
import type {
  AccountReconciliation,
  Card,
  CardInstallment,
  CardStatementArchive,
} from '../types/database'
import { buildCardControlItems } from './cardControlCenter'

const base = {
  id: 'id',
  user_id: 'u1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    ...base,
    id: 'card-1',
    bank_name: 'DenizBank',
    card_name: 'Gold',
    card_type: 'kredi_karti',
    holder_name: null,
    account_number: null,
    current_balance: 0,
    credit_limit: 50_000,
    debt_amount: 10_000,
    statement_debt_amount: 4_000,
    current_period_spending: 3_000,
    provision_amount: 1_000,
    statement_day: 4,
    due_day: 14,
    limit_group_name: null,
    note: null,
    ...overrides,
  }
}

function statement(overrides: Partial<CardStatementArchive> = {}): CardStatementArchive {
  return {
    ...base,
    id: 'statement-1',
    card_id: 'card-1',
    period_year: 2026,
    period_month: 7,
    statement_date: '2026-07-04',
    due_date: '2026-07-14',
    statement_debt_amount: 4_000,
    current_period_spending: 0,
    total_debt_amount: 10_000,
    status: 'open',
    paid_at: null,
    payment_source_card_id: null,
    reconciled_bank_amount: null,
    reconciled_at: null,
    reconciliation_note: null,
    note: null,
    ...overrides,
  }
}

function installment(overrides: Partial<CardInstallment> = {}): CardInstallment {
  return {
    ...base,
    id: 'installment-1',
    card_id: 'card-1',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 2,
    installment_count: 6,
    due_month: '2026-08-10',
    amount: 1_000,
    description: 'Telefon',
    category: 'Alışveriş',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function reconciliation(overrides: Partial<AccountReconciliation> = {}): AccountReconciliation {
  return {
    ...base,
    id: 'reconciliation-1',
    card_id: 'card-1',
    reconciled_at: '2026-07-23T12:00:00Z',
    target: 'debt',
    app_amount: 10_000,
    real_amount: 10_000,
    drift: 0,
    resolution: null,
    note: null,
    ...overrides,
  }
}

describe('buildCardControlItems', () => {
  const now = new Date('2026-07-24T12:00:00Z')

  it('combines the open statement, scheduled installments, and latest bank reconciliation', () => {
    const result = buildCardControlItems(
      [card()],
      [statement()],
      [installment(), installment({ id: 'paid', status: 'paid', amount: 500 })],
      [reconciliation()],
      now,
    )

    expect(result[0].openStatementAmount).toBe(4_000)
    expect(result[0].openStatementDueDate).toBe('2026-07-14')
    expect(result[0].scheduledInstallmentTotal).toBe(1_000)
    expect(result[0].reconciliationStatus).toBe('matched')
  })

  // Kart listesi tüm açık arşivlerin toplamını gösterirken kontrol merkezi
  // yalnız en yenisini gösteriyordu → iki panel farklı "açık ekstre" söylüyordu.
  it('sums every open statement archive of the card and picks the nearest due date', () => {
    const result = buildCardControlItems(
      [card()],
      [
        statement(),
        statement({
          id: 'statement-2',
          period_month: 8,
          statement_date: '2026-08-04',
          due_date: '2026-08-14',
          statement_debt_amount: 2_500,
        }),
        statement({ id: 'paid', status: 'paid', statement_debt_amount: 9_999 }),
      ],
      [],
      [reconciliation()],
      now,
    )

    expect(result[0].openStatementAmount).toBe(6_500)
    expect(result[0].openStatementDueDate).toBe('2026-07-14')
  })

  // K7: kısmi ödeme arşivi açık bırakır; kontrol merkezi KALANI göstermeli.
  it('subtracts partial statement payments and skips archives whose remainder is gone', () => {
    const result = buildCardControlItems(
      [card()],
      [
        statement(), // 4.000, vade 2026-07-14
        statement({
          id: 'statement-2',
          period_month: 8,
          statement_date: '2026-08-04',
          due_date: '2026-08-14',
          statement_debt_amount: 2_500,
        }),
      ],
      [],
      [reconciliation()],
      now,
      [
        { statement_archive_id: 'statement-1', amount: 1_500 }, // kalan 2.500
        { statement_archive_id: 'statement-2', amount: 2_500 }, // kalan 0 → görünmez
      ],
    )

    expect(result[0].openStatementAmount).toBe(2_500)
    // Kalanı biten arşiv vade de dayatmaz.
    expect(result[0].openStatementDueDate).toBe('2026-07-14')
  })

  it('keeps the full archive amount when no payment rows are supplied', () => {
    const result = buildCardControlItems([card()], [statement()], [], [reconciliation()], now)
    expect(result[0].openStatementAmount).toBe(4_000)
  })

  it('marks a bank difference as drift and prioritizes it', () => {
    const drifted = card({ id: 'card-2', card_name: 'Black' })
    const result = buildCardControlItems(
      [card(), drifted],
      [],
      [],
      [
        reconciliation(),
        reconciliation({
          id: 'reconciliation-2',
          card_id: 'card-2',
          app_amount: 9_500,
          real_amount: 10_000,
          drift: -500,
        }),
      ],
      now,
    )

    expect(result[0].card.id).toBe('card-2')
    expect(result[0].reconciliationStatus).toBe('drift')
  })

  // Faz D1: ölçüm düzeltmeden sonra da kayıtta durduğu için app ≠ gerçek olmak
  // artık tek başına "fark var" demek değil — aksi halde düzeltilen her kart
  // sonsuza dek kırmızı kalırdı.
  it('does not keep a corrected reconciliation flagged as drift', () => {
    const result = buildCardControlItems(
      [card()],
      [],
      [],
      [reconciliation({ app_amount: 10_500, real_amount: 10_000, drift: 500, resolution: 'corrected' })],
      now,
    )

    expect(result[0].reconciliationStatus).toBe('matched')
  })

  it('distinguishes stale and never-reconciled cards', () => {
    const stale = buildCardControlItems(
      [card()],
      [],
      [],
      [reconciliation({ reconciled_at: '2026-07-10T12:00:00Z' })],
      now,
    )
    const never = buildCardControlItems([card()], [], [], [], now)

    expect(stale[0].reconciliationStatus).toBe('stale')
    expect(never[0].reconciliationStatus).toBe('never')
  })
})
