import { describe, expect, it } from 'vitest'
import { buildSafeToSpend } from './safeToSpend'

describe('buildSafeToSpend', () => {
  it('likit + kalan gelir − kalan yükümlülük − tampon', () => {
    const result = buildSafeToSpend({
      liquidCash: 46285.68,
      expectedIncome: 0,
      remainingOutflow: 10000,
      buffer: 5000,
    })
    expect(result.amount).toBe(31285.68)
    expect(result.beforeBuffer).toBe(36285.68)
    expect(result.isNegative).toBe(false)
  })

  it('maaş henüz yatmadıysa beklenen geliri ekler', () => {
    const result = buildSafeToSpend({
      liquidCash: 10000,
      expectedIncome: 128000,
      remainingOutflow: 100000,
      buffer: 5000,
    })
    expect(result.amount).toBe(33000)
  })

  it('planlanan çıkış eldekini aşarsa negatif ve uyarı verir', () => {
    const result = buildSafeToSpend({
      liquidCash: 5000,
      expectedIncome: 0,
      remainingOutflow: 20000,
      buffer: 5000,
    })
    expect(result.isNegative).toBe(true)
    expect(result.amount).toBe(-20000)
    expect(result.negativeCause).toBe('obligations')
  })

  it('yükümlülük yokken tampondan kaynaklanan negatiflik alarm değildir', () => {
    // Boş/yeni hesap: hiç yükümlülük yok, sadece tampon sıfırdan düşülüyor.
    const result = buildSafeToSpend({ liquidCash: 0, expectedIncome: 0, remainingOutflow: 0, buffer: 5000 })
    expect(result.amount).toBe(-5000)
    expect(result.negativeCause).toBe('buffer')
  })

  it('baskı oranını kalan yükümlülük / kullanılabilir para olarak verir', () => {
    expect(buildSafeToSpend({ liquidCash: 100000, expectedIncome: 0, remainingOutflow: 25000, buffer: 0 }).pressurePct).toBe(25)
    expect(buildSafeToSpend({ liquidCash: 0, expectedIncome: 0, remainingOutflow: 100, buffer: 0 }).pressurePct).toBe(100)
    expect(buildSafeToSpend({ liquidCash: 0, expectedIncome: 0, remainingOutflow: 0, buffer: 0 }).pressurePct).toBe(0)
  })

  it('negatif girdileri sıfıra kırpar (bozuk veri hesabı patlatmasın)', () => {
    const result = buildSafeToSpend({
      liquidCash: -500,
      expectedIncome: -100,
      remainingOutflow: -50,
      buffer: -10,
    })
    expect(result.amount).toBe(0)
  })

  it('kuruş hassasiyetini korur (float kırıntısı yok)', () => {
    const result = buildSafeToSpend({
      liquidCash: 0.1,
      expectedIncome: 0.2,
      remainingOutflow: 0,
      buffer: 0,
    })
    expect(result.amount).toBe(0.3)
  })
})
