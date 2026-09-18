import { SimpleModal } from '../components/SimpleModal'
import { MoneyInput } from '../components/finance/MoneyInput'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/input'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Card } from '../types/database'
import { parseNumber } from '../utils/formatCurrency'
import { diffTL, sumTL } from '../utils/money'

export function MovementModal({
  card,
  type,
  amount,
  targetCardId,
  targetAccounts,
  error,
  saving,
  onClose,
  onTypeChange,
  onAmountChange,
  onTargetCardChange,
  onSubmit,
}: {
  card: Card | null
  type: 'in' | 'out' | 'transfer'
  amount: string
  targetCardId: string
  targetAccounts: Card[]
  error: string
  saving: boolean
  onClose: () => void
  onTypeChange: (value: 'in' | 'out' | 'transfer') => void
  onAmountChange: (value: string) => void
  onTargetCardChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const { formatAmount } = useBalancePrivacy()
  const isTransfer = type === 'transfer'
  const amountValue = parseNumber(amount)
  const target = targetAccounts.find((account) => account.id === targetCardId)

  return (
    <SimpleModal title={isTransfer ? 'Para aktar' : 'Para hareketi'} open={Boolean(card)} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-xl border border-line-strong bg-page p-3 text-sm text-ink-muted">
          <p className="font-semibold text-ink">{card?.card_name}</p>
          <p>Mevcut bakiye: {formatAmount(card?.current_balance ?? 0)}</p>
        </div>
        <label className="block text-sm font-semibold text-ink">
          İşlem tipi
          <Select
            value={type}
            onChange={(event) => onTypeChange(event.target.value as 'in' | 'out' | 'transfer')}
            className="mt-1"
          >
            <option value="in">Para geldi</option>
            <option value="out">Para gitti</option>
            <option value="transfer" disabled={targetAccounts.length === 0}>
              {targetAccounts.length === 0 ? 'Para aktar (ikinci kaynak gerekli)' : 'Para aktar'}
            </option>
          </Select>
        </label>
        <MoneyInput label="Tutar" value={amount} onValueChange={onAmountChange} required />
        {isTransfer ? (
          <>
            <label className="block text-sm font-semibold text-ink">
              Hedef
              <Select
                required
                value={targetCardId}
                onChange={(event) => onTargetCardChange(event.target.value)}
                className="mt-1"
              >
                <option value="">{targetAccounts.length > 0 ? 'Hedef hesap seç' : 'Transfer için ikinci hesap gerekli'}</option>
                {targetAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_kind === 'cash' ? 'Nakit' : account.bank_name} · {account.card_name} ({formatAmount(account.current_balance)})
                  </option>
                ))}
              </Select>
            </label>
            {target ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-page px-3 py-2 text-xs text-ink-muted">
                <span>
                  Kaynak sonrası: {formatAmount(diffTL(card?.current_balance, amountValue))}
                </span>
                <span>Hedef sonrası: {formatAmount(sumTL([target.current_balance, amountValue]))}</span>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p> : null}
        <Button
          type="submit"
          disabled={saving}
          className="h-12 w-full"
        >
          {saving ? 'İşleniyor...' : isTransfer ? 'Transferi tamamla' : 'Bakiyeyi güncelle'}
        </Button>
      </form>
    </SimpleModal>
  )
}
