import { describe, expect, it } from 'vitest'
import { normalizeSearchText } from './searchText'

describe('normalizeSearchText', () => {
  it('keeps ALL-CAPS Turkish merchant names searchable with dotted-i queries', () => {
    expect(normalizeSearchText('MIGROS SANAL MARKET')).toBe('migros sanal market')
    expect(normalizeSearchText('BIM MARKET')).toBe('bim market')
    expect(normalizeSearchText('İŞ BANKASI')).toBe('iş bankasi')
  })

  it('normalizes whitespace and empty values for list search', () => {
    expect(normalizeSearchText('  Kira   Aidat  ')).toBe('kira aidat')
    expect(normalizeSearchText(null)).toBe('')
  })
})
