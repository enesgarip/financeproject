import { describe, expect, it } from 'vitest'
import { mapStatementResult } from './statementParseClient'

describe('mapStatementResult', () => {
  it('maps raw edge result to ParsedStatement and assigns categories client-side', () => {
    const result = mapStatementResult({
      statementDate: '2026-06-01',
      dueDate: '2026-06-15',
      totalDebt: 1250.5,
      transactions: [
        { date: '2026-05-20', description: 'MIGROS ATASEHIR', amount: 350.75, installmentNo: 1, installmentCount: 0 },
      ],
    })

    expect(result.statementDate).toBe('2026-06-01')
    expect(result.dueDate).toBe('2026-06-15')
    expect(result.totalDebt).toBe(1250.5)
    expect(result.transactions).toHaveLength(1)
    const tx = result.transactions[0]
    expect(tx.amount).toBe(350.75)
    // Kategori LLM'den değil, suggestExpenseCategory'den gelir (MIGROS → Market).
    expect(tx.category).toBe('Market')
    expect(tx.isInstallment).toBe(false)
  })

  it('flags multi-installment transactions and keeps installment numbers', () => {
    const result = mapStatementResult({
      statementDate: '',
      dueDate: '',
      totalDebt: 0,
      transactions: [
        { date: '2026-05-10', description: 'TEKNOSA', amount: 500, installmentNo: 3, installmentCount: 12 },
      ],
    })
    const tx = result.transactions[0]
    expect(tx.isInstallment).toBe(true)
    expect(tx.installmentNo).toBe(3)
    expect(tx.installmentCount).toBe(12)
  })

  it('drops non-positive / non-finite amounts', () => {
    const result = mapStatementResult({
      statementDate: '',
      dueDate: '',
      totalDebt: 100,
      transactions: [
        { date: '', description: 'iade', amount: -50, installmentNo: 1, installmentCount: 0 },
        { date: '', description: 'boş', amount: Number.NaN, installmentNo: 1, installmentCount: 0 },
        { date: '', description: 'geçerli', amount: 10, installmentNo: 1, installmentCount: 0 },
      ],
    })
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].description).toBe('geçerli')
  })
})
