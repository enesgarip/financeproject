import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  projectCardDebt,
  projectCardDebtKurus,
  projectCardSplit,
  summarizeCardLedger,
  type CardLedgerEvent,
} from './cardLedger'
import { clampCardBreakdown, expectedInstallmentAmount, projectLoanSummary } from './financeSummary'
import { sumKurus, toKurus, toTL } from './money'

/**
 * Ledger/clamp katmanının property kanıtları (money.property deseninin
 * devamı — mühendislik turu ④). Dört büyük para rakamının cebiri bugüne dek
 * seçilmiş örneklerle test ediliyordu; burada "HER olay dizisi için" sınıfı
 * değişmezler rastgele girdiyle taranır. Karşı örnek çıkarsa fast-check
 * tekrar üretilebilir seed basar.
 */

const kurusArb = fc.integer({ min: -1e9, max: 1e9 })
const moneyArb = fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true })
const nonNegMoneyArb = fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true })

/** Kova deltaları amount'a TAM toplanan (trigger sözleşmesi) tam-fidelity olay. */
const fullDeltaEventArb: fc.Arbitrary<CardLedgerEvent> = fc
  .record({
    amount_kurus: kurusArb,
    statement_delta_kurus: kurusArb,
    current_delta_kurus: kurusArb,
  })
  .map(({ amount_kurus, statement_delta_kurus, current_delta_kurus }) => ({
    card_id: 'c1',
    kind: 'debit',
    occurred_at: '2026-08-26T00:00:00Z',
    amount_kurus,
    statement_delta_kurus,
    current_delta_kurus,
    provision_delta_kurus: amount_kurus - statement_delta_kurus - current_delta_kurus,
  }))

const nullDeltaEventArb: fc.Arbitrary<CardLedgerEvent> = kurusArb.map((amount_kurus) => ({
  card_id: 'c1',
  kind: 'debit',
  occurred_at: '2026-08-26T00:00:00Z',
  amount_kurus,
  statement_delta_kurus: null,
  current_delta_kurus: null,
  provision_delta_kurus: null,
}))

describe('cardLedger — projeksiyon cebiri', () => {
  it('borç = olayların kuruş toplamı ve sıra bağımsız (append-only vaadin özü)', () => {
    fc.assert(
      fc.property(fc.array(fullDeltaEventArb, { maxLength: 40 }), (events) => {
        const projected = projectCardDebtKurus(events)
        expect(projected).toBe(sumKurus(events.map((e) => e.amount_kurus)))
        expect(projectCardDebtKurus([...events].reverse())).toBe(projected)
        expect(projectCardDebt(events)).toBe(toTL(projected))
      }),
    )
  })

  it('summarize: debit − credit = net, iki taraf da negatif olamaz', () => {
    fc.assert(
      fc.property(fc.array(fullDeltaEventArb, { maxLength: 40 }), (events) => {
        const summary = summarizeCardLedger(events)
        expect(summary.count).toBe(events.length)
        expect(summary.totalDebit).toBeGreaterThanOrEqual(0)
        expect(summary.totalCredit).toBeGreaterThanOrEqual(0)
        expect(toKurus(summary.totalDebit) - toKurus(summary.totalCredit)).toBe(toKurus(summary.net))
        expect(summary.net).toBe(projectCardDebt(events))
      }),
    )
  })

  it('tam-fidelity dizide kova projeksiyonu borca TAM toplanır ve complete=true', () => {
    fc.assert(
      fc.property(fc.array(fullDeltaEventArb, { maxLength: 40 }), (events) => {
        const split = projectCardSplit(events)
        expect(split.complete).toBe(true)
        const splitKurus = toKurus(split.statement) + toKurus(split.current) + toKurus(split.provision)
        expect(splitKurus).toBe(projectCardDebtKurus(events))
      }),
    )
  })

  it('tek bir null-delta olay bile complete bayrağını düşürür (fallback sözleşmesi)', () => {
    fc.assert(
      fc.property(
        fc.array(fullDeltaEventArb, { maxLength: 20 }),
        nullDeltaEventArb,
        fc.nat({ max: 20 }),
        (events, nullEvent, position) => {
          const index = Math.min(position, events.length)
          const withNull = [...events.slice(0, index), nullEvent, ...events.slice(index)]
          expect(projectCardSplit(withNull).complete).toBe(false)
        },
      ),
    )
  })
})

describe('clampCardBreakdown — split ≤ debt her zaman (trigger ikizi)', () => {
  it('çıktı kovaları negatif olamaz ve kuruş toplamı borcu aşamaz', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, moneyArb, (debt, statement, current, provision) => {
        const out = clampCardBreakdown(debt, statement, current, provision)
        expect(out.statement).toBeGreaterThanOrEqual(0)
        expect(out.current).toBeGreaterThanOrEqual(0)
        expect(out.provision).toBeGreaterThanOrEqual(0)
        const totalK = toKurus(out.statement) + toKurus(out.current) + toKurus(out.provision)
        expect(totalK).toBeLessThanOrEqual(Math.max(0, toKurus(debt)))
      }),
    )
  })

  it('idempotenttir: clamp(clamp(x)) === clamp(x)', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, moneyArb, (debt, statement, current, provision) => {
        const once = clampCardBreakdown(debt, statement, current, provision)
        const twice = clampCardBreakdown(debt, once.statement, once.current, once.provision)
        expect(twice).toEqual(once)
      }),
    )
  })

  it('zaten geçerli (negatifsiz, sığan) kırılımı DEĞİŞTİRMEZ', () => {
    // Kuruş tabanlı üretim: üç kova + boşluk = borç, yani split kesin sığar.
    const fittingArb = fc
      .record({
        s: fc.nat({ max: 1e8 }),
        c: fc.nat({ max: 1e8 }),
        p: fc.nat({ max: 1e8 }),
        slack: fc.nat({ max: 1e8 }),
      })
      .map(({ s, c, p, slack }) => ({
        statement: toTL(s),
        current: toTL(c),
        provision: toTL(p),
        debt: toTL(s + c + p + slack),
      }))
    fc.assert(
      fc.property(fittingArb, ({ debt, statement, current, provision }) => {
        expect(clampCardBreakdown(debt, statement, current, provision)).toEqual({ statement, provision, current })
      }),
    )
  })

  it('öncelik sırası: statement önce korunur (statement_out = min(statement⁺, debt⁺))', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, moneyArb, (debt, statement, current, provision) => {
        const out = clampCardBreakdown(debt, statement, current, provision)
        const debtK = Math.max(0, toKurus(debt))
        const statementK = Math.max(0, toKurus(statement))
        expect(toKurus(out.statement)).toBe(Math.min(statementK, debtK))
      }),
    )
  })
})

describe('projectLoanSummary — özet = ödenmemiş taksit projeksiyonu (trigger ikizi)', () => {
  const installmentArb = fc.record({
    amount: nonNegMoneyArb,
    status: fc.constantFrom<'bekliyor' | 'ödendi'>('bekliyor', 'ödendi'),
  })

  it('kalan = bekleyenlerin toplamı, sayı = bekleyen adedi, 0 bekleyen = closed', () => {
    fc.assert(
      fc.property(fc.array(installmentArb, { maxLength: 40 }), (installments) => {
        const summary = projectLoanSummary(installments)
        const pending = installments.filter((i) => i.status !== 'ödendi')
        expect(summary.remainingInstallments).toBe(pending.length)
        expect(toKurus(summary.remainingAmount)).toBe(sumKurus(pending.map((i) => toKurus(i.amount))))
        expect(summary.status).toBe(pending.length === 0 ? 'closed' : 'active')
      }),
    )
  })

  it('ödenmiş taksit eklemek özeti DEĞİŞTİRMEZ', () => {
    fc.assert(
      fc.property(fc.array(installmentArb, { maxLength: 30 }), nonNegMoneyArb, (installments, paidAmount) => {
        const base = projectLoanSummary(installments)
        const withPaid = projectLoanSummary([...installments, { amount: paidAmount, status: 'ödendi' }])
        expect(withPaid).toEqual(base)
      }),
    )
  })
})

describe('expectedInstallmentAmount — taksit payı her zaman kuruş-kesin', () => {
  it('çıktı tam kuruş; count ≤ 1 tam tutarı döndürür', () => {
    fc.assert(
      fc.property(nonNegMoneyArb, fc.integer({ min: 0, max: 36 }), (amount, count) => {
        const share = expectedInstallmentAmount(amount, count)
        expect(Number.isInteger(toKurus(share))).toBe(true)
        if (count <= 1) expect(toKurus(share)).toBe(toKurus(amount))
      }),
    )
  })
})
