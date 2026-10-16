import { describe, expect, it } from 'vitest'
import type { TransactionHistory } from '../types/database'
import { matchedPaymentsInMonth, paidPaymentIdsInMonth } from './paymentHistory'

function history(overrides: Partial<TransactionHistory> = {}): TransactionHistory {
  return {
    id: 'history-1',
    user_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    occurred_at: '2026-07-10T12:00:00Z',
    type: 'payment',
    title: 'Fatura ödendi',
    amount: 500,
    source_table: 'payments',
    source_id: 'payment-1',
    source_event_id: null,
    note: null,
    ...overrides,
  }
}

describe('paidPaymentIdsInMonth', () => {
  it('counts only actual payment history rows in the selected month', () => {
    const result = paidPaymentIdsInMonth([
      history(),
      history({ id: 'old', source_id: 'payment-2', occurred_at: '2026-06-30T12:00:00Z' }),
      history({ id: 'statement', source_table: 'card_statement_archives', source_id: 'statement-1' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })

  it('ay sınırını aşan geri almayı görür (31 Temmuz ödendi → 1 Ağustos geri alındı)', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-31T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-01T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual([])
  })

  it('geri alma penceresi kapandıktan sonra ayın sonucunu değiştirmez', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-31T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-25T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })

  it('sonraki ayda yeniden ödenip geri alınan tekrarlı ödeme bu ayı etkilemez', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-05T09:00:00Z' }),
      history({ id: 'august', occurred_at: '2026-08-05T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-06T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })
})

describe('matchedPaymentsInMonth', () => {
  const month = new Date(2026, 9, 1)
  const matched = (overrides: Partial<TransactionHistory> = {}) => history({
    id: 'match', matched_card_expense_id: 'expense', payment_due_date: '2026-10-31',
    occurred_at: '2026-11-02T09:00:00Z', title: 'Abonelik banka kaydıyla eşlendi', ...overrides,
  })

  it('geç banka işlemini vade ayına bağlar; gerçekleşen tarih ve tutarı korur', () => {
    const input = [matched()]
    expect(matchedPaymentsInMonth(input, month).get('payment-1')).toMatchObject({
      historyId: 'match', occurredOn: '2026-11-02', amount: 500, state: 'matched',
    })
    expect(matchedPaymentsInMonth(input, new Date(2026, 10, 1)).size).toBe(0)
    expect(input[0]?.title).toBe('Abonelik banka kaydıyla eşlendi')
  })

  it('aynı tutarlı manuel ödeme, başka plan veya kart ekstresi eşleşme kanıtı değildir', () => {
    const result = matchedPaymentsInMonth([
      history({ occurred_at: '2026-10-02T09:00:00Z', amount: 500 }),
      matched({ source_table: 'card_statement_archives' }),
      matched({ id: 'other', source_id: 'other-plan' }),
    ], month)
    expect(result.has('payment-1')).toBe(false)
    expect(result.has('other-plan')).toBe(true)
  })

  it('eski SMS RPC tarihçesinin açık Vade sözleşmesini okur', () => {
    const result = matchedPaymentsInMonth([history({
      occurred_at: '2026-11-02T09:00:00Z', title: 'Netflix SMS ile eşlendi',
      note: 'World kredi kartındaki banka SMS hareketiyle eşlendi. Vade: 2026-10-31',
    })], month)
    expect(result.get('payment-1')?.state).toBe('matched')
  })

  it.each([
    { title: 'Netflix SMS ile eşlendi', note: null },
    { title: 'Netflix ödendi', note: 'World kredi kartındaki banka SMS hareketiyle eşlendi. Vade: 2026-10-31' },
  ])('serbest SMS sözü veya vade tek başına kanıt sayılmaz: %j', (fields) => {
    expect(matchedPaymentsInMonth([history({ ...fields, occurred_at: '2026-10-02T09:00:00Z' })], month).size).toBe(0)
  })

  it.each(['2026-10-99', '2026-10-00', 'geçersiz', null])('kanıtın vadesi geçersiz/eksikse ay uydurmaz: %s', (dueDate) => {
    expect(matchedPaymentsInMonth([matched({ payment_due_date: dueDate })], month).size).toBe(0)
  })

  it('bağlı banka harcaması iptalse eşleşti göstermez', () => {
    expect(matchedPaymentsInMonth([matched()], month, [{ id: 'expense', status: 'cancelled' }]).get('payment-1')?.state).toBe('reversed')
  })

  it('geri alma sırasını dizi sırasından bağımsız uygular', () => {
    const result = matchedPaymentsInMonth([
      history({ id: 'undo', occurred_at: '2026-11-03T09:00:00Z', title: 'Ödeme geri alındı' }),
      matched(),
    ], month)
    expect(result.get('payment-1')?.state).toBe('reversed')
  })

  it('sonraki ayın manuel ödemesi geri alınınca önceki ay eşleşmesini bozmaz', () => {
    const result = matchedPaymentsInMonth([
      matched(),
      history({ id: 'next', occurred_at: '2026-11-10T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-11-11T09:00:00Z', title: 'Ödeme geri alındı' }),
    ], month)
    expect(result.get('payment-1')?.state).toBe('matched')
  })

  it('aynı işlem retry listesinde yinelense de bir durum üretir', () => {
    expect(matchedPaymentsInMonth([matched(), matched()], month).size).toBe(1)
  })
})
