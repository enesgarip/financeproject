import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { cardPageDataKey } from '../app/cardPageDataKey'
import { useCrudRows } from '../app/useCrudRows'
import { canCutCurrentStatement } from '../utils/statementCycle'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import {
  applyCardProvision,
  fetchCardInstallments,
  fetchProvisionExpenses,
  fetchStatementArchives,
  fetchStatementPayments,
  setProvisionInstallments,
} from '../data/repositories/cardsRepo'
import { fetchAccountReconciliations } from '../data/repositories/financePanelsRepo'
import { submitAccountMovement } from '../services/accountMovements'
import type { AccountReconciliation, Card, CardExpense, CardInstallment, CardStatementArchive, CardStatementPayment } from '../types/database'
import { parseNumber } from '../utils/formatCurrency'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import type { CardSection } from './CardsPage.sections'

type ReloadCards = (() => Promise<void>) | null
export type CardPanel = 'donem' | 'taksitler' | 'ekstreler' | 'provizyon' | 'kategoriler' | 'manuel' | null

function scrollToPageTop() {
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
}

export function useCardSectionNavigation() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const rawSection = searchParams.get('section')
  const section: CardSection = ['kartlar', 'ozet', 'islemler', 'ekstreler'].includes(rawSection ?? '') ? 'kartlar' : 'hesaplar'
  const selectedCardId = searchParams.get('card')
  const rawPanel = searchParams.get('panel') ?? (searchParams.get('section') === 'ekstreler' ? 'ekstreler' : searchParams.get('section') === 'islemler' ? 'donem' : null)
  const panel: CardPanel = ['donem', 'taksitler', 'ekstreler', 'provizyon', 'kategoriler', 'manuel'].includes(rawPanel ?? '') ? rawPanel as CardPanel : null
  const listScroll = useRef(0)
  const previousCard = useRef(selectedCardId)

  useLayoutEffect(() => {
    if (previousCard.current && !selectedCardId) window.scrollTo({ top: listScroll.current, behavior: 'instant' })
    previousCard.current = selectedCardId
  }, [selectedCardId])

  const handleSectionChange = useCallback((next: CardSection) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('section', next === 'hesaplar' ? 'hesaplar' : 'kartlar')
    nextParams.delete('card')
    nextParams.delete('panel')
    listScroll.current = 0
    setSearchParams(nextParams, { replace: true })
    scrollToPageTop()
  }, [searchParams, setSearchParams])

  const openCardDetails = useCallback((card: Card) => {
    if (!selectedCardId) listScroll.current = window.scrollY
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('section', card.card_type === 'banka_karti' ? 'hesaplar' : 'kartlar')
    nextParams.set('card', card.id)
    nextParams.delete('panel')
    setSearchParams(nextParams, { state: { cardsList: location.pathname + location.search } })
    scrollToPageTop()
  }, [searchParams, setSearchParams, selectedCardId, location.pathname, location.search])

  const backToList = useCallback(() => {
    if (location.state?.cardsList) navigate(-1)
    else {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('card')
      nextParams.delete('panel')
      nextParams.set('section', section)
      setSearchParams(nextParams, { replace: true })
    }
  }, [location.state, navigate, searchParams, section, setSearchParams])

  const openPanel = useCallback((next: CardPanel) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('section', section)
    if (next && next !== panel) nextParams.set('panel', next)
    else nextParams.delete('panel')
    setSearchParams(nextParams, { replace: true, state: location.state })
  }, [searchParams, section, panel, setSearchParams, location.state])

  return {
    handleSectionChange,
    section,
    selectedCardId,
    openCardDetails,
    backToList,
    panel,
    openPanel,
  }
}

const EMPTY_PROVISIONS: CardExpense[] = []
const EMPTY_INSTALLMENTS: CardInstallment[] = []
const EMPTY_RECONCILIATIONS: AccountReconciliation[] = []
const EMPTY_STATEMENTS: CardStatementArchive[] = []
const EMPTY_STATEMENT_PAYMENTS: CardStatementPayment[] = []

export function useCardsPageData({ section, panel, selectedCardId }: {
  section: CardSection
  panel: CardPanel
  selectedCardId: string | null
}) {
  const { user } = useAuth()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  // CrudPage ile aynı anahtar/sıralama: ikinci HTTP isteği oluşturmaz.
  const cardsQuery = useCrudRows('cards', 'card_type', false)
  const creditVisible = section === 'kartlar'
  // Doğrudan Hesaplar/harcama açılışında da zamanı gelen kesim atlanmaz.
  // Önce ucuz kart alanlarıyla aday kontrolü; kesin karar arşivler geldikten sonra.
  const cutMayBeDue = cardsQuery.data?.some((card) => canCutCurrentStatement(card)) ?? false
  const enabled = Boolean(user)
  const key = cardPageDataKey(user?.id)
  const [provisionActionId, setProvisionActionId] = useState<string | null>(null)
  const [statementActionId, setStatementActionId] = useState<string | null>(null)

  const provisionsQuery = useQuery({
    queryKey: [...key, 'provisions'],
    enabled: enabled && creditVisible && panel === 'provizyon',
    queryFn: async () => {
      const result = await fetchProvisionExpenses()
      if (!result.ok) throw new Error(isMissingSupabaseCapabilityError(result.error)
        ? missingSupabaseCapabilityMessage('Provizyon altyapısı', result.error)
        : result.error.message ?? 'Provizyonlar yüklenemedi.')
      return result.data
    },
  })
  // Arşiv ve kısmi ödemeler tek cache sonucudur: kalan borç eksik ödeme
  // verisiyle bir kare dahi doğrulanmış sayılmaz (K7).
  const statementsQuery = useQuery({
    queryKey: [...key, 'statements'],
    enabled: enabled && (creditVisible || cutMayBeDue),
    queryFn: async () => {
      const [result, paymentsResult] = await Promise.all([fetchStatementArchives(24), fetchStatementPayments()])
      if (!result.ok) throw new Error(isMissingSupabaseCapabilityError(result.error)
        ? missingSupabaseCapabilityMessage('Ekstre arşivi altyapısı', result.error)
        : result.error.message ?? 'Ekstreler yüklenemedi.')
      if (!paymentsResult.ok && !isMissingSupabaseCapabilityError(paymentsResult.error)) {
        throw new Error(paymentsResult.error.message ?? 'Kısmi ekstre ödemeleri yüklenemedi.')
      }
      return { statements: result.data, payments: paymentsResult.ok ? paymentsResult.data : EMPTY_STATEMENT_PAYMENTS }
    },
  })
  const installmentsQuery = useQuery({
    queryKey: [...key, 'installments'],
    enabled: enabled && creditVisible,
    queryFn: async () => {
      const result = await fetchCardInstallments()
      if (!result.ok) throw new Error(result.error.message ?? 'Gelecek taksitler yüklenemedi.')
      return result.data
    },
  })
  const reconciliationsQuery = useQuery({
    queryKey: [...key, 'reconciliations'],
    enabled: enabled && creditVisible && Boolean(selectedCardId),
    queryFn: async () => {
      const result = await fetchAccountReconciliations()
      if (!result.ok) throw new Error(result.error.message ?? 'Karşılaştırmalar yüklenemedi.')
      return result.data
    },
  })
  const provisions = provisionsQuery.data ?? EMPTY_PROVISIONS
  const provisionsLoading = provisionsQuery.isPending
  const provisionError = provisionsQuery.error?.message ?? ''
  const statements = statementsQuery.data?.statements ?? EMPTY_STATEMENTS
  const statementPayments = statementsQuery.data?.payments ?? EMPTY_STATEMENT_PAYMENTS
  const statementsLoading = statementsQuery.isPending
  const statementError = statementsQuery.error?.message ?? ''
  const installments = installmentsQuery.data ?? EMPTY_INSTALLMENTS
  const installmentsLoading = installmentsQuery.isPending
  const installmentsError = installmentsQuery.error?.message ?? ''
  const reconciliations = reconciliationsQuery.data ?? EMPTY_RECONCILIATIONS
  const { refetch: refetchStatements } = statementsQuery
  const { refetch: refetchInstallments } = installmentsQuery
  const { refetch: refetchReconciliations } = reconciliationsQuery
  const loadStatements = useCallback(async () => { await refetchStatements() }, [refetchStatements])
  const loadInstallments = useCallback(async () => { await refetchInstallments() }, [refetchInstallments])
  const loadReconciliations = useCallback(async () => { await refetchReconciliations() }, [refetchReconciliations])

  async function refreshCardsAndProvisions(reload: () => Promise<void>) {
    // Aktif sorgular bir kez tazelenir; kapalı sorgular sonraki açılışta yüklenir.
    await Promise.all([reload(), invalidateSnapshot()])
  }

  async function handleProvisionAction(
    expense: CardExpense,
    action: 'post' | 'cancel',
    reload: () => Promise<void>,
    setError: (message: string) => void,
  ) {
    setProvisionActionId(`${action}-${expense.id}`)
    setError('')

    const result = await applyCardProvision(expense.id, action)

    if (!result.ok) {
      const message = isMissingSupabaseCapabilityError(result.error)
        ? missingSupabaseCapabilityMessage('Provizyon altyapısı', result.error)
        : result.error.message ?? 'Provizyon işlemi tamamlanamadı.'
      setError(message)
      setProvisionActionId(null)
      return
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  async function handleSetProvisionInstallments(
    expense: CardExpense,
    installmentCount: number,
    reload: () => Promise<void>,
    setError: (message: string) => void,
  ) {
    if (installmentCount === expense.installment_count) return
    setProvisionActionId(`installments-${expense.id}`)
    setError('')

    const result = await setProvisionInstallments(expense.id, expense.amount, installmentCount)

    if (!result.ok) {
      const message = isMissingSupabaseCapabilityError(result.error)
        ? missingSupabaseCapabilityMessage('Provizyon altyapısı', result.error)
        : result.error.message ?? 'Taksit bilgisi kaydedilemedi.'
      setError(message)
      setProvisionActionId(null)
      return
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  async function handlePostAllProvisions(expenses: CardExpense[], reload: () => Promise<void>, setError: (message: string) => void) {
    const pendingExpenses = expenses.filter((expense) => expense.status === 'provision')
    if (pendingExpenses.length === 0) return

    setProvisionActionId('post-all')
    setError('')

    for (const expense of pendingExpenses) {
      const result = await applyCardProvision(expense.id, 'post')
      if (!result.ok) {
        setError(
          isMissingSupabaseCapabilityError(result.error)
            ? missingSupabaseCapabilityMessage('Provizyon altyapısı', result.error)
            : result.error.message ?? 'Provizyon işlemi tamamlanamadı.',
        )
        await refreshCardsAndProvisions(reload)
        setProvisionActionId(null)
        return
      }
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  return {
    installments,
    installmentsLoading,
    installmentsError,
    invalidateSnapshot,
    loadInstallments,
    loadReconciliations,
    loadStatements,
    provisionActionId,
    provisionError,
    provisions,
    provisionsLoading,
    reconciliations,
    refreshCardsAndProvisions,
    statementActionId,
    statementError,
    statements,
    statementPayments,
    statementsLoading,
    handlePostAllProvisions,
    handleProvisionAction,
    handleSetProvisionInstallments,
    setStatementActionId,
  }
}

export function useAccountMovementModal({
  invalidateSnapshot,
  reloadCards,
  setReloadCards,
}: {
  invalidateSnapshot: () => Promise<void>
  reloadCards: ReloadCards
  setReloadCards: Dispatch<SetStateAction<ReloadCards>>
}) {
  const [transactionCard, setTransactionCard] = useState<Card | null>(null)
  const [transactionType, setTransactionType] = useState<'in' | 'out' | 'transfer'>('in')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionTargetCard, setTransactionTargetCard] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [movementAccounts, setMovementAccounts] = useState<Card[]>([])

  function openTransaction(card: Card, reload: () => Promise<void>, cards: Card[], type: 'in' | 'out' | 'transfer' = 'in') {
    const accounts = cards.filter((row) => row.card_type === 'banka_karti')
    setTransactionCard(card)
    setReloadCards(() => reload)
    setMovementAccounts(accounts)
    setTransactionType(type)
    setTransactionAmount('')
    setTransactionTargetCard('')
    setTransactionError('')
  }

  function closeTransaction() {
    setTransactionCard(null)
  }

  function handleTransactionTypeChange(value: 'in' | 'out' | 'transfer') {
    setTransactionType(value)
    setTransactionTargetCard('')
    setTransactionError('')
  }

  function handleTransactionTargetCardChange(value: string) {
    setTransactionTargetCard(value)
    setTransactionError('')
  }

  async function handleTransactionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transactionCard) return

    const amount = parseNumber(transactionAmount)
    setTransactionSaving(true)
    setTransactionError('')
    const { error } = await submitAccountMovement({
      sourceAccount: transactionCard,
      targetAccount: movementAccounts.find((card) => card.id === transactionTargetCard),
      type: transactionType,
      amount,
    })

    setTransactionSaving(false)
    if (error) {
      setTransactionError(error.message ?? 'Para hareketi tamamlanamadı.')
      return
    }

    const cardId = transactionCard.id
    setTransactionCard(null)
    await Promise.all([reloadCards?.(), invalidateSnapshot()])
    // After data reloads, scroll back to the card the user was working with
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-card-id="${cardId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const transactionTargetAccounts = movementAccounts.filter((card) => card.id !== transactionCard?.id)

  return {
    transactionAmount,
    transactionCard,
    transactionError,
    transactionSaving,
    transactionTargetAccounts,
    transactionTargetCard,
    transactionType,
    closeTransaction,
    handleTransactionSubmit,
    handleTransactionTargetCardChange,
    handleTransactionTypeChange,
    openTransaction,
    setTransactionAmount,
  }
}
