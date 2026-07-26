import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '../auth/useAuth'
import type { FinanceSnapshot } from '../data/repositories/financeSnapshotRepo'
import { financeSnapshotKey } from './financeSnapshotKey'

/**
 * Günlük net değer fotoğrafı. Eskiden yalnız Analiz sayfası açılınca alınıyordu;
 * seri delikli kalıyor, FIRE/trend kısa pencereden yanlış sonuç üretiyordu.
 * Artık Layout'a bağlı: uygulama hangi sayfayla açılırsa açılsın günde bir kez.
 *
 * İki maliyet dengesi:
 *  - Kayıt gecikmeli tetiklenir ve önce TanStack cache'ine bakar; Dashboard/Analiz
 *    zaten snapshot yüklediyse ek ağ turu YOK.
 *  - Ağır modüller (repo katmanı, financeSummary, kur istemcisi) DİNAMİK import
 *    edilir. Layout her sayfada yüklendiği için statik import bunları giriş
 *    paketine sokuyor ve ilk açılışı yavaşlatıyordu (index chunk +16 kB gzip).
 */

const STORAGE_KEY = 'denge:net-worth-snapshot-day'
const RECORD_DELAY_MS = 4000

function todayKey(userId: string): string {
  return `${userId}:${new Date().toLocaleDateString('sv-SE')}`
}

export function useDailyNetWorthSnapshot() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return

    const marker = todayKey(userId)
    if (localStorage.getItem(STORAGE_KEY) === marker) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [analysisRepo, snapshotRepo, financeSummary, ratesClient] = await Promise.all([
            import('../data/repositories/analysisRepo'),
            import('../data/repositories/financeSnapshotRepo'),
            import('../utils/financeSummary'),
            import('../lib/marketRatesClient'),
          ])
          if (cancelled) return

          let snapshot = queryClient.getQueryData<FinanceSnapshot>(financeSnapshotKey(userId))
          if (!snapshot) {
            snapshot = await snapshotRepo.fetchFinanceSnapshot()
            if (cancelled) return
            queryClient.setQueryData(financeSnapshotKey(userId), snapshot)
          }

          const position = financeSummary.buildFinancialPosition({
            assets: snapshot.assets,
            cards: snapshot.cards,
            loans: snapshot.loans,
            loanInstallments: snapshot.loanInstallments,
            debts: snapshot.debts,
            payments: snapshot.payments,
            salaryHistory: snapshot.salaryHistory,
            cardInstallments: snapshot.cardInstallments,
          })

          // Kurlar snapshot ile birlikte saklanır; net değer trendinin
          // gram altın / USD gösterimi eski noktalarda bunları kullanır.
          const rates = await ratesClient.ensureRatesLoaded().catch(() => null)
          if (cancelled) return

          const result = await analysisRepo.recordNetWorthSnapshot(userId, {
            netWorth: position.netWorth,
            goldTry: rates?.rates?.GRA?.buying ?? null,
            usdTry: rates?.rates?.USD?.buying ?? null,
          })
          if (cancelled || !result.ok) return

          localStorage.setItem(STORAGE_KEY, marker)
          // Analiz sayfası açıksa bugünün noktasını hemen görsün.
          void queryClient.invalidateQueries({ queryKey: ['net-worth-snapshots'] })
        } catch {
          // Snapshot kaydı yardımcı bir iştir; hatası kullanıcı akışını bozmaz.
        }
      })()
    }, RECORD_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [userId, queryClient])
}
