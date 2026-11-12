// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { UsageEvent } from '../utils/usageStatistics'
import { useUsageFlow } from './useUsageFlow'

const write = vi.hoisted(() => vi.fn<(userId: string | undefined, event: UsageEvent) => void>())
vi.mock('../lib/usageTelemetry', () => ({ recordUsage: write }))

afterEach(() => { vi.unstubAllEnvs(); write.mockClear() })

it('formu bir kez açar, denemeleri aynı akışa bağlar ve başarılı formu kapanmış saymaz', async () => {
  vi.stubEnv('PROD', true)
  const { result, unmount } = renderHook(() => useUsageFlow('user', 'transfer', 'quick-actions'), { wrapper: StrictMode })
  await act(async () => {})
  expect(write.mock.calls).toHaveLength(1)
  const opened = write.mock.calls[0][1]
  expect(opened).toMatchObject({ kind: 'opened', subject: 'transfer', source: 'quick-actions', flowId: expect.any(String) })
  const flowId = 'flowId' in opened ? opened.flowId : undefined
  act(() => result.current.attempt()('failed'))
  act(() => result.current.attempt()('completed'))
  unmount()
  await act(async () => {})
  expect(write.mock.calls.slice(1)).toEqual(['attempted', 'failed', 'attempted', 'completed']
    .map(kind => ['user', { kind, subject: 'transfer', flowId }]))
})

it('görünür form kapanınca kendi kimliğini yazar ve yeni açılışa yeni kimlik verir', async () => {
  vi.stubEnv('PROD', true)
  const { rerender, unmount } = renderHook(
    ({ visible }) => useUsageFlow('user', 'expense', 'bottom-nav', visible),
    { initialProps: { visible: true }, wrapper: StrictMode },
  )
  await act(async () => {})
  const [first] = write.mock.calls
  const firstFlow = 'flowId' in first[1] ? first[1].flowId : undefined
  rerender({ visible: false })
  await act(async () => {})
  expect(write).toHaveBeenLastCalledWith('user', { kind: 'closed', subject: 'expense', flowId: firstFlow })
  rerender({ visible: true })
  expect(write).toHaveBeenLastCalledWith('user', expect.objectContaining({ kind: 'opened' }))
  expect(write.mock.lastCall?.[1]).not.toHaveProperty('flowId', firstFlow)
  unmount()
  await act(async () => {})
})
