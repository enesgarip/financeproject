import { useCallback, useEffect, useState } from 'react'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import {
  applyCardProvision,
  fetchCardInstallments,
  fetchProvisionExpenses,
  fetchStatementArchives,
} from '../data/repositories/cardsRepo'
import type { CardExpense, CardInstallment, CardStatementArchive } from '../types/database'
import { isSchemaCacheError } from './CardsPage.helpers'

export function useCardsPageData() {
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const [provisions, setProvisions] = useState<CardExpense[]>([])
  const [provisionsLoading, setProvisionsLoading] = useState(false)
  const [provisionError, setProvisionError] = useState('')
  const [provisionActionId, setProvisionActionId] = useState<string | null>(null)
  const [statements, setStatements] = useState<CardStatementArchive[]>([])
  const [statementsLoading, setStatementsLoading] = useState(true)
  const [statementError, setStatementError] = useState('')
  const [statementActionId, setStatementActionId] = useState<string | null>(null)
  const [installments, setInstallments] = useState<CardInstallment[]>([])

  const loadProvisions = useCallback(async () => {
    setProvisionsLoading(true)
    setProvisionError('')
    const result = await fetchProvisionExpenses()

    if (!result.ok) {
      setProvisions([])
      setProvisionError(
        isSchemaCacheError(result.error)
          ? 'Provizyon altyapısı henüz canlı veritabanında yok. Migration uygulanınca bu liste açılacak.'
          : result.error.message ?? 'Provizyonlar yüklenemedi.',
      )
    } else {
      setProvisions(result.data)
    }
    setProvisionsLoading(false)
  }, [])

  const loadStatements = useCallback(async () => {
    setStatementsLoading(true)
    setStatementError('')
    const result = await fetchStatementArchives(24)

    if (!result.ok) {
      setStatements([])
      setStatementError(
        isSchemaCacheError(result.error)
          ? 'Ekstre odeme altyapisi henuz canli veritabaninda yok. Migration uygulaninca bu panel acilacak.'
          : result.error.message ?? 'Ekstreler yüklenemedi.',
      )
    } else {
      setStatements(result.data)
    }
    setStatementsLoading(false)
  }, [])

  const loadInstallments = useCallback(async () => {
    const result = await fetchCardInstallments()

    if (!result.ok) {
      setInstallments([])
      return
    }

    setInstallments(result.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProvisions()
  }, [loadProvisions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatements()
  }, [loadStatements])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  async function refreshCardsAndProvisions(reload: () => Promise<void>) {
    await Promise.all([reload(), loadProvisions(), loadStatements(), loadInstallments(), invalidateSnapshot()])
  }

  async function handleProvisionAction(
    expense: CardExpense,
    action: 'post' | 'cancel',
    reload: () => Promise<void>,
    setError: (message: string) => void,
  ) {
    setProvisionActionId(`${action}-${expense.id}`)
    setError('')
    setProvisionError('')

    const result = await applyCardProvision(expense.id, action)

    if (!result.ok) {
      const message = isSchemaCacheError(result.error)
        ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
        : result.error.message ?? 'Provizyon işlemi tamamlanamadı.'
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
    setProvisionError('')

    for (const expense of pendingExpenses) {
      const result = await applyCardProvision(expense.id, 'post')
      if (!result.ok) {
        setError(
          isSchemaCacheError(result.error)
            ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
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
    invalidateSnapshot,
    loadInstallments,
    loadStatements,
    provisionActionId,
    provisionError,
    provisions,
    provisionsLoading,
    refreshCardsAndProvisions,
    statementActionId,
    statementError,
    statements,
    statementsLoading,
    handlePostAllProvisions,
    handleProvisionAction,
    setStatementActionId,
  }
}
