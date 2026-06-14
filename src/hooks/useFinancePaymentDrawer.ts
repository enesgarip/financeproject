import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  emptyAccountMessageForObligation,
  getAccountsForObligation,
  lastUsedKeyForObligation,
  submitFinanceObligationPayment,
} from '../services/financePaymentActions'
import type { Card } from '../types/database'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import type { FinanceObligation } from '../utils/obligations'
import type { SupabaseLikeError } from '../utils/supabaseErrors'

type AccountPaymentSubmit = {
  account: Card
  amount: number
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
  detail?: ReactNode
  formatSubmitError?: (error: SupabaseLikeError) => string
  onSubmitEnd?: (context: FinancePaymentSubmitContext & { error: SupabaseLikeError | null }) => void
  onSubmitStart?: (context: FinancePaymentSubmitContext) => void
  reload?: () => Promise<void>
  afterSuccess?: () => Promise<void>
}

export function useFinancePaymentDrawer() {
  const [state, setState] = useState<FinancePaymentDrawerState | null>(null)

  const closePaymentDrawer = useCallback(() => {
    setState(null)
  }, [])

  const openPaymentDrawer = useCallback(async (intent: FinanceObligation, options: FinancePaymentDrawerOpenOptions = {}) => {
    if (!intent.action) return

    const sourceCards = options.cards ?? (options.loadCards ? await options.loadCards() : [])
    const accounts = getAccountsForObligation(intent, sourceCards)
    const lastUsedKey = lastUsedKeyForObligation(intent)

    setState({
      intent,
      accounts,
      selectedAccountId: resolvePreferred(getLastUsed(lastUsedKey), accounts.map((account) => account.id)),
      amountValue: intent.amount > 0 ? String(intent.amount) : '',
      error: accounts.length === 0 ? emptyAccountMessageForObligation(intent) : '',
      saving: false,
      detail: options.detail,
      formatSubmitError: options.formatSubmitError,
      onSubmitEnd: options.onSubmitEnd,
      onSubmitStart: options.onSubmitStart,
      reload: options.reload,
      afterSuccess: options.afterSuccess,
    })
  }, [])

  const handleSelectedAccountChange = useCallback((value: string) => {
    setState((current) => (current ? { ...current, selectedAccountId: value, error: '' } : current))
  }, [])

  const handleAmountValueChange = useCallback((value: string) => {
    setState((current) => (current ? { ...current, amountValue: value, error: '' } : current))
  }, [])

  const handleSubmit = useCallback(async ({ account, amount }: AccountPaymentSubmit) => {
    if (!state?.intent.action) return

    const current = state
    const submitContext = { intent: current.intent, account, amount }
    setState({ ...current, saving: true, error: '' })
    current.onSubmitStart?.(submitContext)

    const { error } = await submitFinanceObligationPayment({
      obligation: current.intent,
      account,
      amount,
    })
    current.onSubmitEnd?.({ ...submitContext, error })

    if (error) {
      setState((latest) => (
        latest?.intent.id === current.intent.id
          ? { ...latest, saving: false, error: current.formatSubmitError?.(error) ?? error.message ?? 'Ödeme işlemi tamamlanamadı.' }
          : latest
      ))
      return
    }

    setLastUsed(lastUsedKeyForObligation(current.intent), account.id)
    closePaymentDrawer()
    await Promise.all([current.reload?.(), current.afterSuccess?.()])
  }, [closePaymentDrawer, state])

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
    externalError: state?.error ?? '',
    detail: state?.detail,
  }), [closePaymentDrawer, handleAmountValueChange, handleSelectedAccountChange, handleSubmit, state])

  return {
    closePaymentDrawer,
    drawerProps,
    openPaymentDrawer,
  }
}
