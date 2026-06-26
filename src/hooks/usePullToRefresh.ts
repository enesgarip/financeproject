import { useCallback, useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 70
const MAX_PULL = 110

/**
 * Mobil "yukarı çekince yenile" jesti. Sadece sayfa en üstteyken ve dikey bir
 * sürükleme tespit edildiğinde devreye girer; native browser pull-to-refresh
 * `overscroll-behavior-y: none` ile zaten kapalı (index.css), bu yüzden burada
 * çakışma olmaz.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const tracking = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (window.scrollY > 0 || refreshing) {
      startY.current = null
      tracking.current = false
      return
    }
    startY.current = e.touches[0]!.clientY
    tracking.current = true
  }, [refreshing])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!tracking.current || startY.current === null) return
    const delta = e.touches[0]!.clientY - startY.current
    if (delta <= 0) {
      setPullDistance(0)
      return
    }
    // Rubber-band: gerçek mesafe arttıkça görsel ilerleme yavaşlar.
    const eased = Math.min(MAX_PULL, delta * 0.5)
    setPullDistance(eased)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!tracking.current) return
    tracking.current = false
    startY.current = null

    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true)
      setPullDistance(PULL_THRESHOLD)
      void onRefresh().finally(() => {
        setRefreshing(false)
        setPullDistance(0)
      })
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, onRefresh])

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return {
    pullDistance,
    refreshing,
    progress: Math.min(1, pullDistance / PULL_THRESHOLD),
  }
}
