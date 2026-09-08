import { useMemo, useState, type ReactNode } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card } from '../../types/database'
import { dateInputValue } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { diffTL, greaterThanTL } from '../../utils/money'
import { SimpleModal } from '../SimpleModal'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { AccountSelector } from './AccountSelector'
import { MoneyInput } from './MoneyInput'

type AccountPaymentSubmit = {
  account: Card
  amount: number
  /** Gerçek ödeme günü (YYYY-MM-DD); `paidAtEditable` ise doldurulur (UX turu B9). */
  paidAt?: string
}

type AccountPaymentModalProps = {
  /**
   * Ödeme günü alanı gösterilsin mi. Planlı ödeme ve kredi taksiti için evet:
   * eskiden tarih "planlanan gün" olarak sabit gösteriliyor, erken/geç ödeme
   * gerçek günüyle kaydedilemiyordu.
   */
  paidAtEditable?: boolean
  open: boolean
  title: string
  accounts: Card[]
  selectedAccountId: string
  onSelectedAccountChange: (value: string) => void
  amountValue: string
  onAmountValueChange: (value: string) => void
  onClose: () => void
  onSubmit: (payload: AccountPaymentSubmit) => Promise<void> | void
  amountLabel?: string
  accountLabel?: string
  submitLabel: string
  saving?: boolean
  externalError?: string
  amountEditable?: boolean
  amountActions?: ReactNode
  accountPreviewAmount?: (amount: number) => number
  emptyMessage?: string
  info?: ReactNode
  extraControls?: ReactNode
  children?: ReactNode
  validate?: (payload: AccountPaymentSubmit) => string | null
  successAction?: boolean
}

function accountCanCover(account: Card, effectAmount: number) {
  if (effectAmount <= 0) return null

  if (account.card_type === 'banka_karti') {
    return !greaterThanTL(effectAmount, account.current_balance) ? null : 'Kaynak hesap bakiyesi yetersiz.'
  }

  const availableLimit = account.credit_limit > 0 ? diffTL(account.credit_limit, account.debt_amount) : null
  if (availableLimit !== null && greaterThanTL(effectAmount, availableLimit)) return 'Kredi kartı limiti yetersiz.'
  return null
}

export function AccountPaymentModal({
  open,
  title,
  accounts,
  selectedAccountId,
  onSelectedAccountChange,
  amountValue,
  onAmountValueChange,
  onClose,
  onSubmit,
  amountLabel = 'Tutar',
  accountLabel = 'Kaynak hesap',
  submitLabel,
  saving = false,
  externalError = '',
  amountEditable = true,
  amountActions,
  accountPreviewAmount,
  emptyMessage = 'Kullanılabilir banka hesabı yok.',
  info,
  extraControls,
  children,
  validate,
  successAction = false,
  paidAtEditable = false,
}: AccountPaymentModalProps) {
  const { formatAmount } = useBalancePrivacy()
  const [validationError, setValidationError] = useState('')
  const today = dateInputValue(new Date())
  const [paidAt, setPaidAt] = useState(today)
  const amount = useMemo(() => parseNumber(amountValue), [amountValue])
  const previewAmount = accountPreviewAmount?.(amount) ?? amount
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId)
  const displayedError = validationError || externalError

  function handleClose() {
    setValidationError('')
    onClose()
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidationError('')

    if (amount <= 0) {
      setValidationError('Tutar 0’dan büyük olmalı.')
      return
    }

    if (!selectedAccount) {
      setValidationError('Hesap seçmelisin.')
      return
    }

    const coverageError = accountCanCover(selectedAccount, previewAmount)
    if (coverageError) {
      setValidationError(coverageError)
      return
    }

    const customError = validate?.({ account: selectedAccount, amount })
    if (customError) {
      setValidationError(customError)
      return
    }

    if (paidAtEditable) {
      if (!paidAt) {
        setValidationError('Ödeme gününü seç.')
        return
      }
      if (paidAt > today) {
        setValidationError('Ödeme günü gelecekte olamaz.')
        return
      }
    }

    void onSubmit({ account: selectedAccount, amount, ...(paidAtEditable ? { paidAt } : {}) })
  }

  return (
    <SimpleModal title={title} open={open} onClose={handleClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {children ? (
          <div className="rounded-lg border border-line-strong bg-page p-3 text-sm text-ink-muted">
            {children}
          </div>
        ) : null}

        {paidAtEditable ? (
          <label className="block text-sm font-semibold text-ink">
            Ödeme günü
            <input
              type="date"
              value={paidAt}
              max={today}
              onChange={(event) => {
                setValidationError('')
                setPaidAt(event.target.value)
              }}
              className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm tabular-nums text-ink"
            />
            <span className="mt-1 block text-xs font-normal text-ink-muted">Varsayılan bugün; erken/geç ödediysen gerçek günü yaz.</span>
          </label>
        ) : null}

        {amountEditable ? (
          <div className="space-y-2">
            <MoneyInput label={amountLabel} value={amountValue} onValueChange={onAmountValueChange} required />
            {amountActions}
          </div>
        ) : (
          <div className="rounded-lg border border-line-strong bg-raised px-3 py-2.5">
            <p className="finance-label">{amountLabel}</p>
            <p className="finance-value mt-1 text-base font-black tabular-nums text-ink">{formatAmount(amount)}</p>
          </div>
        )}

        <AccountSelector
          accounts={accounts}
          value={selectedAccountId}
          onChange={(value) => {
            setValidationError('')
            onSelectedAccountChange(value)
          }}
          amount={previewAmount}
          label={accountLabel}
          emptyMessage={emptyMessage}
        />

        {extraControls}

        {info ? <Alert variant="success">{info}</Alert> : null}
        {displayedError ? <Alert variant="destructive">{displayedError}</Alert> : null}

        <Button type="submit" disabled={saving} variant={successAction ? 'success' : 'default'} size="xl" className="w-full">
          {saving ? 'İşleniyor...' : submitLabel}
        </Button>
      </form>
    </SimpleModal>
  )
}
