import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLastUsed, resolvePreferred, setLastUsed } from './lastUsed'

function stubLocalStorage() {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
  }

  vi.stubGlobal('window', { localStorage })

  return { localStorage, store }
}

describe('lastUsed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back quietly when localStorage is unavailable', () => {
    expect(getLastUsed('expenseCard')).toBe('')

    expect(() => setLastUsed('expenseCard', 'card-1')).not.toThrow()
  })

  it('stores and reads the last used id', () => {
    const { localStorage } = stubLocalStorage()

    setLastUsed('paymentAccount', 'account-1')

    expect(localStorage.setItem).toHaveBeenCalledWith('fp.lastUsed.paymentAccount', 'account-1')
    expect(getLastUsed('paymentAccount')).toBe('account-1')
  })

  it('keeps only currently available preferred ids', () => {
    expect(resolvePreferred('account-2', ['account-1', 'account-2'])).toBe('account-2')
    expect(resolvePreferred('deleted-account', ['account-1', 'account-2'])).toBe('')
    expect(resolvePreferred('deleted-account', ['account-1'], 'account-1')).toBe('account-1')
  })
})
