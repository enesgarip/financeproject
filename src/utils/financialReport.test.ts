import { describe, expect, it } from 'vitest'
import type { Asset, Card, Loan, SalaryHistory } from '../types/database'
import type { FinanceSummaryInput } from './financeSummary'
import { buildFinancialReport, reportToMarkdown } from './financialReport'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const NOW = new Date(2026, 5, 15) // 15 Haziran 2026

function asset(o: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...o }
}
function bankCard(o: Partial<Card>): Card {
  return { ...base, bank_name: 'Banka', card_name: 'Banka Kartı', card_type: 'banka_karti', holder_name: null, limit_group_name: null, current_balance: 0, credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: null, due_day: null, note: null, last_four_digits: null, ...o }
}
function creditCard(o: Partial<Card>): Card {
  return { ...base, bank_name: 'Banka', card_name: 'Kredi Kartı', card_type: 'kredi_karti', holder_name: null, limit_group_name: null, current_balance: 0, credit_limit: 10000, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: 1, due_day: 10, note: null, last_four_digits: null, ...o }
}
function loan(o: Partial<Loan>): Loan {
  return { ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0, monthly_payment: 0, installment_day: null, start_date: null, end_date: null, remaining_installments: 0, status: 'active', note: null, ...o }
}
function salary(o: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...o }
}

const empty: FinanceSummaryInput = {
  assets: [], cards: [], loans: [], loanInstallments: [], debts: [],
  payments: [], salaryHistory: [], cardInstallments: [],
}

describe('buildFinancialReport', () => {
  it('produces a titled, dated report with the core sections', () => {
    const report = buildFinancialReport(empty, { now: NOW })
    expect(report.title).toBe('Finansal Özet')
    expect(report.generatedAt).toContain('2026')
    const headings = report.sections.map((s) => s.heading)
    expect(headings).toContain('Net Değer')
    expect(headings).toContain('Borç Dağılımı')
    expect(headings.some((h) => h.startsWith('6 Aylık Nakit Projeksiyonu'))).toBe(true)
  })

  it('summarises net worth from assets, bank balances and debts', () => {
    const input: FinanceSummaryInput = {
      ...empty,
      assets: [asset({ category: 'Altın', estimated_value_try: 100000 })],
      cards: [
        bankCard({ current_balance: 50000 }),
        creditCard({ debt_amount: 30000, statement_debt_amount: 30000 }),
      ],
      loans: [loan({ status: 'active', remaining_amount: 20000 })],
    }
    const report = buildFinancialReport(input, { now: NOW })
    const netWorth = report.sections.find((s) => s.heading === 'Net Değer')!
    // toplam varlık 150.000, borç 50.000 → net 100.000
    expect(netWorth.lines!.some((l) => l.includes('Net değer') && l.includes('100.000'))).toBe(true)
    const debt = report.sections.find((s) => s.heading === 'Borç Dağılımı')!
    expect(debt.lines!.some((l) => l.startsWith('Kredi kartı'))).toBe(true)
    expect(debt.lines!.some((l) => l.startsWith('Krediler'))).toBe(true)
  })

  it('builds an asset breakdown with inflation-shield ratio note', () => {
    const input: FinanceSummaryInput = {
      ...empty,
      assets: [asset({ category: 'Altın', estimated_value_try: 75000 }), asset({ category: 'Nakit', estimated_value_try: 25000 })],
    }
    const report = buildFinancialReport(input, { now: NOW })
    const breakdown = report.sections.find((s) => s.heading === 'Varlık Dağılımı')!
    expect(breakdown.table!.headers).toEqual(['Kategori', 'Değer', 'Pay'])
    expect(breakdown.table!.rows.length).toBe(2)
    expect(breakdown.note).toContain('Reel/korunaklı')
    expect(breakdown.note).toContain('%75') // 75k of 100k protected
  })

  it('contains NO account/bank/person identifiers (privacy by construction)', () => {
    const input: FinanceSummaryInput = {
      ...empty,
      cards: [bankCard({ bank_name: 'Gizli Banka', card_name: 'Maaş Hesabım', current_balance: 1000 })],
      loans: [loan({ bank_name: 'Gizli Kredi Bankası', loan_name: 'Konut Kredim', remaining_amount: 5000 })],
    }
    const md = reportToMarkdown(buildFinancialReport(input, { now: NOW }))
    expect(md).not.toContain('Gizli Banka')
    expect(md).not.toContain('Maaş Hesabım')
    expect(md).not.toContain('Gizli Kredi Bankası')
    expect(md).not.toContain('Konut Kredim')
  })

  it('marks first-negative month when cash runs out, else says none', () => {
    const positive = buildFinancialReport(
      { ...empty, assets: [asset({ category: 'Nakit', estimated_value_try: 1_000_000 })], salaryHistory: [salary({ amount: 50000 })] },
      { now: NOW },
    )
    const fc = positive.sections.find((s) => s.heading.includes('Projeksiyon'))!
    expect(fc.lines!.some((l) => l.includes('negatife düşen ay yok'))).toBe(true)
  })

  it('omits the FIRE coverage section when there are no expenses', () => {
    const report = buildFinancialReport(empty, { now: NOW })
    expect(report.sections.some((s) => s.heading.startsWith('Servet Kapsama'))).toBe(false)
  })
})

describe('reportToMarkdown', () => {
  it('renders headings, bullets, tables and notes as valid markdown', () => {
    const input: FinanceSummaryInput = {
      ...empty,
      assets: [asset({ category: 'Altın', estimated_value_try: 100000 })],
    }
    const md = reportToMarkdown(buildFinancialReport(input, { now: NOW }))
    expect(md).toMatch(/^# Finansal Özet — /)
    expect(md).toContain('## Net Değer')
    expect(md).toContain('| Kategori | Değer | Pay |')
    expect(md).toContain('| --- | --- | --- |')
    expect(md).toContain('> Reel/korunaklı')
    expect(md).toContain('yalnız yapı + rakam')
  })
})
