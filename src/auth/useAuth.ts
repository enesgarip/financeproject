import { createContext, useContext } from 'react'
import type { AuthContextValue } from './AuthProvider'

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth AuthProvider içinde kullanılmalı.')
  return context
}
