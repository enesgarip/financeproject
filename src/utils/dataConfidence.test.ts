import { describe, expect, it } from 'vitest'
import { EXACT, estimateConfidence, freshnessConfidence, valuationConfidence, worstConfidence } from './dataConfidence'

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

// Faz D3: otomatik değerlemede canlı kur gelmediğinde saklı değere düşülüyor.
// Bu sessiz kaldığı sürece bayat rakam canlı sanılıyordu.
describe('valuationConfidence', () => {
  const NOW = new Date('2026-08-11T12:00:00Z')

  it('canlı ve elle girilen değerde rozet göstermez', () => {
    expect(valuationConfidence('live', '2026-08-01T00:00:00Z', NOW)).toEqual(EXACT)
    expect(valuationConfidence('manual', null, NOW)).toEqual(EXACT)
  })

  it('saklı değere düşüldüğünde kaç gün öncesine ait olduğunu yazar', () => {
    const confidence = valuationConfidence('stored', '2026-08-08T12:00:00Z', NOW)
    expect(confidence.level).toBe('stale')
    expect(confidence.label).toBe('3 gün önceki kur')
    expect(confidence.reason).toContain('3 gün önceki kurla')
  })

  it('aynı gün hesaplanmışsa gün sayısı yerine sadece kur yokluğunu söyler', () => {
    const confidence = valuationConfidence('stored', '2026-08-11T09:00:00Z', NOW)
    expect(confidence.level).toBe('stale')
    expect(confidence.label).toBe('Kur yok')
  })

  it('değerleme zamanı bilinmiyorsa bunu gizlemez', () => {
    const confidence = valuationConfidence('stored', null, NOW)
    expect(confidence.level).toBe('stale')
    expect(confidence.label).toBe('Kur yok')
    expect(confidence.reason).toContain('bilinmiyor')
  })

  it('en kötü sinyal kazanma kuralına katılır', () => {
    const stale = valuationConfidence('stored', null, NOW)
    expect(worstConfidence(EXACT, estimateConfidence(), stale).level).toBe('stale')
  })
})
