import { describe, expect, it } from 'vitest'
import type { Asset, Card, CardExpense, CardInstallment, CardStatementArchive, Debt, KasaBucket, Loan, Payment, SalaryHistory, SavingsGoal, SavingsGoalSource } from '../types/database'
import type { FinanceSummaryInput } from './financeSummary'
import { buildFinancialReport, reportToMarkdown } from './financialReport'
import type { FinancialReportInput } from './financialReport'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const NOW = new Date(2026, 5, 15) // 15 Haziran 2026

function asset(o: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, valued_at: null, valuation_rate: null, source: null, note: null, ...o }
}
function bankCard(o: Partial<Card>): Card {
  return { ...base, bank_name: 'Banka', card_name: 'Banka Kartı', card_type: 'banka_karti', holder_name: null, account_number: null, limit_group_name: null, current_balance: 0, credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: null, due_day: null, note: null, ...o }
}
function creditCard(o: Partial<Card>): Card {
  return { ...base, bank_name: 'Banka', card_name: 'Kredi Kartı', card_type: 'kredi_karti', holder_name: null, account_number: null, limit_group_name: null, current_balance: 0, credit_limit: 10000, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0, statement_day: 1, due_day: 10, note: null, ...o }
}
function loan(o: Partial<Loan>): Loan {
  return { ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0, monthly_payment: 0, installment_day: null, start_date: null, end_date: null, remaining_installments: 0, status: 'active', note: null, ...o }
}
function salary(o: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...o }
}
function goal(o: Partial<SavingsGoal>): SavingsGoal {
  return { ...base, name: 'Gizli hedefim', value_type: 'TRY', target_amount: 10000, current_amount: 0, estimated_value_try: null, auto_valued: false, valued_at: null, valuation_rate: null, target_date: null, status: 'active', note: null, target_anchor: 'manual', target_anchor_units: null, target_anchor_months: null, ...o }
}
function goalSource(o: Partial<SavingsGoalSource>): SavingsGoalSource {
  return { ...base, goal_id: 'g1', component_id: null, kind: 'bank_account', asset_id: null, asset_category: null, card_id: 'account', bucket_id: null, sort_order: 0, ...o }
}
function expense(o: Partial<CardExpense>): CardExpense {
  return { ...base, card_id: 'c1', statement_archive_id: null, spent_at: '2026-06-10', amount: 100, description: 'Gizli açıklama', category: 'Market', installment_count: 1, installment_amount: 100, status: 'posted', posted_at: null, note: null, transaction_fingerprint: null, source: null, ...o }
}
function installment(o: Partial<CardInstallment>): CardInstallment {
  return { ...base, card_id: 'c1', card_expense_id: 'e1', statement_archive_id: null, installment_no: 1, installment_count: 3, due_month: '2026-07-15', amount: 100, description: 'Gizli alışveriş', category: 'Market', status: 'scheduled', posted_at: null, paid_at: null, note: null, ...o }
}
function payment(o: Partial<Payment>): Payment {
  return { ...base, title: 'Gizli kira adresi', category: 'Fatura', amount: 500, amount_status: 'exact', due_date: '2026-06-20', status: 'bekliyor', payment_method: 'manual', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, auto_source_card_id: null, note: null, ...o }
}

const empty: FinanceSummaryInput = {
  assets: [], cards: [], loans: [], loanInstallments: [], debts: [],
  payments: [], salaryHistory: [], cardInstallments: [],
}

describe('buildFinancialReport', () => {
  it('eksik kart takviminde harcanabilir tutarı doğrulanmış sayı gibi yazmaz', () => {
    const input = { ...empty, cards: [bankCard({ current_balance: 45000 }), creditCard({ debt_amount: 25000, statement_debt_amount: 10000, current_period_spending: 15000, statement_day: null, due_day: null })] }
    const md = reportToMarkdown(buildFinancialReport(input, { now: NOW, safeToSpendBuffer: 5000, kasaBuckets: [] }))
    expect(md).toContain('Bu ay harcanabilir: doğrulanamadı (kart kesim veya son ödeme günü eksik).')
  })
  it('produces a titled, dated report with the core sections', () => {
    const report = buildFinancialReport(empty, { now: NOW })
    expect(report.title).toBe('Finansal Özet')
    expect(report.generatedAt).toContain('2026')
    const headings = report.sections.map((s) => s.heading)
    expect(headings.slice(0, 3)).toEqual(['Güncel Durum', 'Yakın Vadeler', 'Son Dönemdeki Değişim'])
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
    expect(breakdown.note).toContain('TL nakit dışındaki varlıklar')
    expect(breakdown.note).toContain('%75') // 75k of 100k protected
  })

  it('contains NO account/bank/person identifiers (privacy by construction)', () => {
    const input: FinanceSummaryInput = {
      ...empty,
      cards: [bankCard({ bank_name: 'Gizli Banka', card_name: 'Maaş Hesabım', current_balance: 1000 })],
      loans: [loan({ bank_name: 'Gizli Kredi Bankası', loan_name: 'Konut Kredim', remaining_amount: 5000, remaining_installments: 4, monthly_payment: 1250 })],
    }
    const md = reportToMarkdown(buildFinancialReport(input, { now: NOW }))
    expect(md).not.toContain('Gizli Banka')
    expect(md).not.toContain('Maaş Hesabım')
    expect(md).not.toContain('Gizli Kredi Bankası')
    expect(md).not.toContain('Konut Kredim')
    expect(md).toContain('| Kredi 1 | ₺5.000,00 | 4 | ₺1.250,00 |')
  })

  it('marks first-negative month when cash runs out, else says none', () => {
    const positive = buildFinancialReport(
      { ...empty, assets: [asset({ category: 'Nakit', estimated_value_try: 1_000_000 })], salaryHistory: [salary({ amount: 50000 })] },
      { now: NOW },
    )
    const fc = positive.sections.find((s) => s.heading.includes('Projeksiyon'))!
    expect(fc.lines).toContain('Kayıtlı planlarla ay sonu nakdi eksiye düşmüyor.')
    const negative = buildFinancialReport({ ...empty, payments: [payment({ amount: 3000 })] }, { now: NOW })
    expect(negative.sections[0].lines).toContain('İlk nakit açığı: Haziran 2026 · -₺3.000,00')
  })

  it('deducts both cash reserves and buffer, while leaving unverified spending power unknown', () => {
    const input = { ...empty, cards: [bankCard({ current_balance: 10000 }), bankCard({ account_kind: 'cash', current_balance: 2000 })] }
    const buckets: KasaBucket[] = [{ ...base, name: 'Gizli kasa', reserved_amount: 1500, sort_order: 0, note: null, goal_id: null, last_contribution_month: null }]
    const report = buildFinancialReport(input, { now: NOW, safeToSpendBuffer: 500, kasaBuckets: buckets })
    const accounts = report.sections.find((section) => section.heading === 'Hesaplar ve Nakit')!.lines!
    expect(accounts).toContain('Banka hesapları (1): ₺10.000,00')
    expect(accounts).toContain('Nakit cüzdanları (1): ₺2.000,00')
    expect(report.sections[0].lines).toContain('Bu ay harcanabilir: ₺10.000,00')
    expect(reportToMarkdown(report)).not.toContain('Gizli kasa')
    const unknown = reportToMarkdown(buildFinancialReport(input, { now: NOW, safeToSpendBuffer: 500 }))
    expect(unknown).toContain('harcanabilir tutar hesaplanamadı')
    expect(unknown).not.toContain('Bu ay harcanabilir:')
  })

  it('rapordaki harcanabilir tutara beklenen alacağı eklemez', () => {
    const receivable: Debt = { ...base, person_name: 'Gizli kişi', direction: 'borç_verdim', value_type: 'TRY',
      currency: null, amount: 5000, estimated_value_try: 5000, auto_valued: false, valued_at: null,
      valuation_rate: null, due_date: '2026-06-20', status: 'açık', note: null }
    const input = { ...empty, cards: [bankCard({ current_balance: 10000 })], debts: [receivable] }
    const report = reportToMarkdown(buildFinancialReport(input, { now: NOW, safeToSpendBuffer: 500, kasaBuckets: [] }))

    expect(report).toContain('Bu ay harcanabilir: ₺9.500,00')
    expect(report).toContain('alacak tahsilatı ₺5.000,00')
  })

  it('uses partial statement payments in the upcoming cash obligations without exposing names', () => {
    const statement: CardStatementArchive = { ...base, id: 's1', card_id: 'c1', period_year: 2026, period_month: 6, statement_date: '2026-06-10', due_date: '2026-06-20', statement_debt_amount: 1000, current_period_spending: 0, total_debt_amount: 1000, status: 'open', paid_at: null, payment_source_card_id: null, reconciled_bank_amount: null, reconciled_at: null, reconciliation_note: null, note: null }
    const input = { ...empty, cards: [creditCard({ id: 'c1', card_name: 'Gizli kart', holder_name: 'Gizli kişi', debt_amount: 600, statement_debt_amount: 600 })], cardStatements: [statement], cardStatementPayments: [{ statement_archive_id: 's1', amount: 400 }] }
    const report = buildFinancialReport(input, { now: NOW })
    const upcoming = report.sections.find((section) => section.heading === 'Önümüzdeki 30 Gün')!.table!.rows
    expect(upcoming.find((row) => row[1] === 'Kart ekstresi')?.slice(3)).toEqual(['₺600,00', '₺600,00'])
    expect(reportToMarkdown(report)).not.toMatch(/Gizli kart|Gizli kişi/)
  })

  it('lists only scheduled installments and marks missing optional tables', () => {
    const input: FinancialReportInput = { ...empty, cards: [creditCard({ id: 'c1' })], cardInstallments: [installment({ amount: 350 }), installment({ status: 'posted', amount: 900 }), installment({ status: 'paid', amount: 800 })] }
    const report = buildFinancialReport(input, { now: NOW })
    const rows = report.sections.find((section) => section.heading === 'Gelecek Taksit Takvimi')!.table!.rows
    expect(rows[1][1]).toBe('₺350,00')
    const missing = buildFinancialReport({ ...input, missingTables: ['card_installments'] }, { now: NOW, safeToSpendBuffer: 0, kasaBuckets: [] })
    expect(missing.sections.some((section) => section.heading === 'Gelecek Taksit Takvimi')).toBe(false)
    expect(reportToMarkdown(missing)).toContain('ek veri tabloları bu ortamda mevcut değil')
    expect(missing.sections[0].lines).toContain('Bu ay harcanabilir: doğrulanamadı (kart verisi eksik).')
  })

  it('shows same-day spending deltas and dated net worth comparisons without future, cancelled or private values', () => {
    const input = { ...empty, cards: [bankCard({ current_balance: 10000 })], cardExpenses: [
      expense({ amount: 300 }),
      expense({ spent_at: '2026-05-10', amount: 100 }),
      expense({ spent_at: '2026-05-25', amount: 900 }),
      expense({ spent_at: '2026-06-25', amount: 900 }),
      expense({ amount: 500, status: 'cancelled' }),
      expense({ amount: 50, category: 'Gizli kategori | özel' }),
    ], transactionHistory: [] }
    const report = buildFinancialReport(input, {
      now: NOW, snapshotReadAt: new Date(2026, 5, 14, 20, 10).getTime(),
      netWorthSnapshots: [
        { snapshot_date: '2026-06-01', net_worth: 9000 },
        { snapshot_date: '2026-05-10', net_worth: 8000 },
      ],
    })
    expect(report.sections[0].lines?.[0]).toMatch(/Son veri okuma: .*20:10/)
    const changes = report.sections[2].lines
    expect(changes).toContain('Ayın aynı gününe kadar kart harcaması: bu ay ₺350,00 · geçen ay ₺100,00')
    expect(changes).toContain('Geçen ay aynı güne göre değişim: %250')
    expect(changes).toContain('En çok artan kategoriler: Market +₺200,00 · Diğer +₺50,00')
    expect(changes).toContain('Net değer değişimi (30 gün önceye en yakın eski kayıt, 10 May 2026): +₺2.000,00')
    expect(changes).toContain('90 günlük net değer karşılaştırması için yeterli geçmiş yok.')
    const spending = report.sections.find((section) => section.heading === 'Kart Harcama Eğilimi')!
    expect(spending.table!.rows).toEqual([['Market', '₺300,00', '%86'], ['Diğer', '₺50,00', '%14']])
    expect(reportToMarkdown(report)).not.toMatch(/Gizli açıklama|Gizli kategori/)
    expect(reportToMarkdown(report)).toContain('Planlanan nakit çıkışı:')
    expect(reportToMarkdown(report)).toContain('Toplam kayıtlı nakit ödeme:')
  })

  it('resolves anonymous goals from their sources and never treats missing sources or rates as known values', () => {
    const input: FinancialReportInput = { ...empty, cards: [bankCard({ id: 'account', current_balance: 2500 })], savingsGoals: [goal({ id: 'g1' }), goal({ id: 'g2' }), goal({ id: 'g3', target_anchor: 'usd', target_anchor_units: 100 })], savingsGoalSources: [goalSource({}), goalSource({ goal_id: 'g2', card_id: 'missing' })] }
    const report = buildFinancialReport(input, { now: NOW })
    const rows = report.sections.find((section) => section.heading === 'Birikim Hedefleri')!.table!.rows
    expect(rows[0][1]).toContain('2.500,00')
    expect(rows[0][3]).toBe('%25')
    expect(rows[1][1]).toBe('Kaynak doğrulanamadı')
    expect(rows[2][2]).toBe('Güncel hedef verisi eksik')
    expect(rows[1][3]).toBe('—')
    expect(rows[2][3]).toBe('—')
    expect(reportToMarkdown(report)).not.toContain('Gizli hedefim')
    const missingSourceTable = buildFinancialReport({ ...input, savingsGoalSources: [], missingTables: ['savings_goal_sources'] }, { now: NOW })
    expect(missingSourceTable.sections.find((section) => section.heading === 'Birikim Hedefleri')!.table!.rows[0][1]).toBe('Kaynak doğrulanamadı')
  })

  it('counts a shared credit limit once and does not expose payment titles', () => {
    const input = { ...empty, cards: [creditCard({ id: 'c1', limit_group_name: 'Gizli aile', credit_limit: 10000 }), creditCard({ id: 'c2', limit_group_name: 'Gizli aile', credit_limit: 10000 })], payments: [payment({ amount_status: 'estimated' })] }
    const report = buildFinancialReport(input, { now: NOW })
    expect(report.sections.find((section) => section.heading === 'Kart Borcu ve Limit Ayrıntıları')!.lines![0]).toBe('Ortak limitler tek sayılmış toplam limit: ₺10.000,00')
    expect(reportToMarkdown(report)).toContain('(tahmini)')
    expect(reportToMarkdown(report)).not.toMatch(/Gizli aile|Gizli kira adresi/)
  })

  it('counts overdue obligations separately and places each future card installment once at its cash due date', () => {
    const report = buildFinancialReport({
      ...empty,
      cards: [creditCard({ id: 'c1', statement_day: 25, due_day: 5 })],
      cardInstallments: [
        installment({ due_month: '2026-06-25', amount: 350 }),
        installment({ due_month: '2026-06-25', amount: 900, status: 'posted' }),
      ],
      payments: [
        payment({ id: 'older', due_date: '2026-05-20', amount: 100 }),
        payment({ id: 'late', due_date: '2026-06-10', amount: 200 }),
        payment({ id: 'paid', due_date: '2026-06-12', amount: 300, status: 'ödendi' }),
        payment({ id: 'upcoming' }),
        payment({ id: 'card', amount: 700, payment_method: 'bank_auto', auto_source_card_id: 'c1' }),
      ],
      salaryHistory: [salary({ amount: 4000 })],
    }, { now: NOW })
    const lines = report.sections[1].lines!
    expect(lines[0]).toBe('Vadesi geçmiş açık ödeme: 2 kayıt · kayıtlı nakit yükü ₺300,00')
    expect(lines[1]).toMatch(/22 Haz 2026\): ₺500,00$/)
    expect(lines[2]).toMatch(/15 Tem 2026\): ₺850,00$/)
    expect(lines[3]).toContain('maaş ₺4.000,00')
    const upcoming = report.sections.find((section) => section.heading === 'Önümüzdeki 30 Gün')!.table!.rows
    expect(upcoming.filter((row) => row[1].startsWith('Planlı kart taksiti'))).toEqual([
      ['05 Tem 2026', 'Planlı kart taksiti (tahmini ödeme günü)', 'Çıkış', '₺350,00', '₺350,00'],
    ])
    const monthly = report.sections.find((section) => section.heading.startsWith('Bu Ay Nakit Akışı'))!
    expect(monthly.lines).toContain('Ay sonuna kadar kalan nakit çıkışı (geciken açık yükümlülükler dahil): ₺800,00')
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
    expect(md).toContain('> TL nakit dışındaki varlıklar')
    expect(md).toContain('Ayrıntılar anonimdir.')
  })
})
