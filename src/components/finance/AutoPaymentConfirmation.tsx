import { Check, CheckCheck, CreditCard, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { AutoPayResult } from '../../utils/autoPayment'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'

type Props = {
  results: AutoPayResult[]
  onDismiss: (paymentId: string) => void
  onDismissAll: () => void
  onAdjust: (paymentId: string, cardId: string, oldAmount: number, newAmount: number) => Promise<void>
}

function AutoPayRow({
  result,
  onDismiss,
  onAdjust,
  formatAmount,
}: {
  result: AutoPayResult
  onDismiss: () => void
  onAdjust: (newAmount: number) => Promise<void>
  formatAmount: (v: number) => string
}) {
  const [editing, setEditing] = useState(false)
  const [newAmount, setNewAmount] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const parsed = parseNumber(newAmount)
    if (parsed == null || parsed <= 0) return
    setSaving(true)
    await onAdjust(parsed)
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{result.paymentTitle}</p>
            <p className="text-xs text-muted-foreground">
              {result.cardName} · Vade {formatDate(result.dueDate)} · {result.category}
            </p>
          </div>
        </div>
        <span className="font-semibold whitespace-nowrap">{formatAmount(result.amount)}</span>
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Doğru tutar"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            className="h-8 w-32"
            autoFocus
          />
          <Button size="sm" variant="default" onClick={handleSave} disabled={saving}>
            {saving ? '...' : 'Kaydet'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            İptal
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onDismiss}>
            <Check className="mr-1 h-3 w-3" />
            Doğru
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setNewAmount(String(result.amount)); setEditing(true) }}>
            <Pencil className="mr-1 h-3 w-3" />
            Tutarı düzelt
          </Button>
        </div>
      )}
    </div>
  )
}

export function AutoPaymentConfirmation({ results, onDismiss, onDismissAll, onAdjust }: Props) {
  const { formatAmount } = useBalancePrivacy()

  if (results.length === 0) return null

  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="secondary">{results.length}</Badge>
            Otomatik ödeme kartına eklendi
          </CardTitle>
          {results.length > 1 && (
            <Button size="sm" variant="ghost" onClick={onDismissAll}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Tümü doğru
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Vadesi gelen fatura/abonelikler kredi kartına eklendi. Tutarlar doğru mu?
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {results.map((r) => (
          <AutoPayRow
            key={r.paymentId}
            result={r}
            onDismiss={() => onDismiss(r.paymentId)}
            onAdjust={(newAmount) => onAdjust(r.paymentId, r.cardId, r.amount, newAmount)}
            formatAmount={formatAmount}
          />
        ))}
      </CardContent>
    </Card>
  )
}
