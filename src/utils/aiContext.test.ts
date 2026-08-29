import { describe, expect, it } from 'vitest'
import type {
  AccountReconciliation,
  Asset,
  Budget,
  Car,
  Card,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  ExpenseContext,
  KasaBucket,
  Loan,
  LoanInstallment,
  NetWorthSnapshot,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalSnapshot,
  SavingsGoalSource,
  TransactionHistory,
  WishlistItem,
} from '../types/database'
import { buildAiFinanceContext, type AiContextInput } from './aiContext'
import { buildCarSummaries } from './carExpenses'
import type { MarketRatesSnapshot } from './marketRates'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const NOW = new Date(2026, 7, 29) // 29 Ağustos 2026

// ── Factories ──────────────────────────────────────────────────────────────

function emptyInput(): AiContextInput {
  return {
    assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [],
    salaryHistory: [], cardInstallments: [], cardExpenses: [], budgets: [],
  }
}

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, valued_at: null, valuation_rate: null, source: null, note: null, ...overrides }
}

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka', card_name: 'Kart', card_type: 'kredi_karti',
    holder_name: null, account_number: null, limit_group_name: null,
    current_balance: 0, credit_limit: 50_000, debt_amount: 0,
    statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0,
    statement_day: 15, due_day: 25, note: null, ...overrides,
  }
}

function loan(overrides: Partial<Loan>): Loan {
  return {
    ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0,
    monthly_payment: 0, installment_day: null, start_date: null, end_date: null,
    remaining_installments: 0, status: 'active', note: null, ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base, person_name: 'Kişi', direction: 'borç_aldım', value_type: 'TRY',
    currency: null, amount: 0, estimated_value_try: 0, auto_valued: false, valued_at: null,
    valuation_rate: null, due_date: null, status: 'açık', note: null, ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base, title: 'Ödeme', category: 'Fatura', amount: 0, amount_status: 'exact',
    due_date: '2026-09-01', status: 'bekliyor', payment_method: 'manual',
    recurrence: 'none', recurrence_day: null, recurrence_end_date: null,
    auto_source_card_id: null, note: null, ...overrides,
  }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 62_000, effective_date: '2026-01-01', note: null, ...overrides }
}

function budget(overrides: Partial<Budget>): Budget {
  return { ...base, month: '2026-08-01', category: 'Market', limit_amount: 0, note: null, limit_anchor: 'manual', limit_anchor_value: null, ...overrides }
}

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    ...base, name: 'Hedef', value_type: 'TRY', target_amount: 0, current_amount: 0,
    estimated_value_try: null, auto_valued: false, valued_at: null, valuation_rate: null,
    target_date: null, status: 'active', note: null, target_anchor: 'manual',
    target_anchor_units: null, target_anchor_months: null, ...overrides,
  }
}

function goalSource(overrides: Partial<SavingsGoalSource>): SavingsGoalSource {
  return { ...base, goal_id: 'g1', component_id: null, kind: 'all_assets', asset_id: null, asset_category: null, card_id: null, bucket_id: null, sort_order: 0, ...overrides }
}

function expense(overrides: Partial<CardExpense>): CardExpense {
  return {
    ...base, card_id: 'c1', statement_archive_id: null, spent_at: '2026-08-27',
    amount: 0, description: 'Harcama', category: 'Market', installment_count: 1,
    installment_amount: 0, status: 'posted', posted_at: null, note: null,
    transaction_fingerprint: null, source: null, ...overrides,
  }
}

function installment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base, card_id: 'c1', card_expense_id: 'p1', statement_archive_id: null,
    installment_no: 1, installment_count: 6, due_month: '2026-09-15', amount: 1_400,
    description: 'Telefon', category: 'Elektronik', status: 'scheduled',
    posted_at: null, paid_at: null, note: null, ...overrides,
  }
}

function historyRow(overrides: Partial<TransactionHistory>): TransactionHistory {
  return {
    ...base, occurred_at: '2026-08-27T10:00:00Z', type: 'payment', title: 'Kira ödemesi',
    amount: 15_000, source_table: null, source_id: null, source_event_id: null, note: null, ...overrides,
  }
}

function bucket(overrides: Partial<KasaBucket>): KasaBucket {
  return { ...base, name: 'Kova', reserved_amount: 7_500, sort_order: 0, note: null, goal_id: null, last_contribution_month: null, ...overrides }
}

function ratesSnapshot(): MarketRatesSnapshot {
  return {
    rates: { USD: { buying: 41.2, selling: 41.6 }, GRA: { buying: 4_850, selling: 4_900 } },
    asOf: null,
    fetchedAt: '2026-08-29T00:00:00Z',
  }
}

function statementArchive(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base, card_id: 'c1', period_year: 2026, period_month: 7, statement_date: '2026-07-15',
    due_date: '2026-07-25', statement_debt_amount: 9_000, current_period_spending: 0,
    total_debt_amount: 9_000, status: 'paid', paid_at: '2026-07-20T00:00:00Z',
    payment_source_card_id: null, reconciled_bank_amount: null, reconciled_at: null,
    reconciliation_note: null, note: null, ...overrides,
  }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return { ...base, loan_id: 'l1', installment_no: 1, due_date: '2026-09-05', amount: 3_750, status: 'bekliyor', paid_at: null, note: null, ...overrides }
}

function reconciliation(overrides: Partial<AccountReconciliation>): AccountReconciliation {
  return { ...base, card_id: 'c2', reconciled_at: '2026-08-12T09:00:00Z', target: 'balance', app_amount: 5_000, real_amount: 5_000, drift: 0, resolution: 'matched', note: null, ...overrides }
}

function netWorthRow(overrides: Partial<NetWorthSnapshot>): NetWorthSnapshot {
  return { ...base, snapshot_date: '2026-08-29', net_worth: 500_000, gold_try: null, usd_try: null, ...overrides }
}

function goalSnapshotRow(overrides: Partial<SavingsGoalSnapshot>): SavingsGoalSnapshot {
  return { ...base, goal_id: 'g-plain', snapshot_date: '2026-08-25', amount: 40_000, ...overrides }
}

function wishlistItem(overrides: Partial<WishlistItem>): WishlistItem {
  return { ...base, name: 'Kulaklık', estimated_price: 12_000, is_purchased: false, purchased_at: null, sort_order: 0, note: null, ...overrides }
}

function expenseContext(overrides: Partial<ExpenseContext>): ExpenseContext {
  return { ...base, kind: 'travel', name: 'Tatil 2026', budget_amount: null, starts_on: null, ends_on: null, sort_order: 0, note: null, ...overrides }
}

function car(overrides: Partial<Car>): Car {
  return { ...base, name: 'Egea', plate: null, current_odometer_km: null, sort_order: 0, note: null, ...overrides }
}

function richInput(): AiContextInput {
  return {
    ...emptyInput(),
    assets: [asset({ category: 'Altın', estimated_value_try: 120_000 })],
    cards: [
      card({ id: 'c1', card_name: 'Bonus', debt_amount: 12_480, statement_debt_amount: 8_000, current_period_spending: 4_000, provision_amount: 480 }),
      card({ id: 'c2', card_type: 'banka_karti', card_name: 'Vadesiz', current_balance: 5_000, statement_day: null, due_day: null }),
    ],
    loans: [loan({ loan_name: 'İhtiyaç', remaining_amount: 45_000, remaining_installments: 12, monthly_payment: 3_750, installment_day: 5 })],
    debts: [debt({ person_name: 'Ali', estimated_value_try: 5_000 })],
    payments: [payment({ title: 'Kira', amount: 15_000, due_date: '2026-09-12', recurrence: 'monthly', recurrence_day: 12 })],
    salaryHistory: [salary({})],
    budgets: [budget({ limit_amount: 10_000 })],
    savingsGoals: [
      goal({ id: 'g-plain', name: 'Tatil', target_amount: 100_000, current_amount: 40_000 }),
      goal({ id: 'g-comp', name: 'Karma', value_type: 'composite' }),
      goal({ id: 'g-src', name: 'Takipli', target_amount: 200_000 }),
    ],
    savingsGoalSources: [goalSource({ goal_id: 'g-src' })],
    cardExpenses: [
      expense({ description: 'Migros', amount: 450, spent_at: '2026-08-27' }),
      expense({ description: 'Kahve', amount: 300, category: 'Yeme & İçme', spent_at: '2026-08-26' }),
      expense({ description: 'İptal', amount: 999, status: 'cancelled', spent_at: '2026-08-25' }),
    ],
    cardInstallments: [
      installment({ id: 'i1', installment_no: 2, due_month: '2026-09-15' }),
      installment({ id: 'i2', installment_no: 3, due_month: '2026-10-15' }),
      // Dönem içine yazılmış taksit takvimde görünmemeli (çift sayım olurdu).
      installment({ id: 'i0', installment_no: 1, due_month: '2026-08-15', status: 'posted', posted_at: '2026-08-15T00:00:00Z' }),
    ],
    transactionHistory: [historyRow({})],
  }
}

function sectionOf(out: string, prefix: string) {
  return out.split('\n\n').find((section) => section.startsWith(prefix))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildAiFinanceContext', () => {
  it('anahtar rakamları Şerit biçiminde ve doğru bölümlerde basar', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })

    expect(out).toContain('FİNANSAL POZİSYON')
    expect(out).toContain('12.480 ₺') // kart borcu
    expect(out).toContain("kesim ayın 15'i")
    expect(out).toContain('Banka Vadesiz (banka hesabı): bakiye 5.000 ₺')
    expect(out).toContain('İhtiyaç: kalan 45.000 ₺, 12 taksit, aylık 3.750 ₺')
    expect(out).toContain('Ali: borcum 5.000 ₺')
    expect(out).toContain('Kira 15.000 ₺, aylık tekrar')
    expect(out).toContain('Tatil: hedef 100.000 ₺, biriken 40.000 ₺')
    expect(out).toContain('Altın 120.000 ₺')
    expect(out).toContain('Migros 450 ₺ [Market]')
    // İptal edilen harcama hiçbir listede görünmez.
    expect(out).not.toContain('İptal')
  })

  it('taksit takvimini scheduled satırlardan kurar; posted takvime girmez', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })
    const section = sectionOf(out, 'KART TAKSİT TAKVİMİ')

    expect(section).toBeDefined()
    expect(section).toContain('Eylül 2026 1.400 ₺')
    expect(section).toContain('Ekim 2026 1.400 ₺')
    // Ağustos'taki tek satır posted: aylık toplamda görünmez.
    expect(section).not.toContain('Ağustos 2026')
    // Plan satırı: kalan scheduled sayısı / toplam taksit + bitiş ayı.
    expect(section).toContain('Telefon (Banka Bonus): aylık 1.400 ₺, kalan 2/6 taksit, bitiş Ekim 2026')
  })

  it('gelecek ayın bilinen kalemlerini ayrı bölümde verir', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })
    const section = sectionOf(out, 'GELECEK AY (Eylül 2026)')

    expect(section).toBeDefined()
    expect(section).toContain('maaş 62.000 ₺')
    expect(section).toContain('planlı ödeme 15.000 ₺')
  })

  it('bütçede limitle birlikte gerçekleşmeyi basar; kurallı limit türetilir', () => {
    const input = richInput()
    input.budgets.push(budget({ id: 'b2', category: 'Ulaşım', limit_anchor: 'avg_spend', limit_anchor_value: 1.5 }))
    input.cardExpenses.push(
      expense({ id: 'u1', category: 'Ulaşım', amount: 1_000, spent_at: '2026-05-10' }),
      expense({ id: 'u2', category: 'Ulaşım', amount: 2_000, spent_at: '2026-06-10' }),
      expense({ id: 'u3', category: 'Ulaşım', amount: 3_000, spent_at: '2026-07-10' }),
    )

    const out = buildAiFinanceContext(input, { now: NOW })
    const section = sectionOf(out, 'BU AYIN BÜTÇELERİ')

    expect(section).toContain('Market: limit 10.000 ₺, harcanan 450 ₺ (%5)')
    // Ort. (1000+2000+3000)/3 = 2000 × 1,5 = 3000; kural etiketi görünür.
    expect(section).toContain('Ulaşım: limit 3.000 ₺ [kural: Son 3 ay ort.')
  })

  it('kaynak-takipli hedefin birikenini ekranlarla aynı türetmeyle basar', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })
    const section = sectionOf(out, 'BİRİKİM HEDEFLERİ')

    expect(section).toContain('Takipli: hedef 200.000 ₺, biriken 120.000 ₺ — kaynaklardan türetildi')
    expect(section).toContain('Karma: karma hedef, 0/0 bileşen hedefinde')
  })

  it('türetilemeyen hedef rakam uydurmaz, veri gelince rakama döner', () => {
    const input = richInput()
    input.savingsGoals = [
      goal({ id: 'g-bucket', name: 'Kovalı', target_amount: 50_000 }),
      goal({ id: 'g-gold', name: 'Altın Çıpalı', target_anchor: 'gold', target_anchor_units: 10 }),
    ]
    input.savingsGoalSources = [goalSource({ goal_id: 'g-bucket', kind: 'kasa_bucket', bucket_id: 'b1' })]

    // Kova listesi ve kur verilmedi: iki hedef de etikete düşer, ₺ basılmaz.
    const bare = sectionOf(buildAiFinanceContext(input, { now: NOW }), 'BİRİKİM HEDEFLERİ')
    const bareBucketLine = bare!.split('\n').find((line) => line.includes('Kovalı'))
    const bareGoldLine = bare!.split('\n').find((line) => line.includes('Altın Çıpalı'))
    expect(bareBucketLine).toContain('kaynak-takipli hedef')
    expect(bareBucketLine).not.toContain('₺')
    expect(bareGoldLine).toContain('çıpalı hedef')
    expect(bareGoldLine).not.toContain('₺')

    // Kova + kur gelince aynı hedefler rakamla konuşur.
    const full = sectionOf(
      buildAiFinanceContext(input, { now: NOW, kasaBuckets: [bucket({ id: 'b1' })], ratesSnapshot: ratesSnapshot() }),
      'BİRİKİM HEDEFLERİ',
    )
    expect(full).toContain('Kovalı: hedef 50.000 ₺, biriken 7.500 ₺ — kaynaklardan türetildi')
    // 10 gram × 4.850 TL alış = 48.500 ₺ türetilmiş hedef.
    expect(full).toContain('Altın Çıpalı: hedef 48.500 ₺ (çıpa: 10 gram altın karşılığı)')
  })

  it('kredi limit gruplarını doluluk oranıyla basar', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })
    const section = sectionOf(out, 'KREDİ LİMİTLERİ')

    // 12.480 / 50.000 = %25; kullanılabilir = limit − borç.
    expect(section).toContain('limit 50.000 ₺, kullanılan 12.480 ₺ (%25), kullanılabilir 37.520 ₺')
    // Banka hesabı limit grubuna girmez.
    expect(section).not.toContain('Vadesiz')
  })

  it('tampon + kova verilince güvenle harcanabilir satırını basar, verilmeyince basmaz', () => {
    const withInputs = buildAiFinanceContext(richInput(), { now: NOW, safeToSpendBuffer: 5_000, kasaBuckets: [] })
    expect(withInputs).toContain('Güvenle harcanabilir:')

    const without = buildAiFinanceContext(richInput(), { now: NOW })
    expect(without).not.toContain('Güvenle harcanabilir')
  })

  it('abonelik radarını basar (≥3 ay tutarlı kart tekrarı + planlı ödeme)', () => {
    const input = richInput()
    input.cardExpenses.push(
      expense({ id: 'n1', description: 'Netflix', amount: 129.9, category: 'Abonelik', spent_at: '2026-06-05' }),
      expense({ id: 'n2', description: 'Netflix', amount: 129.9, category: 'Abonelik', spent_at: '2026-07-05' }),
      expense({ id: 'n3', description: 'Netflix', amount: 129.9, category: 'Abonelik', spent_at: '2026-08-05' }),
    )

    const section = sectionOf(buildAiFinanceContext(input, { now: NOW }), 'ABONELİKLER')
    expect(section).toBeDefined()
    expect(section).toContain('Netflix')
    expect(section).toContain('(3 aydır)')
    // Aylık tekrarlı bekleyen ödeme de düzenli gider sayılır, kaynağı işaretlenir.
    expect(section).toContain('Kira: ~15.000 ₺/ay [planlı ödeme]')
  })

  it('ekstre geçmişini eski→yeni basar, açık ekstreyi işaretler', () => {
    const input = richInput()
    input.cardStatements = [
      statementArchive({ id: 's1', statement_date: '2026-07-15', statement_debt_amount: 9_000, status: 'paid' }),
      statementArchive({ id: 's2', statement_date: '2026-08-15', statement_debt_amount: 8_000, status: 'open', paid_at: null }),
    ]

    const section = sectionOf(buildAiFinanceContext(input, { now: NOW }), 'EKSTRE GEÇMİŞİ')
    expect(section).toContain('Banka Bonus: Tem 2026 9.000 ₺ → Ağu 2026 8.000 ₺ (açık)')
  })

  it('kredinin bitiş ayını ödenmemiş son taksitten türetir', () => {
    const input = richInput()
    input.loans[0] = { ...input.loans[0], id: 'l1' }
    input.loanInstallments = [
      loanInstallment({ id: 'li1', due_date: '2026-09-05' }),
      loanInstallment({ id: 'li2', installment_no: 18, due_date: '2027-02-05' }),
      loanInstallment({ id: 'li3', installment_no: 19, due_date: '2027-03-05', status: 'ödendi' }),
    ]

    const out = buildAiFinanceContext(input, { now: NOW })
    expect(out).toContain('bitiş Şubat 2027')
  })

  it('kart listesi öneme göre sıralı; taşan kısım "+N daha" ile söylenir', () => {
    const input = richInput()
    for (let i = 0; i < 10; i += 1) {
      input.cards.push(card({ id: `extra${i}`, card_name: `Ek${i}`, debt_amount: 10 + i }))
    }

    const section = sectionOf(buildAiFinanceContext(input, { now: NOW }), 'KARTLAR VE HESAPLAR')
    // 12.480 borçlu kart sıralamada üstte kalır, kesilmez.
    expect(section).toContain('Bonus')
    expect(section).toContain('… ve 2 hesap/kart daha')
  })

  it('banka hesabına son mutabakat tarihini iliştirir', () => {
    const input = richInput()
    input.accountReconciliations = [
      reconciliation({ id: 'r-eski', reconciled_at: '2026-07-01T09:00:00Z' }),
      reconciliation({ id: 'r-yeni', reconciled_at: '2026-08-12T09:00:00Z' }),
    ]

    const out = buildAiFinanceContext(input, { now: NOW })
    expect(out).toContain('Vadesiz (banka hesabı): bakiye 5.000 ₺; son banka doğrulaması 12 Ağu 2026')
  })

  it('kasa kovalarını, araçları, bağlamları ve alsam-mı listesini basar', () => {
    const cars = [car({ id: 'car1' })]
    const tagged = [expense({ id: 'f1', description: 'Opet', category: 'Yakıt', amount: 2_000, spent_at: '2026-08-10', car_id: 'car1', fuel_liters: 40 })]
    const input = richInput()
    input.cardExpenses.push(tagged[0], expense({ id: 'ctx1e', description: 'Otel', amount: 4_000, spent_at: '2026-08-15', context_id: 'ctx1' }))

    const out = buildAiFinanceContext(input, {
      now: NOW,
      kasaBuckets: [bucket({ id: 'b1', name: 'Acil fon' })],
      carSummaries: buildCarSummaries(cars, [], tagged, NOW),
      expenseContexts: [expenseContext({ id: 'ctx1' })],
      contextExpenses: [],
      wishlistItems: [wishlistItem({}), wishlistItem({ id: 'w2', name: 'Alınan', is_purchased: true })],
    })

    expect(sectionOf(out, 'KASA KOVALARI')).toContain('Acil fon: 7.500 ₺')
    expect(sectionOf(out, 'ARAÇLAR')).toContain('Egea: bu ay 2.000 ₺')
    expect(sectionOf(out, 'GİDER BAĞLAMLARI')).toContain('Tatil 2026 (Seyahat / Tatil): toplam 4.000 ₺')
    const wishlist = sectionOf(out, 'ALSAM MI LİSTESİ')
    expect(wishlist).toContain('Kulaklık: ~12.000 ₺')
    // Satın alınmış madde listelenmez.
    expect(wishlist).not.toContain('Alınan')
  })

  it('net değer trendini geçmiş fotoğraflardan basar', () => {
    const out = buildAiFinanceContext(richInput(), {
      now: NOW,
      netWorthSnapshots: [
        netWorthRow({ id: 'nw1', snapshot_date: '2026-08-29', net_worth: 500_000 }),
        netWorthRow({ id: 'nw2', snapshot_date: '2026-07-28', net_worth: 480_000 }),
        netWorthRow({ id: 'nw3', snapshot_date: '2026-05-30', net_worth: 450_000 }),
      ],
    })

    const section = sectionOf(out, 'NET DEĞER TRENDİ')
    expect(section).toContain('Bugün: 500.000 ₺')
    expect(section).toContain('1 ay önce: 480.000 ₺')
    expect(section).toContain('artış')
  })

  it('hedef fotoğrafları verilince rakamlı hedefe tahmini bitiş ekler', () => {
    const out = buildAiFinanceContext(richInput(), {
      now: NOW,
      goalSnapshots: [
        goalSnapshotRow({ id: 'gs1', snapshot_date: '2026-07-01', amount: 10_000 }),
        goalSnapshotRow({ id: 'gs2', snapshot_date: '2026-08-25', amount: 40_000 }),
      ],
    })

    const line = sectionOf(out, 'BİRİKİM HEDEFLERİ')!.split('\n').find((row) => row.includes('Tatil'))
    expect(line).toContain('bu tempoyla tahmini bitiş')
  })

  it('kur snapshot verilirse piyasa satırı basılır, verilmezse basılmaz', () => {
    const withRates = buildAiFinanceContext(richInput(), { now: NOW, ratesSnapshot: ratesSnapshot() })
    expect(withRates).toContain('Piyasa kurları (alış): USD 41,2 TL · gram altın 4.850 TL')

    const withoutRates = buildAiFinanceContext(richInput(), { now: NOW })
    expect(withoutRates).not.toContain('Piyasa kurları')
  })

  it('aylık harcama trendini ve son hareketleri basar', () => {
    const out = buildAiFinanceContext(richInput(), { now: NOW })

    const trend = sectionOf(out, 'AYLIK KART HARCAMASI TRENDİ')
    expect(trend).toContain('Ağu 2026 750 ₺')

    const history = sectionOf(out, 'SON HAREKETLER')
    expect(history).toContain('27 Ağu 2026: Kira ödemesi 15.000 ₺')
  })

  it('maxChars sınırını bölüm bütünlüğünü koruyarak uygular', () => {
    const full = buildAiFinanceContext(richInput(), { now: NOW })
    const limited = buildAiFinanceContext(richInput(), { now: NOW, maxChars: 800 })

    expect(limited.length).toBeLessThanOrEqual(800)
    expect(limited.length).toBeGreaterThan(0)
    // Kırpma yalnız bölüm sınırında: kısıtlı çıktı, tam çıktının öneki.
    expect(full.startsWith(limited)).toBe(true)
    // Son bölüm yarım satırla bitmez.
    expect(limited.endsWith('\n')).toBe(false)
  })

  it('boş snapshot ile çökmez, çekirdek bölümleri yine üretir', () => {
    const out = buildAiFinanceContext(emptyInput(), { now: NOW })

    expect(out).toContain('Tarih: 29 Ağu 2026')
    expect(out).toContain('FİNANSAL POZİSYON')
    expect(out).toContain('Net değer: 0 ₺')
    expect(out).toContain('GELECEK AY')
    // Boş listelerin bölümleri hiç açılmaz.
    expect(out).not.toContain('KREDİLER')
    expect(out).not.toContain('SON KART HARCAMALARI')
    expect(out).not.toContain('KART TAKSİT TAKVİMİ')
    expect(out).not.toContain('AYLIK KART HARCAMASI TRENDİ')
    expect(out).not.toContain('SON HAREKETLER')
  })

  it('bozuk sayılarda NaN/undefined sızdırmaz', () => {
    const input = richInput()
    input.assets.push(asset({ category: 'Fon', estimated_value_try: Number.NaN }))
    input.cardExpenses.push(expense({ description: 'Bozuk', amount: Number.NaN, spent_at: '2026-08-20' }))
    input.transactionHistory!.push(historyRow({ id: 'h2', title: 'Bozuk hareket', amount: Number.NaN }))

    const out = buildAiFinanceContext(input, { now: NOW })
    expect(out).not.toContain('NaN')
    expect(out).not.toContain('undefined')
  })

  it('işlem listesini 20 satırla sınırlar (200 işlemde)', () => {
    const input = richInput()
    input.cardExpenses = Array.from({ length: 200 }, (_, i) =>
      expense({
        id: `e${i}`,
        description: `Harcama ${i}`,
        amount: 100 + i,
        spent_at: `2026-0${(i % 4) + 5}-${String((i % 28) + 1).padStart(2, '0')}`,
      }),
    )

    const out = buildAiFinanceContext(input, { now: NOW })
    const section = sectionOf(out, 'SON KART HARCAMALARI')
    expect(section).toBeDefined()
    // Başlık + 20 işlem satırı + "+N daha" bildirimi (sessiz kırpma yok).
    expect(section!.split('\n').length).toBe(22)
    expect(section).toContain('… ve 180 harcama daha')
  })
})
