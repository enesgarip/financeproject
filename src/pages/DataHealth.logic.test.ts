import { describe, expect, it } from 'vitest'
import type { Asset } from '../types/database'
import { buildIssues, emptyData } from './DataHealth.logic'

const base = {
  id: 'asset-1',
  user_id: 'user-1',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...base,
    name: 'Varlık',
    category: 'Nakit',
    amount: 1,
    unit: 'TRY',
    currency: 'TRY',
    symbol: null,
    unit_cost: null,
    estimated_value_try: 1000,
    auto_valued: false,
    source: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues asset health checks', () => {
  it('does not normalize stock share quantity as a stale technical asset amount', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-1',
          name: 'THYAO',
          category: 'Hisse',
          amount: 42,
          unit: 'TRY',
          currency: null,
          symbol: 'THYAO',
          unit_cost: 250,
          auto_valued: true,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-1')).toBeUndefined()
  })

  it('still normalizes non-stock non-gold technical amount fields', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'fund-1',
          name: 'Fon',
          category: 'Fon',
          amount: 42,
          unit: 'adet',
          currency: null,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-fund-1')?.payload?.updates).toEqual({
      amount: 1,
      unit: 'TRY',
    })
  })

  it('fixes only the technical unit for stocks and keeps the share count intact', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-unit-1',
          name: 'GARAN',
          category: 'Hisse',
          amount: 35,
          unit: 'adet',
          currency: null,
          symbol: 'GARAN',
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-unit-1')?.payload?.updates).toEqual({
      unit: 'TRY',
    })
  })
})
