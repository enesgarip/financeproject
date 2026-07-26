import { describe, expect, it } from 'vitest'
import type { CardExpense } from '../types/database'
import { buildAutomationCoverage, classifyExpenseSource } from './automationCoverage'

type Row = Pick<CardExpense, 'source' | 'note' | 'amount' | 'status'>

function row(overrides: Partial<Row> = {}): Row {
  return { source: null, note: null, amount: 100, status: 'posted', ...overrides }
}

describe('classifyExpenseSource', () => {
  it('kolon doluysa onu kullanır', () => {
    expect(classifyExpenseSource(row({ source: 'sms' }))).toBe('sms')
  })

  it('kolon boşsa note metninden türetir', () => {
    expect(classifyExpenseSource(row({ note: 'Odeme kaydindan olusturuldu. Vade: 2026-07-01' }))).toBe('payment_auto')
    expect(classifyExpenseSource(row({ note: '2/3 taksit odenmis; kalan 1 taksit eklendi.' }))).toBe('carryover')
  })

  it('ipucu yoksa bilinmiyor der', () => {
    expect(classifyExpenseSource(row())).toBe('unknown')
    expect(classifyExpenseSource(row({ note: 'rastgele not' }))).toBe('unknown')
  })
})

describe('buildAutomationCoverage', () => {
  it('otomasyon oranını yalnız kaynağı bilinen kayıtlar üzerinden hesaplar', () => {
    const coverage = buildAutomationCoverage([
      row({ source: 'sms' }),
      row({ source: 'statement_import' }),
      row({ source: 'manual' }),
      row(), // eski kayıt — orana girmemeli
      row(),
    ])

    expect(coverage.totalCount).toBe(5)
    expect(coverage.classifiedCount).toBe(3)
    expect(coverage.manualCount).toBe(1)
    expect(coverage.automationRate).toBe(67)
  })

  it('iptal edilen harcamaları saymaz', () => {
    const coverage = buildAutomationCoverage([
      row({ source: 'manual' }),
      row({ source: 'sms', status: 'cancelled' }),
    ])
    expect(coverage.totalCount).toBe(1)
    expect(coverage.automationRate).toBe(0)
  })

  it('kaynak dağılımını sayıya göre sıralar ve tutarı toplar', () => {
    const coverage = buildAutomationCoverage([
      row({ source: 'manual', amount: 10 }),
      row({ source: 'manual', amount: 20 }),
      row({ source: 'sms', amount: 5 }),
    ])
    expect(coverage.rows[0]!.bucket).toBe('manual')
    expect(coverage.rows[0]!.count).toBe(2)
    expect(coverage.rows[0]!.amount).toBe(30)
    expect(coverage.rows[0]!.countShare).toBe(67)
  })

  it('kayıt yoksa oran null döner (sıfıra bölme yok)', () => {
    const coverage = buildAutomationCoverage([])
    expect(coverage.automationRate).toBeNull()
    expect(coverage.totalCount).toBe(0)
  })
})
