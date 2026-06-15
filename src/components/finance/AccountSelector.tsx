import type { Card } from '../../types/database'
import { formatCurrency } from '../../utils/formatCurrency'
import { diffTL, sumTL } from '../../utils/money'
import { Select } from '../ui/input'

type AccountSelectorProps = {
  accounts: Card[]
  value: string
  onChange: (value: string) => void
  amount?: number
  label?: string
  emptyMessage?: string
}

export function AccountSelector({
  accounts,
  value,
  onChange,
  amount = 0,
  label = 'Kaynak hesap',
  emptyMessage = 'Kullanılabilir banka hesabı yok.',
}: AccountSelectorProps) {
  const selectedAccount = accounts.find((account) => account.id === value)
  const selectedIsCreditCard = selectedAccount?.card_type === 'kredi_karti'
  const remainingBalance = selectedAccount && !selectedIsCreditCard ? diffTL(selectedAccount.current_balance, amount) : null
  const nextDebtAmount = selectedAccount && selectedIsCreditCard ? sumTL([selectedAccount.debt_amount, amount]) : null
  const availableLimit = selectedAccount && selectedIsCreditCard && selectedAccount.credit_limit > 0
    ? diffTL(selectedAccount.credit_limit, selectedAccount.debt_amount)
    : null
  const nextAvailableLimit = availableLimit !== null ? diffTL(availableLimit, amount) : null
  const hasInsufficientBalance = remainingBalance !== null && remainingBalance < 0

  function getAccountOptionLabel(account: Card) {
    if (account.card_type === 'kredi_karti') {
      const limitLabel = account.credit_limit > 0 ? ` · Limit ${formatCurrency(account.credit_limit)}` : ''
      return `${account.card_name} (Kredi kartı · Borç ${formatCurrency(account.debt_amount)}${limitLabel})`
    }

    return `${account.card_name} (Banka hesabı · ${formatCurrency(account.current_balance)})`
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-sm font-semibold text-foreground">
        {label}
        <Select
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1"
        >
          <option value="">{accounts.length > 0 ? 'Hesap seç' : emptyMessage}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {getAccountOptionLabel(account)}
            </option>
          ))}
        </Select>
      </label>
      {selectedAccount ? (
        <div
          className={`grid grid-cols-2 gap-2 rounded-xl px-3 py-2 text-xs ${
            hasInsufficientBalance
              ? 'bg-destructive/10 text-destructive'
              : selectedIsCreditCard
                ? 'bg-primary/10 text-primary'
                : 'bg-success/10 text-success'
          }`}
        >
          {selectedIsCreditCard ? (
            <>
              <span>Borç: {formatCurrency(selectedAccount.debt_amount)}</span>
              <span>Sonrası: {formatCurrency(nextDebtAmount)}</span>
              {availableLimit !== null ? (
                <>
                  <span>Limit boşluğu: {formatCurrency(availableLimit)}</span>
                  <span>Sonrası: {formatCurrency(nextAvailableLimit)}</span>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span>Bakiye: {formatCurrency(selectedAccount.current_balance)}</span>
              <span>İşlem sonrası: {formatCurrency(remainingBalance)}</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
