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

export function AccountSelector({
  accounts,
  value,
  onChange,
  amount = 0,
  label = 'Kaynak hesap',
  emptyMessage = 'Kullanılabilir banka hesabı yok.',
}: AccountSelectorProps) {
  const selectedAccount = accounts.find((account) => account.id === value)
  const remainingBalance = selectedAccount ? selectedAccount.current_balance - amount : null
  const hasInsufficientBalance = remainingBalance !== null && remainingBalance < 0
  const bestAccount = accounts
    .filter((account) => amount <= 0 || account.current_balance >= amount)
    .sort((left, right) => right.current_balance - left.current_balance)[0]

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
              {account.card_name} ({formatCurrency(account.current_balance)})
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
          Önerilen hesap: {bestAccount.card_name}
        </button>
      ) : null}
      {selectedAccount ? (
        <div
          className={`grid grid-cols-2 gap-2 rounded-xl px-3 py-2 text-xs ${
            hasInsufficientBalance
              ? 'bg-destructive/10 text-destructive'
              : 'bg-success/10 text-success'
          }`}
        >
          <span>Bakiye: {formatCurrency(selectedAccount.current_balance)}</span>
          <span>İşlem sonrası: {formatCurrency(remainingBalance)}</span>
        </div>
      ) : null}
    </div>
  )
}
