// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Asset, AssetValueEvent } from '../../types/database'
import { AssetValueHistoryPanel } from './AssetValueHistoryPanel'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../data/repositories/assetValueEventsRepo', () => ({ fetchAssetValueEvents: mocks.fetch }))
vi.mock('../../services/assetValueHistory', () => ({ updateAssetValue: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const asset = { id: 'a1', name: 'BES', estimated_value_try: 100, updated_at: '2026-10-24T09:00:00Z' } as Asset
const event = (growth: number) => ({
  id: 'e1', occurred_at: '2026-10-24T09:00:00Z', value_before_kurus: 10000,
  value_after_kurus: 10000 + growth, contribution_kurus: 0,
}) as AssetValueEvent

it('yeni değer yüklenirken eski getiriyi sunmaz; geciken eski sorgu güncel geçmişi ezmez', async () => {
  let resolveOld!: (value: unknown) => void
  const old = new Promise((resolve) => { resolveOld = resolve })
  mocks.fetch.mockReturnValueOnce(old).mockResolvedValueOnce({ ok: true, data: [event(2500)] })
  const view = render(<AssetValueHistoryPanel asset={asset} />)
  view.rerender(<AssetValueHistoryPanel asset={{ ...asset, updated_at: '2026-10-24T10:00:00Z', estimated_value_try: 125 }} />)
  await screen.findByText(/25,00/)
  await act(async () => resolveOld({ ok: true, data: [event(1000)] }))
  expect(screen.queryByText(/10,00/)).toBeNull()
  expect(screen.getByText(/25,00/)).toBeTruthy()
})

it('yenileme hatası eski getiri özetiyle birlikte gösterilmez', async () => {
  mocks.fetch.mockResolvedValueOnce({ ok: true, data: [event(1000)] })
    .mockResolvedValueOnce({ ok: false, error: { message: 'Geçmiş okunamadı.' } })
  const view = render(<AssetValueHistoryPanel asset={asset} />)
  await screen.findByText(/10,00/)
  view.rerender(<AssetValueHistoryPanel asset={{ ...asset, estimated_value_try: 125 }} />)
  expect(screen.queryByText(/10,00/)).toBeNull()
  await screen.findByText('Geçmiş okunamadı.')
  expect(screen.queryByText(/Getiri/)).toBeNull()
})
