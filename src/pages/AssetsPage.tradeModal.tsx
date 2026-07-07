import type { FormEvent } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { SimpleModal } from '../components/SimpleModal'
import { Alert } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { CurrencyInput, Input, Select, Textarea } from '../components/ui/input'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Asset, Card } from '../types/database'
import { formatNumber, parseNumber } from '../utils/formatCurrency'
import { diffTL, greaterThanTL, sumTL } from '../utils/money'
import { assetTradeRequiresQuantity, type AssetTradeDirection } from '../services/assetTrades'

export type AssetTradeDraft = {
  asset: Asset
  direction: AssetTradeDirection
}

function assetTradeShowsQuantity(asset: Asset): boolean {
  return asset.category === 'Hisse' || asset.category === 'Fon' || (asset.category === 'Nakit' && asset.currency !== null && asset.currency !== 'TRY')
}

function quantityLabel(asset: Asset): string {
  if (asset.category === 'Hisse') return 'Adet'
  if (asset.category === 'Fon') return 'Pay / adet'
  if (asset.category === 'Nakit' && asset.currency && asset.currency !== 'TRY') return `${asset.currency} tutarı`
  return 'Miktar'
}

function quantityValueLabel(asset: Asset): string | null {
  if (!assetTradeShowsQuantity(asset)) return null
  const suffix = asset.category === 'Hisse' ? 'adet' : asset.category === 'Fon' ? 'pay' : asset.currency ?? asset.unit
  return `${formatNumber(asset.amount)} ${suffix}`
}

export function AssetTradeModal({
  trade,
  accounts,
  accountId,
  amount,
  quantity,
  note,
  error,
  saving,
  onClose,
  onAccountChange,
  onAmountChange,
  onQuantityChange,
  onNoteChange,
  onSubmit,
}: {
  trade: AssetTradeDraft | null
  accounts: Card[]
  accountId: string
  amount: string
  quantity: string
  note: string
  error: string
  saving: boolean
  onClose: () => void
  onAccountChange: (value: string) => void
  onAmountChange: (value: string) => void
  onQuantityChange: (value: string) => void
  onNoteChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const { formatAmount } = useBalancePrivacy()
  const asset = trade?.asset ?? null
  const direction = trade?.direction ?? 'buy'
  const isBuy = direction === 'buy'
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null
  const amountValue = parseNumber(amount)
  const nextAssetValue = asset
    ? isBuy
      ? sumTL([asset.estimated_value_try, amountValue])
      : greaterThanTL(amountValue, asset.estimated_value_try)
        ? 0
        : diffTL(asset.estimated_value_try, amountValue)
    : 0
  const nextAccountBalance = selectedAccount
    ? isBuy
      ? diffTL(selectedAccount.current_balance, amountValue)
      : sumTL([selectedAccount.current_balance, amountValue])
    : null
  const currentQuantity = asset ? quantityValueLabel(asset) : null
  const QuantityIcon = isBuy ? ArrowUpRight : ArrowDownRight

  return (
    <SimpleModal title={asset ? `${asset.name} ${isBuy ? 'al' : 'sat'}` : 'Varlık işlemi'} open={Boolean(trade)} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        {asset ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{asset.name}</p>
                <p>{asset.category}</p>
              </div>
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <QuantityIcon size={17} />
              </div>
            </div>
            <div className="mt-3 grid gap-2 min-[420px]:grid-cols-2">
              <span>Mevcut değer: {formatAmount(asset.estimated_value_try)}</span>
              {currentQuantity ? <span>Mevcut miktar: {currentQuantity}</span> : null}
            </div>
          </div>
        ) : null}

        <label className="block text-sm font-semibold text-foreground">
          {isBuy ? 'Kaynak hesap' : 'Tahsilat hesabı'}
          <Select
            required
            value={accountId}
            onChange={(event) => onAccountChange(event.target.value)}
            className="mt-1"
            disabled={accounts.length === 0}
          >
            <option value="">{accounts.length > 0 ? 'Hesap seç' : 'Banka hesabı yok'}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bank_name} · {account.card_name} ({formatAmount(account.current_balance)})
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm font-semibold text-foreground">
          İşlem tutarı
          <CurrencyInput
            required
            min="0"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="mt-1"
          />
        </label>

        {asset && assetTradeShowsQuantity(asset) ? (
          <label className="block text-sm font-semibold text-foreground">
            {quantityLabel(asset)}
            {assetTradeRequiresQuantity(asset) ? <span className="text-destructive"> *</span> : null}
            <Input
              required={assetTradeRequiresQuantity(asset)}
              min="0"
              step={asset.category === 'Hisse' ? '1' : '0.01'}
              type="number"
              value={quantity}
              onChange={(event) => onQuantityChange(event.target.value)}
              className="mt-1"
            />
          </label>
        ) : null}

        <label className="block text-sm font-semibold text-foreground">
          Not
          <Textarea rows={2} value={note} onChange={(event) => onNoteChange(event.target.value)} className="mt-1" />
        </label>

        {selectedAccount && asset ? (
          <div className="grid gap-2 rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground min-[420px]:grid-cols-2">
            <span>{isBuy ? 'Hesap sonrası' : 'Tahsilat sonrası'}: {formatAmount(nextAccountBalance)}</span>
            <span>Varlık sonrası: {formatAmount(nextAssetValue)}</span>
          </div>
        ) : null}

        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <Button type="submit" disabled={saving || !asset || accounts.length === 0} className="h-12 w-full">
          {saving ? 'İşleniyor...' : isBuy ? 'Alımı tamamla' : 'Satışı tamamla'}
        </Button>
      </form>
    </SimpleModal>
  )
}
