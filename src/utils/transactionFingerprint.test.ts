import { describe, expect, it } from 'vitest'
import { buildTransactionFingerprint, descriptionSimilarity, normalizedTransactionDescription } from './transactionFingerprint'

describe('transaction fingerprint', () => {
  it('normalizes description text deterministically', () => {
    expect(normalizedTransactionDescription('MIGROS Sanal POS / Bursa TR')).toBe('migros sanal pos bursa tr')
  })

  it('uses account, date, amount, normalized description, and type', () => {
    expect(buildTransactionFingerprint({
      accountId: 'card-1',
      date: '2026-06-15',
      amount: 520,
      description: 'Migros Sanal POS',
      type: 'posted',
    })).toBe('card-1|2026-06-15|52000|migros sanal pos|posted')
  })

  it('scores similar merchant descriptions above unrelated text', () => {
    expect(descriptionSimilarity('Migros Sanal POS', 'Migros')).toBeGreaterThan(descriptionSimilarity('Migros', 'Turk Telekom'))
  })
})
