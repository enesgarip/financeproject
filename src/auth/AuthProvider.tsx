import type { Session, User } from '@supabase/supabase-js'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AuthContext } from './useAuth'

type AuthContextValue = {
  loading: boolean
  session: Session | null
  user: User | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
}

function sessionPublishDelayMs(nextSession: Session | null) {
  const accessToken = nextSession?.access_token
  if (!accessToken) return 0

  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return 0
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(paddedPayload)) as { iat?: unknown }
    if (typeof parsed.iat !== 'number') return 0

    return Math.max(0, parsed.iat * 1000 + 1000 - Date.now())
  } catch {
    return 0
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    let publishTimer: ReturnType<typeof window.setTimeout> | null = null

    function publishSession(nextSession: Session | null) {
      if (!alive) return
      if (publishTimer) window.clearTimeout(publishTimer)

      const delay = sessionPublishDelayMs(nextSession)
      if (delay > 0) {
        setLoading(true)
        publishTimer = window.setTimeout(() => {
          if (!alive) return
          setSession(nextSession)
          setLoading(false)
        }, delay)
        return
      }

      setSession(nextSession)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => {
      publishSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      publishSession(nextSession)
    })

    return () => {
      alive = false
      if (publishTimer) window.clearTimeout(publishTimer)
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signUp(email, password, fullName) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: fullName,
              name: fullName,
            },
          },
        })
        if (error) throw error
      },
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },
    }),
    [loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export type { AuthContextValue }
