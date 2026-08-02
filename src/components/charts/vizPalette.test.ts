import { describe, expect, it } from 'vitest'
import { buildVizColorMap, orderSlicesCanonically, VIZ_NEUTRAL, VIZ_SERIES, vizColor } from './vizPalette'

describe('buildVizColorMap', () => {
  it('slotları kanonik sırayla dağıtır', () => {
    const map = buildVizColorMap(['Market', 'Yemek', 'Ulaşım'])
    expect(map.Market).toBe(VIZ_SERIES[0])
    expect(map.Yemek).toBe(VIZ_SERIES[1])
    expect(map['Ulaşım']).toBe(VIZ_SERIES[2])
  })

  it('renk varlığa bağlıdır: veri sıralaması değişse de aynı kalır', () => {
    const canonical = ['Market', 'Yemek', 'Ulaşım']
    const map = buildVizColorMap(canonical)
    // Ay içinde harcama sıralaması tersine dönse bile kategori rengi sabit.
    const reordered = ['Ulaşım', 'Market', 'Yemek']
    for (const key of reordered) expect(vizColor(map, key)).toBe(map[key])
    expect(map['Ulaşım']).toBe(VIZ_SERIES[2])
  })

  it('nötr anahtarlar slot harcamaz', () => {
    const map = buildVizColorMap(['Market', 'Diğer', 'Yemek'], ['Diğer'])
    expect(map['Diğer']).toBe(VIZ_NEUTRAL)
    // "Diğer" araya girse de Yemek ikinci slotu alır.
    expect(map.Yemek).toBe(VIZ_SERIES[1])
  })

  it('slotlar bitince döngüye girmez, nötre düşer', () => {
    // Palet uzunluğuna bağlı kalmadan: son slot dolar, sonrası nötre düşer.
    const n = VIZ_SERIES.length
    const keys = Array.from({ length: n + 2 }, (_, i) => `k${i}`)
    const map = buildVizColorMap(keys)
    expect(map[`k${n - 1}`]).toBe(VIZ_SERIES[n - 1])
    expect(map[`k${n}`]).toBe(VIZ_NEUTRAL)
    expect(map[`k${n + 1}`]).toBe(VIZ_NEUTRAL)
    // Slot bitiminden sonraki anahtar birinciyle aynı renge boyanmamalı.
    expect(map[`k${n}`]).not.toBe(map.k0)
  })

  it('hiçbir kimlik slotu durum rengi kullanmaz', () => {
    const statusTokens = ['var(--success)', 'var(--warning)', 'var(--destructive)', 'var(--info)']
    for (const slot of VIZ_SERIES) expect(statusTokens).not.toContain(slot)
  })

  it('bilinmeyen anahtar nötre düşer', () => {
    const map = buildVizColorMap(['Market'])
    expect(vizColor(map, 'Bilinmeyen')).toBe(VIZ_NEUTRAL)
  })
})

describe('orderSlicesCanonically', () => {
  const canonical = ['Nakit', 'Banka', 'Altın', 'Fon', 'Hisse']

  it('tutara göre gelen dilimleri kanonik sıraya çevirir', () => {
    // Halkada komşuluk = slot komşuluğu olmalı; tutar sırası bunu bozuyordu.
    const byValue = [
      { name: 'Hisse', value: 900 },
      { name: 'Nakit', value: 500 },
      { name: 'Altın', value: 100 },
    ]
    expect(orderSlicesCanonically(byValue, canonical).map((s) => s.name)).toEqual([
      'Nakit', 'Altın', 'Hisse',
    ])
  })

  it('kanonik listede olmayan dilimleri sona alır', () => {
    const slices = [{ name: 'Bilinmeyen', value: 1 }, { name: 'Banka', value: 2 }]
    expect(orderSlicesCanonically(slices, canonical).map((s) => s.name)).toEqual([
      'Banka', 'Bilinmeyen',
    ])
  })

  it('girdi dizisini değiştirmez', () => {
    const slices = [{ name: 'Hisse', value: 2 }, { name: 'Nakit', value: 1 }]
    orderSlicesCanonically(slices, canonical)
    expect(slices.map((s) => s.name)).toEqual(['Hisse', 'Nakit'])
  })
})
