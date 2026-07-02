import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type HeaderActionsContextValue = {
  actions: ReactNode
  setActions: (node: ReactNode) => void
  clearActions: () => void
}

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null)

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<ReactNode>(null)
  const setActions = useCallback((node: ReactNode) => setActionsState(node), [])
  const clearActions = useCallback(() => setActionsState(null), [])
  return (
    <HeaderActionsContext.Provider value={{ actions, setActions, clearActions }}>
      {children}
    </HeaderActionsContext.Provider>
  )
}

/**
 * Register page-specific header actions that Layout renders next to the
 * dark-mode toggle.  Call `setActions(<button …/>)` on mount and
 * `clearActions()` on unmount to keep the header tidy.
 */
export function useHeaderActions() {
  const ctx = useContext(HeaderActionsContext)
  if (!ctx) throw new Error('useHeaderActions must be used inside HeaderActionsProvider')
  return ctx
}
