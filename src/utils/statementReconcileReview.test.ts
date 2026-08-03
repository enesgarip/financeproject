import { describe, expect, it } from 'vitest'
import {
  findAppOnlyExpenses,
  isFullyReconciled,
  lockCorrectionNote,
  reconcileResidualTL,
  type ReconcileExpenseRow,
} from './statementReconcileReview'

function expense(overrides: Partial<ReconcileExpenseRow> & { id: string }): ReconcileExpenseRow {
  return {
    spent_at: '2026-07-10',
    amount: 100,
    status: 'posted',
    installment_count: 1,
    ...overrides,
  }
}

describe('findAppOnlyExpenses', () => {
  it('eşleşmeyen tek-çekim posted harcamaları döndürür', () => {
    const rows = [
      expense({ id: 'a', spent_at: '2026-07-05' }),
      expense({ id: 'b', spent_at: '2026-07-02' }),
    ]
    const result = findAppOnlyExpenses(rows, new Set(['a']))
    expect(result.map((r) => r.id)).toEqual(['b'])
  })

  it('tarihe göre artan sıralar', () => {
    const rows = [
      expense({ id: 'geç', spent_at: '2026-07-20' }),
      expense({ id: 'erken', spent_at: '2026-07-01' }),
    ]
    expect(findAppOnlyExpenses(rows, new Set()).map((r) => r.id)).toEqual(['erken', 'geç'])
  })

  it('taksitleri (installment_count > 1) hariç tutar', () => {
    const rows = [expense({ id: 'taksit', installment_count: 3 })]
    expect(findAppOnlyExpenses(rows, new Set())).toEqual([])
  })

  it('provizyon ve iptal statülerini eler', () => {
    const rows = [
      expense({ id: 'prov', status: 'provision' }),
      expense({ id: 'iptal', status: 'cancelled' }),
      expense({ id: 'ok', status: 'posted' }),
    ]
    expect(findAppOnlyExpenses(rows, new Set()).map((r) => r.id)).toEqual(['ok'])
  })

  it('girdi dizisini mutasyona uğratmaz', () => {
    const rows = [
      expense({ id: 'b', spent_at: '2026-07-20' }),
      expense({ id: 'a', spent_at: '2026-07-01' }),
    ]
    const snapshot = rows.map((r) => r.id)
    findAppOnlyExpenses(rows, new Set())
    expect(rows.map((r) => r.id)).toEqual(snapshot)
  })
})

describe('reconcileResidualTL', () => {
  it('app eksikse pozitif (bankaya çekmek borcu artırır)', () => {
    expect(reconcileResidualTL(1000, 900)).toBe(100)
  })

  it('app fazlaysa negatif (bankaya çekmek borcu azaltır)', () => {
    expect(reconcileResidualTL(900, 1000)).toBe(-100)
  })

  it('kuruş hassasiyetini korur (float toleransı yok)', () => {
    expect(reconcileResidualTL(0.3, 0.1)).toBe(0.2)
  })
})

describe('isFullyReconciled', () => {
  it('kuruşu kuruşuna eşitse true', () => {
    expect(isFullyReconciled(1234.56, 1234.56)).toBe(true)
  })
  it('bir kuruş farkta bile false', () => {
    expect(isFullyReconciled(1234.56, 1234.57)).toBe(false)
  })
})

describe('lockCorrectionNote', () => {
  it('pozitif farkı işaretiyle ve dönemle yazar', () => {
    expect(lockCorrectionNote(150.5, '1 Tem - 31 Tem')).toContain('+150.5 TL')
    expect(lockCorrectionNote(150.5, '1 Tem - 31 Tem')).toContain('dönem 1 Tem - 31 Tem')
  })
  it('negatif farkta eksi işareti korunur', () => {
    expect(lockCorrectionNote(-75, '')).toContain('-75 TL')
  })
})
