import { describe, expect, it } from 'vitest'
import { EXACT, estimateConfidence, freshnessConfidence, worstConfidence } from './dataConfidence'

describe('freshnessConfidence', () => {
  it('eşiğin altındaki yaş kesin sayılır', () => {
    expect(freshnessConfidence(3, 7).level).toBe('exact')
    expect(freshnessConfidence(7, 7).level).toBe('exact')
  })

  it('eşiği geçen yaş bayattır ve gün sayısını yazar', () => {
    const confidence = freshnessConfidence(44, 7)
    expect(confidence.level).toBe('stale')
    expect(confidence.label).toBe('44 gün önce')
  })

  it('hiç doğrulanmamış rakam bayat sayılır', () => {
    expect(freshnessConfidence(null, 7).level).toBe('stale')
    expect(freshnessConfidence(null, 7).label).toBe('Doğrulanmadı')
  })
})

describe('worstConfidence', () => {
  it('en kötü sinyali seçer', () => {
    expect(worstConfidence(EXACT, estimateConfidence()).level).toBe('estimate')
    expect(worstConfidence(estimateConfidence(), freshnessConfidence(44, 7)).level).toBe('stale')
    expect(worstConfidence(EXACT, EXACT).level).toBe('exact')
  })

  it('argümansız çağrıda kesin döner', () => {
    expect(worstConfidence().level).toBe('exact')
  })
})
