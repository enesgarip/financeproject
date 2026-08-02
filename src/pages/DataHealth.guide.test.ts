import { describe, expect, it } from 'vitest'
import type { HealthIssue } from './DataHealth.logic'
import { navigationAction } from './DataHealth.guide'

function issue(
  id: string,
  area: HealthIssue['area'],
  kind: HealthIssue['kind'] = 'manual',
): HealthIssue {
  return {
    id,
    area,
    kind,
    severity: 'warning',
    title: 'Test bulgusu',
    description: 'Test açıklaması',
    details: [],
    fixable: false,
  }
}

describe('navigationAction', () => {
  it.each([
    ['asset-gold-amount-1', 'Varlıklar', '/varliklar/altin'],
    ['asset-zero-value-1', 'Varlıklar', '/varliklar'],
    ['asset-shape-1', 'Varlıklar', '/varliklar'],
    ['budget-month-1', 'Bütçeler', '/odemeler/hedefler'],
    ['budget-zero-1', 'Bütçeler', '/odemeler/hedefler'],
    ['budget-duplicate-1', 'Bütçeler', '/odemeler/hedefler'],
    ['card-type-fields-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-split-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-scheduled-debt-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-scheduled-debt-overlap-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-overflow-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-unclassified-debt-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-missing-days-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-limit-missing-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-limit-over-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-orphan-statement-debt-1', 'Kartlar', '/kartlar?section=ekstreler'],
    ['card-archive-status-1', 'Kartlar', '/kartlar?section=ekstreler'],
    ['card-overdue-statement-1', 'Kartlar', '/kartlar?section=ekstreler'],
    ['card-archive-date-order-1', 'Kartlar', '/kartlar?section=ekstreler'],
    ['card-expense-duplicate-exact-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-duplicate-possible-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-missing-description', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-missing-category', 'Kartlar', '/kartlar?section=islemler'],
    ['card-ledger-drift-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-split-drift-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['account-ledger-drift-1', 'Kartlar', '/kartlar?section=kartlar'],
    ['card-scheduled-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-bank-card-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-zero-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-single-has-installments-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-amount-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-bank-card-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-posted-at-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-clear-posted-at-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-count-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-date-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-installment-zero-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-missing-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-extra-1', 'Kartlar', '/kartlar?section=islemler'],
    ['card-expense-plan-total-1', 'Kartlar', '/kartlar?section=islemler'],
    ['loan-totals-1', 'Krediler', '/borclar/krediler'],
    ['loan-no-plan-1', 'Krediler', '/borclar/krediler'],
    ['loan-zero-payment-1', 'Krediler', '/borclar/krediler'],
    ['loan-date-order-1', 'Krediler', '/borclar/krediler'],
    ['loan-remaining-over-total-1', 'Krediler', '/borclar/krediler'],
    ['loan-installment-gap-1', 'Krediler', '/borclar/krediler'],
    ['loan-installment-zero-1', 'Krediler', '/borclar/krediler'],
    ['loan-installment-due-day-1', 'Krediler', '/borclar/krediler'],
    ['loan-paid-at-missing', 'Krediler', '/borclar/krediler'],
    ['loan-pending-paid-at', 'Krediler', '/borclar/krediler'],
    ['debt-fx-currency-1', 'Kişiler', '/borclar/kisiler'],
    ['debt-shape-1', 'Kişiler', '/borclar/kisiler'],
    ['debt-zero-1', 'Kişiler', '/borclar/kisiler'],
    ['debt-gold-amount-1', 'Kişiler', '/borclar/kisiler'],
    ['debt-overdue-1', 'Kişiler', '/borclar/kisiler'],
    ['salary-zero-1', 'Maaş', '/varliklar/maas'],
    ['salary-duplicate-1', 'Maaş', '/varliklar/maas'],
    ['goal-composite-empty-1', 'Hedefler', '/odemeler/hedefler'],
    ['goal-composite-zero-target-1', 'Hedefler', '/odemeler/hedefler'],
    ['goal-complete-active-1', 'Hedefler', '/odemeler/hedefler'],
    ['goal-completed-under-target-1', 'Hedefler', '/odemeler/hedefler'],
    ['goal-overdue-1', 'Hedefler', '/odemeler/hedefler'],
    ['goal-zero-target-1', 'Hedefler', '/odemeler/hedefler'],
    ['payment-overdue-1', 'Planlı', '/odemeler'],
    ['payment-zero-1', 'Planlı', '/odemeler'],
    ['payment-recurrence-fields-1', 'Planlı', '/odemeler'],
    ['payment-no-day-1', 'Planlı', '/odemeler'],
    ['payment-due-day-1', 'Planlı', '/odemeler'],
    ['payment-ended-1', 'Planlı', '/odemeler'],
  ] satisfies Array<[string, HealthIssue['area'], string]>)('routes %s to its owning screen', (id, area, to) => {
    expect(navigationAction(issue(id, area)).to).toBe(to)
  })

  it.each([
    ['cardOverduePayment', 'Ekstreleri aç'],
    ['duplicateTransactionCandidate', 'Kayıtları karşılaştır'],
    ['cardExpenseDataQuality', 'Harcamaları düzenle'],
    ['cardScheduledDebt', 'Borç ve taksitleri karşılaştır'],
    ['cardMissingInstallments', 'Taksit planını incele'],
    ['accountLedgerDrift', 'Hesap hareketlerini incele'],
    ['cardLedgerDrift', 'Borç hareketlerini incele'],
    ['loanInstallmentDueDay', 'Taksit planını aç'],
  ] satisfies Array<[HealthIssue['kind'], string]>)('uses a meaningful action for %s', (kind, label) => {
    expect(navigationAction(issue(`new-${kind}`, kind.startsWith('loan') ? 'Krediler' : 'Kartlar', kind)).label).toBe(label)
  })

  it('uses explicit overdue actions', () => {
    expect(navigationAction(issue('payment-overdue-1', 'Planlı')).label).toBe('Ödendi işaretle')
    expect(navigationAction(issue('debt-overdue-1', 'Kişiler')).label).toBe('Ödeme durumunu güncelle')
  })

  it.each([
    ['Varlıklar', '/varliklar'],
    ['Bütçeler', '/odemeler/hedefler'],
    ['Kartlar', '/kartlar?section=kartlar'],
    ['Krediler', '/borclar/krediler'],
    ['Kişiler', '/borclar/kisiler'],
    ['Planlı', '/odemeler'],
    ['Maaş', '/varliklar/maas'],
    ['Hedefler', '/odemeler/hedefler'],
  ] satisfies Array<[HealthIssue['area'], string]>)('never leaves an unknown %s finding without an action', (area, to) => {
    expect(navigationAction(issue(`unknown-${area}`, area))).toMatchObject({ to })
  })
})
