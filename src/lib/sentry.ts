import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

/**
 * Initializes Sentry error monitoring.
 *
 * No-op when VITE_SENTRY_DSN is unset (local dev / preview builds), so the app
 * behaves identically with or without it.
 *
 * Privacy (this is a personal-finance app):
 * - Session Replay is intentionally NOT enabled — it would capture on-screen
 *   balances, transactions and account numbers.
 * - sendDefaultPii is false, so no IP addresses / request bodies are attached.
 */
export function initSentry(): void {
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    // Errors are the priority; sample a small slice of traces to stay well
    // within the free-tier quota.
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  })
}

export { Sentry }
