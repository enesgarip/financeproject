import { Check, Pencil, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { CashFlowSummary } from '../../utils/financeSummary'
import { buildSafeToSpend, DEFAULT_BUFFER } from '../../utils/safeToSpend'
import { Card, CardContent } from '../ui/card'
import { Progress } from '../ui/progress'

/**
 * Uygulamanın TEK sayısı: "bu ay rahatça ne kadar harcayabilirim?"
 * Diğer paneller durumu anlatır; bu panel izin verir. Tampon cihaz tercihi
 * olduğu için localStorage'da tutulur (tek kullanıcı, sunucuya taşımaya değmez).
 */

const BUFFER_KEY = 'denge:safe-to-spend-buffer'

function readBuffer(): number {
  const raw = localStorage.getItem(BUFFER_KEY)
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUFFER
}

export function SafeToSpendCard({ cashFlow, liquidCash }: { cashFlow: CashFlowSummary; liquidCash: number }) {
  const { formatAmount } = useBalancePrivacy()
  const [buffer, setBuffer] = useState(readBuffer)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const result = buildSafeToSpend({
    liquidCash,
    expectedIncome: cashFlow.expectedIncome,
    remainingOutflow: cashFlow.remainingOutflow,
    buffer,
  })

  function saveBuffer() {
    const parsed = Number(draft.replace(/\./g, '').replace(',', '.'))
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : buffer
    setBuffer(next)
    localStorage.setItem(BUFFER_KEY, String(next))
    setEditing(false)
  }

  // Yalnız gerçek açık (yükümlülük > para) kırmızıdır; tampondan kaynaklanan
  // negatiflik boş/yeni hesapta sahte alarm olur.
  const tone =
    result.negativeCause === 'obligations' ? 'danger' : result.pressurePct >= 85 || result.isNegative ? 'warning' : 'good'

  return (
    <Card
      variant="elevated"
      className={`overflow-hidden ${
        tone === 'danger' ? 'border-destructive/25' : tone === 'warning' ? 'border-warning/25' : 'border-success/25'
      }`}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Bu ay harcanabilir</p>
            <p
              className={`finance-value mt-1.5 text-[clamp(1.85rem,7.5vw,2.75rem)] font-black leading-none ${
                result.negativeCause === 'obligations' ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {formatAmount(result.amount)}
            </p>
          </div>
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${
              tone === 'danger'
                ? 'bg-destructive/12 text-destructive'
                : tone === 'warning'
                  ? 'bg-warning/12 text-warning'
                  : 'bg-success/12 text-success'
            }`}
          >
            <Wallet className="size-5" />
          </span>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {result.negativeCause === 'obligations'
            ? 'Bu ayın kalan yükümlülükleri eldeki parayı aşıyor — büyük harcamayı ertele veya tahsilatı öne al.'
            : result.negativeCause === 'buffer'
              ? 'Bu ay planlı yükümlülük yok; tutar tamponunun altında kaldığı için negatif görünüyor.'
              : `Likit para ve kalan gelirden bu ayın kalan yükümlülükleri (${formatAmount(cashFlow.remainingOutflow)}) ve tamponun düşüldü.`}
        </p>

        <div className="mt-3">
          <Progress value={Math.min(100, result.pressurePct)} autoColor size="sm" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Kalan yükümlülük, kullanılabilir paranın %{result.pressurePct}'i
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/45 px-3 py-2">
          <span className="text-xs text-muted-foreground">Güvenlik tamponu</span>
          {editing ? (
            <span className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveBuffer()
                  if (event.key === 'Escape') setEditing(false)
                }}
                aria-label="Güvenlik tamponu tutarı"
                className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
              <button
                type="button"
                onClick={saveBuffer}
                aria-label="Tamponu kaydet"
                className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground"
              >
                <Check size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(String(buffer))
                setEditing(true)
              }}
              className="-my-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-bold tabular-nums text-foreground hover:bg-muted"
            >
              {formatAmount(buffer)}
              <Pencil size={12} className="text-muted-foreground" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
