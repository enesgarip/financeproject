import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { useUsageFlow } from './useUsageFlow'
import type { UsageSource } from '../utils/usageStatistics'
import {
  emptyAccountMessageForObligation,
  getAccountsForObligation,
  lastUsedKeyForObligation,
  submitFinanceObligationPayment,
  refreshFinancePaymentState,
} from '../services/financePaymentActions'
import type { Card } from '../types/database'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import type { FinanceObligation } from '../utils/obligations'
import type { SupabaseLikeError } from '../utils/supabaseErrors'
import { clearPaymentAttempt, readPaymentAttempt, savePaymentAttempt, type PaymentAttempt } from '../utils/paymentAttempt'
import { userMessage } from '../utils/userMessage'

const UNCERTAIN_MESSAGE = 'İşlemin sonucu doğrulanamadı. Tutarı değiştirmeden “Sonucu doğrula” ile aynı kaydı güvenle tekrar dene; ikinci ödeme oluşturulmaz.'

type AccountPaymentSubmit = {
  account: Card | null
  amount: number
  // B4: bakiye SMS/banka hareketiyle zaten düşülmüşse RPC tekrar düşmez.
  skipSourceDebit?: boolean
  /** Gerçek ödeme günü (YYYY-MM-DD); yalnız planlı ödeme/kredi taksiti (UX turu B9). */
  paidAt?: string
}

type FinancePaymentSubmitContext = AccountPaymentSubmit & {
  intent: FinanceObligation
}

export type FinancePaymentDrawerOpenOptions = {
  cards?: Card[]
  loadCards?: () => Promise<Card[]>
  reload?: () => Promise<void>
  afterSuccess?: () => Promise<void>
  detail?: ReactNode
  formatSubmitError?: (error: SupabaseLikeError) => string
  onSubmitEnd?: (context: FinancePaymentSubmitContext & { error: SupabaseLikeError | null }) => void
  onSubmitStart?: (context: FinancePaymentSubmitContext) => void
}

type FinancePaymentDrawerState = {
  intent: FinanceObligation
  accounts: Card[]
  selectedAccountId: string
  amountValue: string
  error: string
  saving: boolean
  attempt: PaymentAttempt | null
  uncertain: boolean
  detail?: ReactNode
  formatSubmitError?: (error: SupabaseLikeError) => string
  onSubmitEnd?: (context: FinancePaymentSubmitContext & { error: SupabaseLikeError | null }) => void
  onSubmitStart?: (context: FinancePaymentSubmitContext) => void
  reload?: () => Promise<void>
  afterSuccess?: () => Promise<void>
}

export function useFinancePaymentDrawer(source: UsageSource) {
  const { user } = useAuth()
  const submitting = useRef(false)
  const [state, setState] = useState<FinancePaymentDrawerState | null>(null)
  const { attempt: trackPaymentAttempt } = useUsageFlow(user?.id, 'payment', source, Boolean(state))

  const closePaymentDrawer = useCallback(() => {
    setState(null)
  }, [])

  const openPaymentDrawer = useCallback(async (intent: FinanceObligation, options: FinancePaymentDrawerOpenOptions = {}) => {
    if (!intent.action) return

    const sourceCards = options.cards ?? (options.loadCards ? await options.loadCards() : [])
    const accounts = getAccountsForObligation(intent, sourceCards)
    const lastUsedKey = lastUsedKeyForObligation(intent)
    const selectableSourceIds = intent.action === 'pay_payment'
      ? ['outside-accounts', ...accounts.map((account) => account.id)]
      : accounts.map((account) => account.id)

    let attempt: PaymentAttempt | null = null
    let pendingError = ''
    try { if (user) attempt = readPaymentAttempt(user.id, intent) } catch (error) {
      pendingError = error instanceof Error ? error.message : 'Önceki ödeme okunamadı. İşlem geçmişini kontrol et.'
    }
    setState({
      intent,
      accounts,
      selectedAccountId: attempt ? attempt.accountId ?? 'outside-accounts' : resolvePreferred(getLastUsed(lastUsedKey), selectableSourceIds),
      amountValue: attempt ? String(attempt.amount) : intent.amount > 0 ? String(intent.amount) : '',
      error: pendingError || (attempt ? UNCERTAIN_MESSAGE : accounts.length === 0 && intent.action !== 'pay_payment' ? emptyAccountMessageForObligation(intent) : ''),
      saving: false,
      attempt,
      uncertain: Boolean(attempt || pendingError),
      detail: options.detail,
      formatSubmitError: options.formatSubmitError,
      onSubmitEnd: options.onSubmitEnd,
      onSubmitStart: options.onSubmitStart,
      reload: options.reload,
      afterSuccess: options.afterSuccess,
    })
  }, [user])

  const handleSelectedAccountChange = useCallback((value: string) => {
    setState((current) => (current && !current.uncertain && !current.saving ? { ...current, selectedAccountId: value, error: '' } : current))
  }, [])

  const handleAmountValueChange = useCallback((value: string) => {
    setState((current) => (current && !current.uncertain && !current.saving ? { ...current, amountValue: value, error: '' } : current))
  }, [])

  const handleSubmit = useCallback(async ({ account, amount, skipSourceDebit, paidAt }: AccountPaymentSubmit) => {
    if (!state?.intent.action || !user || submitting.current) return

    const current = state
    let attempt: PaymentAttempt
    try {
      const stored = readPaymentAttempt(user.id, current.intent)
      attempt = stored ?? {
        id: crypto.randomUUID(), accountId: account?.id ?? null, amount,
        obligationAmount: current.intent.amount, skipSourceDebit: skipSourceDebit ?? false, paidAt,
      }
      if (stored && !current.attempt) {
        setState({ ...current, attempt, uncertain: true, amountValue: String(attempt.amount), selectedAccountId: attempt.accountId ?? 'outside-accounts', error: UNCERTAIN_MESSAGE })
        return
      }
      savePaymentAttempt(user.id, current.intent, attempt)
    } catch (error) {
      setState({ ...current, error: error instanceof Error && /Önceki ödeme/.test(error.message) ? error.message : 'İşlem kimliği cihazda saklanamadı. Tarayıcı depolamasını kontrol et; ödeme gönderilmedi.' })
      return
    }
    submitting.current = true
    const submitContext = { intent: current.intent, account, amount }
    setState({ ...current, attempt, saving: true, error: '' })
    current.onSubmitStart?.(submitContext)
    const reportPayment = trackPaymentAttempt()

    const { error } = await submitFinanceObligationPayment({
      requestId: attempt.id,
      obligation: { ...current.intent, amount: attempt.obligationAmount },
      account: attempt.accountId ? { id: attempt.accountId } : null,
      amount: attempt.amount,
      skipSourceDebit: attempt.skipSourceDebit,
      paidAt: attempt.paidAt,
    }).catch((cause: unknown) => ({ error: { message: cause instanceof Error ? cause.message : 'Bağlantı sonucu doğrulanamadı.' } as SupabaseLikeError }))
    reportPayment(error ? 'failed' : 'completed')
    current.onSubmitEnd?.({ ...submitContext, error })

    if (error) {
      const uncertain = !error.code || /fetch|network|timeout|connection/i.test(error.message ?? '')
      let fresh: Awaited<ReturnType<typeof refreshFinancePaymentState>> | null = null
      if (!uncertain) {
        clearPaymentAttempt(user.id, current.intent)
        try { fresh = await refreshFinancePaymentState(current.intent) } catch { /* Hata kullanıcıya söylenir; eski tutar kesin sunulmaz. */ }
        await Promise.allSettled([current.reload?.(), current.afterSuccess?.()])
      }
      setState((latest) => (
        latest?.intent.id === current.intent.id
          ? { ...latest, ...(fresh ?? {}), detail: fresh ? undefined : latest.detail,
            saving: false, attempt: uncertain ? attempt : null, uncertain,
            error: uncertain ? UNCERTAIN_MESSAGE : `${userMessage(current.formatSubmitError?.(error) ?? error.message, error.code)} ${fresh ? 'Güncel kalan ve hesap bakiyeleri gösteriliyor.' : 'Güncel veriler alınamadı; yeniden kayıt girmeden ekranı yenile.'}` }
          : latest
      ))
      submitting.current = false
      return
    }

    clearPaymentAttempt(user.id, current.intent)
    setLastUsed(lastUsedKeyForObligation(current.intent), attempt.accountId ?? 'outside-accounts')
    setState((latest) => latest?.intent.id === current.intent.id ? null : latest)
    await Promise.allSettled([current.reload?.(), current.afterSuccess?.()])
    submitting.current = false
  }, [state, trackPaymentAttempt, user])

  const drawerProps = useMemo(() => ({
    intent: state?.intent ?? null,
    open: Boolean(state?.intent),
    accounts: state?.accounts ?? [],
    selectedAccountId: state?.selectedAccountId ?? '',
    onSelectedAccountChange: handleSelectedAccountChange,
    amountValue: state?.amountValue ?? '',
    onAmountValueChange: handleAmountValueChange,
    onClose: closePaymentDrawer,
    onSubmit: handleSubmit,
    saving: state?.saving ?? false,
    uncertain: state?.uncertain ?? false,
    externalError: state?.error ?? '',
    detail: state?.detail,
  }), [closePaymentDrawer, handleAmountValueChange, handleSelectedAccountChange, handleSubmit, state])

  return {
    closePaymentDrawer,
    drawerProps,
    openPaymentDrawer,
  }
}
