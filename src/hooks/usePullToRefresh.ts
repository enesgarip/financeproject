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
  const startX = useRef(0)
  const distance = useRef(0)
  const tracking = useRef(false)
  const inFlight = useRef(false)

  const cancel = useCallback(() => {
    startY.current = null
    tracking.current = false
    distance.current = 0
    if (!inFlight.current) setPullDistance(0)
  }, [])
  const blocked = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]') || document.body.style.position === 'fixed'

  const handleTouchStart = useCallback((e: TouchEvent) => {
    cancel()
    const target = e.target
    if (e.touches.length !== 1 || window.scrollY > 0 || inFlight.current || blocked() || !(target instanceof Element)) return
    const main = target.closest('main')
    if (!main || target.closest('input, textarea, select, button, a, form, [contenteditable="true"]')) return
    for (let parent = target; parent && parent !== main; parent = parent.parentElement!) {
      if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return
    }
    startY.current = e.touches[0]!.clientY
    startX.current = e.touches[0]!.clientX ?? 0
    tracking.current = true
  }, [cancel])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!tracking.current || startY.current === null) return
    if (e.touches.length !== 1 || blocked()) { cancel(); return }
    const delta = e.touches[0]!.clientY - startY.current
    const horizontal = (e.touches[0]!.clientX ?? 0) - startX.current
    if (delta <= 0 || Math.abs(horizontal) > Math.abs(delta)) { cancel(); return }
    // Rubber-band: gerçek mesafe arttıkça görsel ilerleme yavaşlar.
    const eased = Math.min(MAX_PULL, delta * 0.5)
    distance.current = eased
    setPullDistance(eased)
  }, [cancel])

  const handleTouchEnd = useCallback(() => {
    if (!tracking.current) return
    tracking.current = false
    startY.current = null

    if (distance.current >= PULL_THRESHOLD && !blocked() && !inFlight.current) {
      inFlight.current = true
      distance.current = 0
      setRefreshing(true)
      setPullDistance(PULL_THRESHOLD)
      void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => {
        inFlight.current = false
        setRefreshing(false)
        setPullDistance(0)
      })
    } else {
      cancel()
    }
  }, [onRefresh, cancel])

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', cancel, { passive: true })
    window.addEventListener('orientationchange', cancel)
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('orientationchange', cancel)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, cancel])

  return {
    pullDistance,
    refreshing,
    progress: Math.min(1, pullDistance / PULL_THRESHOLD),
  }
}
