import type { Card } from '../../types/database'
import { formatCurrency } from '../../utils/formatCurrency'

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
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
        {label}
        <select
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        >
          <option value="">{accounts.length > 0 ? 'Hesap seç' : emptyMessage}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.card_name} ({formatCurrency(account.current_balance)})
            </option>
          ))}
        </select>
      </label>
      {bestAccount && !value ? (
        <button
          type="button"
          onClick={() => onChange(bestAccount.id)}
          className="inline-flex w-fit rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/70"
        >
          Önerilen hesap: {bestAccount.card_name}
        </button>
      ) : null}
      {selectedAccount ? (
        <div
          className={`grid grid-cols-2 gap-2 rounded-xl px-3 py-2 text-xs ${
            hasInsufficientBalance
              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
              : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100'
          }`}
        >
          <span>Bakiye: {formatCurrency(selectedAccount.current_balance)}</span>
          <span>İşlem sonrası: {formatCurrency(remainingBalance)}</span>
        </div>
      ) : null}
    </div>
  )
}
