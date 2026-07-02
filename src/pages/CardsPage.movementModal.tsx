import { SimpleModal } from '../components/SimpleModal'
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
    <SimpleModal title={isTransfer ? 'Hesaplar arası transfer' : 'Para hareketi'} open={Boolean(card)} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{card?.card_name}</p>
          <p>Mevcut bakiye: {formatAmount(card?.current_balance ?? 0)}</p>
        </div>
        <label className="block text-sm font-semibold text-foreground">
          İşlem tipi
          <select
            value={type}
            onChange={(event) => onTypeChange(event.target.value as 'in' | 'out' | 'transfer')}
            className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
          >
            <option value="in">Para geldi</option>
            <option value="out">Para gitti</option>
            <option value="transfer" disabled={targetAccounts.length === 0}>
              {targetAccounts.length === 0 ? 'Hesaplar arası transfer (ikinci hesap gerekli)' : 'Hesaplar arası transfer'}
            </option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-foreground">
          Tutar
          <input
            required
            min="0"
            step="0.01"
            type="number"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-input px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
          />
        </label>
        {isTransfer ? (
          <>
            <label className="block text-sm font-semibold text-foreground">
              Hedef hesap
              <select
                required
                value={targetCardId}
                onChange={(event) => onTargetCardChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              >
                <option value="">{targetAccounts.length > 0 ? 'Hedef hesap seç' : 'Transfer için ikinci hesap gerekli'}</option>
                {targetAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} · {account.card_name} ({formatAmount(account.current_balance)})
                  </option>
                ))}
              </select>
            </label>
            {target ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Kaynak sonrası: {formatAmount(diffTL(card?.current_balance, amountValue))}
                </span>
                <span>Hedef sonrası: {formatAmount(sumTL([target.current_balance, amountValue]))}</span>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={saving}
          className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? 'İşleniyor...' : isTransfer ? 'Transferi tamamla' : 'Bakiyeyi güncelle'}
        </button>
      </form>
    </SimpleModal>
  )
}
