import { useMemo, useState, type ReactNode } from 'react'
import type { Card } from '../../types/database'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import { diffTL, greaterThanTL } from '../../utils/money'
import { SimpleModal } from '../SimpleModal'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { AccountSelector } from './AccountSelector'
import { MoneyInput } from './MoneyInput'

type AccountPaymentSubmit = {
  account: Card
  amount: number
}

type AccountPaymentModalProps = {
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
  accountPreviewAmount?: (amount: number) => number
  emptyMessage?: string
  info?: ReactNode
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
  accountPreviewAmount,
  emptyMessage = 'Kullanılabilir banka hesabı yok.',
  info,
  children,
  validate,
  successAction = false,
}: AccountPaymentModalProps) {
  const [validationError, setValidationError] = useState('')
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

    void onSubmit({ account: selectedAccount, amount })
  }

  return (
    <SimpleModal title={title} open={open} onClose={handleClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {children ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            {children}
          </div>
        ) : null}

        {amountEditable ? (
          <MoneyInput label={amountLabel} value={amountValue} onValueChange={onAmountValueChange} required />
        ) : (
          <div className="rounded-lg border border-border/60 bg-card/80 px-3 py-2.5">
            <p className="finance-label">{amountLabel}</p>
            <p className="finance-value mt-1 text-base font-black tabular-nums text-foreground">{formatCurrency(amount)}</p>
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

        {info ? <Alert variant="success">{info}</Alert> : null}
        {displayedError ? <Alert variant="destructive">{displayedError}</Alert> : null}

        <Button type="submit" disabled={saving} variant={successAction ? 'success' : 'default'} size="xl" className="w-full">
          {saving ? 'İşleniyor...' : submitLabel}
        </Button>
      </form>
    </SimpleModal>
  )
}
