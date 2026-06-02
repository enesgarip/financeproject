import type { Card } from '../../types/database'
import { formatCurrency } from '../../utils/formatCurrency'
import { Select } from '../ui/input'

type AccountSelectorProps = {
  accounts: Card[]
  value: string
  onChange: (value: string) => void
  amount?: number
  label?: string
  emptyMessage?: string
}

function accountDisplayName(account: Card) {
  return account.bank_name ? `${account.bank_name} · ${account.card_name}` : account.card_name
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
  const remainingBalance = selectedAccount && !selectedIsCreditCard ? selectedAccount.current_balance - amount : null
  const nextDebtAmount = selectedAccount && selectedIsCreditCard ? selectedAccount.debt_amount + amount : null
  const availableLimit = selectedAccount && selectedIsCreditCard && selectedAccount.credit_limit > 0
    ? selectedAccount.credit_limit - selectedAccount.debt_amount
    : null
  const nextAvailableLimit = availableLimit !== null ? availableLimit - amount : null
  const hasInsufficientBalance = remainingBalance !== null && remainingBalance < 0
  const bestAccount = accounts
    .filter((account) => account.card_type === 'kredi_karti' || amount <= 0 || account.current_balance >= amount)
    .sort((left, right) => {
      const leftScore = left.card_type === 'kredi_karti' ? left.credit_limit - left.debt_amount : left.current_balance
      const rightScore = right.card_type === 'kredi_karti' ? right.credit_limit - right.debt_amount : right.current_balance
      return rightScore - leftScore
    })[0]

  function getAccountOptionLabel(account: Card) {
    if (account.card_type === 'kredi_karti') {
      const limitLabel = account.credit_limit > 0 ? ` · Limit ${formatCurrency(account.credit_limit)}` : ''
      return `${account.card_name} (Kredi kartı · Borç ${formatCurrency(account.debt_amount)}${limitLabel})`
    }

    return `${account.card_name} (Banka hesabı · ${formatCurrency(account.current_balance)})`
  }

  return (
    <div className="space-y-2">
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
      {bestAccount && !value ? (
        <button
          type="button"
          onClick={() => onChange(bestAccount.id)}
          className="inline-flex w-fit rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary ring-1 ring-primary/15 transition hover:bg-primary/15"
        >
          Önerilen hesap: {accountDisplayName(bestAccount)}
        </button>
      ) : null}
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
