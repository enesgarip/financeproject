import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '../auth/useAuth'
import type { FinanceSnapshot } from '../data/repositories/financeSnapshotRepo'
import { financeSnapshotKey } from './financeSnapshotKey'

/**
 * Günlük net değer fotoğrafı. Eskiden yalnız Analiz sayfası açılınca alınıyordu;
 * seri delikli kalıyor, FIRE/trend kısa pencereden yanlış sonuç üretiyordu.
 * Artık Layout'a bağlı: uygulama hangi sayfayla açılırsa açılsın günde bir kez.
 * Aynı koşu hedef bazlı fotoğrafları da yazar (savings_goal_snapshots) —
 * "gerçekleşen tempo" ve varış tahmini tarihçesini bu seri besler.
 *
 * İki maliyet dengesi:
 *  - Kayıt gecikmeli tetiklenir ve önce TanStack cache'ine bakar; Dashboard/Analiz
 *    zaten snapshot yüklediyse ek ağ turu YOK.
 *  - Ağır modüller (repo katmanı, financeSummary, kur istemcisi) DİNAMİK import
 *    edilir. Layout her sayfada yüklendiği için statik import bunları giriş
 *    paketine sokuyor ve ilk açılışı yavaşlatıyordu (index chunk +16 kB gzip).
 *
 * İki kenar durum (denetim 2026-08-12):
 *  - Cache'teki snapshot ne kadar eski olursa olsun kullanılıyordu; PWA sekmesi
 *    gece açık kaldığında DÜNKÜ pozisyon bugünün noktası olarak yazılabiliyordu.
 *    Artık cache yalnız AYNI YEREL GÜNDE alındıysa kabul edilir.
 *  - Cache boşken sonuç `setQueryData` ile yazılıyordu; bu `dataUpdatedAt`'ı
 *    tazelediği için `useFinanceSnapshot`'ın queryFn'i (ve ona bağlı finans
 *    bakımı) o açılışta atlanabiliyordu. Yan etki kaldırıldı: fotoğraf kendi
 *    verisini okur, paylaşılan cache'e YAZMAZ.
 */

const STORAGE_KEY = 'denge:net-worth-snapshot-day'
const RECORD_DELAY_MS = 4000

function localDay(value: Date | number): string {
  return new Date(value).toLocaleDateString('sv-SE')
}

function todayKey(userId: string): string {
  return `${userId}:${localDay(new Date())}`
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

          const cached = queryClient.getQueryState<FinanceSnapshot>(financeSnapshotKey(userId))
          const cachedIsFromToday = Boolean(cached?.data)
            && cached!.dataUpdatedAt > 0
            && localDay(cached!.dataUpdatedAt) === localDay(new Date())
          let snapshot = cachedIsFromToday ? cached!.data : undefined
          if (!snapshot) {
            snapshot = await snapshotRepo.fetchFinanceSnapshot()
            if (cancelled) return
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

          // Damga kayıt ANINDAKİ günden türetilir: gece yarısını geçen bir koşu
          // dünün anahtarını yazmasın (yoksa bugün ikinci kez tetiklenir).
          localStorage.setItem(STORAGE_KEY, todayKey(userId))
          // Analiz sayfası açıksa bugünün noktasını hemen görsün.
          void queryClient.invalidateQueries({ queryKey: ['net-worth-snapshots'] })

          // Hedef fotoğrafları: aynı günlük koşunun ikinci yarısı. Biriken
          // tutar yalnız client'ta türetilebilir (canlı kur/BIST fiyatı) —
          // sunucu bu seriyi üretemez. Akışın gövdesi lazy modülde
          // (dailyGoalSnapshots): çözümleme zinciri entry bütçesine girmesin.
          // Damgadan SONRA ve en-iyi-çaba: hatası net değer kaydını geri
          // almaz, seri bir gün atlar ve ertesi koşuda devam eder.
          if (!snapshot.savingsGoals.some((goal) => goal.status === 'active')) return
          const goalRunner = await import('./dailyGoalSnapshots')
          if (cancelled) return
          await goalRunner.recordDailyGoalSnapshots(userId, snapshot, rates, () => cancelled)
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
