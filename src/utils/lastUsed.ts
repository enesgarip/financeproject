/**
 * Small localStorage-backed memory for the last selection the user made in a
 * recurring flow, such as which card an expense was added to or which account a
 * payment was made from. Forms still validate the remembered id against the
 * currently available options before using it.
 */

const PREFIX = 'fp.lastUsed.'

export type LastUsedKey = 'expenseCard' | 'paymentAccount' | 'debtAccount' | 'loanAccount'

export function getLastUsed(key: LastUsedKey): string {
  try {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

export function setLastUsed(key: LastUsedKey, value: string): void {
  try {
    if (typeof window === 'undefined' || !value) return
    window.localStorage.setItem(PREFIX + key, value)
  } catch {
    // Ignore private-mode or quota errors; the form can fall back to blank/first.
  }
}

export function resolvePreferred(preferred: string, availableIds: readonly string[], fallback = ''): string {
  return preferred && availableIds.includes(preferred) ? preferred : fallback
}
