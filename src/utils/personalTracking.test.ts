import { describe, expect, it } from 'vitest'
import { summarizePersonalTracking } from './personalTracking'

describe('summarizePersonalTracking', () => {
  it('kişileri ayrı toplar; kuruşları ve Türkçe ad sırasını korur', () => {
    expect(summarizePersonalTracking([
      { person_name: 'Zeynep', amount: 2500 },
      { person_name: 'Ali', amount: 0.1 },
      { person_name: 'Ali', amount: 0.2 },
    ])).toEqual([
      { personName: 'Ali', count: 2, total: 0.3 },
      { personName: 'Zeynep', count: 1, total: 2500 },
    ])
  })

  it('boşluk ve Türkçe büyük/küçük harf farkı aynı kişinin toplamını bölmez', () => {
    expect(summarizePersonalTracking([
      { person_name: '  İPEK   IŞIK ', amount: 100.01 },
      { person_name: 'ipek ışık', amount: 200.02 },
    ])).toEqual([{ personName: 'İPEK IŞIK', count: 2, total: 300.03 }])
  })

  it('boş listede kişi veya tutar uydurmaz', () => {
    expect(summarizePersonalTracking([])).toEqual([])
  })
})
