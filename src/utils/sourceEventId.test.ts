import { describe, expect, it } from 'vitest'
import { importedRowEventIds, sha256Hex } from './sourceEventId'

describe('sourceEventId', () => {
  it('aynı artefakt için kararlı hash üretir', async () => {
    expect(await sha256Hex('aynı belge')).toBe(await sha256Hex('aynı belge'))
    expect(await sha256Hex('aynı belge')).not.toBe(await sha256Hex('farklı belge'))
  })

  it('aynı belgedeki birebir eş satırları occurrence ile ayrı tutar', async () => {
    const ids = await importedRowEventIds('hash', ['A', 'B', 'A'])
    expect(ids[0]).not.toBe(ids[2])
    expect(ids[0]).toMatch(/:0$/)
    expect(ids[2]).toMatch(/:1$/)
  })

  it('farklı satırların genel sırası değişse de içerik kimliğini korur', async () => {
    const first = await importedRowEventIds('hash', ['A', 'B'])
    const reordered = await importedRowEventIds('hash', ['B', 'A'])
    expect(first[0]).toBe(reordered[1])
    expect(first[1]).toBe(reordered[0])
  })
})
