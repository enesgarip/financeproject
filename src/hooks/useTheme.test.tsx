// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from './useTheme'

let media: EventTarget & { matches: boolean }

beforeEach(() => {
  localStorage.clear()
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', vi.fn(() => media))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('dark')
})

function systemTheme(dark: boolean) {
  act(() => {
    media.matches = dark
    media.dispatchEvent(new Event('change'))
  })
}

describe('useTheme', () => {
  it('defaults to system despite the old automatically persisted theme and follows live changes', () => {
    localStorage.setItem('theme', 'dark')
    const { result } = renderHook(useTheme)
    expect(result.current.preference).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    systemTheme(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    systemTheme(false)
    expect(result.current.isDark).toBe(false)
  })

  it('keeps explicit choices across remounts and resumes live following when system is selected', () => {
    const first = renderHook(useTheme)
    act(() => first.result.current.chooseTheme('dark'))
    first.unmount()
    const { result } = renderHook(useTheme)
    expect(result.current.preference).toBe('dark')
    systemTheme(false)
    expect(result.current.isDark).toBe(true)
    act(() => result.current.chooseTheme('light'))
    systemTheme(true)
    expect(result.current.isDark).toBe(false)
    act(() => result.current.chooseTheme('system'))
    expect(result.current.isDark).toBe(true)
  })

  it('resynchronizes on return to the app and accepts a preference changed in another tab', () => {
    const { result } = renderHook(useTheme)
    act(() => {
      media.matches = true
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current.isDark).toBe(true)
    act(() => {
      localStorage.setItem('denge:theme-preference', 'light')
      window.dispatchEvent(new StorageEvent('storage', { key: 'denge:theme-preference' }))
    })
    expect(result.current.isDark).toBe(false)
    act(() => {
      localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(result.current.preference).toBe('system')
    expect(result.current.isDark).toBe(true)
  })

  it('still applies the theme when storage is unavailable and removes listeners on unmount', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const remove = vi.spyOn(media, 'removeEventListener')
    const { result, unmount } = renderHook(useTheme)
    expect(result.current.preference).toBe('system')
    act(() => result.current.chooseTheme('dark'))
    expect(result.current.isDark).toBe(true)
    unmount()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
