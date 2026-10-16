import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
const THEME_KEY = 'denge:theme-preference'

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Eski `theme` anahtarı otomatik yazılıyordu; açık kullanıcı tercihi sayılmaz. */
export function useTheme() {
  const [preference, setPreference] = useState(readPreference)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isDark = preference === 'dark' || (preference === 'system' && systemDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSystemDark(media.matches)
    sync()
    media.addEventListener('change', sync)
    window.addEventListener('focus', sync)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) setPreference(readPreference())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
    // Tarayıcı/PWA üst bandı da elle seçilmiş tema dahil aynı zemini izler.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = isDark ? '#101623' : '#f5f7fb'
    })
  }, [isDark])

  const chooseTheme = useCallback((next: ThemePreference) => {
    setPreference(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Depolama kapalıysa seçim bu oturum boyunca uygulanır.
    }
  }, [])

  return { preference, isDark, chooseTheme }
}
