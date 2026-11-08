import { describe, expect, it } from 'vitest'
import { parseNativeNumber, parseNumber, parseNumberStrict } from './formatCurrency'
import { savingsGoalTargetReached } from './savingsGoal'
import { buildSavingsSuggestion } from './savingsSuggestion'

describe('denetim: giriş ve birim sözleşmeleri', () => {
  it('native ondalığı binlik saymadan okur; Türkçe para sözleşmesini korur', () => {
    expect(parseNativeNumber('1.234')).toBe(1.234)
    expect(parseNativeNumber('1.2345')).toBe(1.2345)
    expect(parseNativeNumber('')).toBeNaN()
    expect(parseNativeNumber('1,234')).toBeNaN()
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1.234')).toBe(1234)
  })
  it.each(['abc', '1,2,3', '1..2', 'Infinity', '1e999', ''])('geçersiz girdiyi sıfır yapmaz: %s', value => {
    expect(parseNumberStrict(value)).toBeNaN()
  })
  it('sıfır ve geçerli yerel para biçimlerini kabul eder', () => {
    expect(parseNumberStrict('0')).toBe(0)
    expect(parseNumberStrict('-1.234,56')).toBe(-1234.56)
    expect(parseNumberStrict('1234.56')).toBe(1234.56)
    expect(parseNumberStrict('5k')).toBe(5000)
  })
  it('gram hedefini erken tamamlamaz; TL legacy toleransını korur', () => {
    expect(savingsGoalTargetReached({ value_type: 'gram_altin', target_amount: 1.23, current_amount: 1.22 })).toBe(false)
    expect(savingsGoalTargetReached({ value_type: 'gram_altin', target_amount: 1.23, current_amount: 1.23 })).toBe(true)
    expect(savingsGoalTargetReached({ value_type: 'TRY', target_amount: 100, current_amount: 99.99 })).toBe(true)
    const suggestion = buildSavingsSuggestion({ value_type: 'gram_altin', target_amount: 1.23, current_amount: 1.22, target_date: null })
    expect(suggestion.pace).toBe('no-date')
    expect(suggestion.remaining).toBeCloseTo(0.01)
  })
})
