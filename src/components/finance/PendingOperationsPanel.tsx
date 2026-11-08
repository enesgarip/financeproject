import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { executeFinanceOperation, operationInFlight } from '../../services/financeOperations'
import { pendingOperations, OPERATION_EVENT, type OperationAttempt } from '../../utils/operationAttempt'
import { Button } from '../ui/button'

export function PendingOperationsPanel() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [items, setItems] = useState<OperationAttempt[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const sync = () => {
      try { setItems(user ? pendingOperations(user.id).filter(attempt => !operationInFlight(attempt)) : []) }
      catch { setError('Önceki işlemler cihazdan okunamadı. Yeni kayıt girmeden işlem geçmişini kontrol et.') }
    }
    sync()
    window.addEventListener(OPERATION_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(OPERATION_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [user])
  if (!items.length && !error) return null
  return <section className="mb-4 space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3" aria-label="Sonucu doğrulanacak işlemler">
    <h2 className="text-sm font-semibold text-ink">Önceki işlemi doğrula</h2>
    <p className="text-xs text-ink-muted">Bağlantı kesildiği için sonucu doğrulanamayan işlem var. Aynı işlem ikinci kez uygulanmadan sonucu kontrol edilir.</p>
    {items.map(attempt => <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-ink">{attempt.method === 'restore_user_finance_data_tx' ? 'Yedek geri yükleme' : attempt.method === 'contribute_to_goal_bucket' ? 'Hedef için para ayırma' : attempt.method === 'update_asset_value' ? 'Varlık değer güncellemesi' : attempt.method === 'trade_asset_with_account' ? 'Varlık alım/satımı' : 'Hesap hareketi'}</span>
      {attempt.args ? <Button size="sm" disabled={!!busy} onClick={async () => {
        setBusy(attempt.id); setError('')
        const result = await executeFinanceOperation(attempt.userId, attempt.method, attempt.scope, attempt.args!)
        if (result.error) setError(result.error.message ?? 'Sonuç doğrulanamadı.')
        else await queryClient.invalidateQueries()
        setBusy('')
      }}>{busy === attempt.id ? 'Doğrulanıyor…' : 'Sonucu doğrula'}</Button> : <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-primary" to="/veri-sagligi/islemler#yedek">Aynı yedek dosyasıyla doğrula →</Link>}
    </div>)}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>
}
