import { useCallback, useSyncExternalStore } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { financeSnapshotKey } from '../app/financeSnapshotKey'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/** Bellekteki son okumanın zamanı; kalıcı offline finans cache'i iddiası yok. */
export function FinanceDataStatus() {
  const { user } = useAuth()
  const online = useOnlineStatus()
  const client = useQueryClient()
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client])
  const read = useCallback(() => client.getQueryState(financeSnapshotKey(user?.id))?.dataUpdatedAt ?? 0, [client, user?.id])
  const updated = useSyncExternalStore(subscribe, read, () => 0)
  const fetching = useIsFetching({ queryKey: financeSnapshotKey(user?.id) }) > 0
  if (!updated && online && !fetching) return null
  const lastRead = updated ? `Son okuma: ${new Date(updated).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''
  return (
    <p role="status" className={`mb-4 rounded-lg px-3 py-2 text-xs leading-5 ${online ? 'bg-raised text-ink-muted' : 'bg-warning/10 text-warning ring-1 ring-warning/20'}`}>
      {!online ? (updated ? 'Çevrimdışısın. Gösterilen tutarlar son okunan verilerdir. ' : 'Çevrimdışısın. Finans verilerini görmek için internete bağlan. ') : fetching ? 'Finans verileri güncelleniyor… ' : ''}
      {lastRead}
    </p>
  )
}
