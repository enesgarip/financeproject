import { CircleAlert, CircleCheck, CircleX, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { useKasaReserved } from '../hooks/useSafeToSpend'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { buildCashFlowForecast } from '../utils/cashFlowForecast'
import { buildMonthlyCashFlow, buildFinancialPosition } from '../utils/financeSummary'
import { buildPurchaseImpact, type PurchasePaymentMethod, type PurchaseVerdict } from '../utils/purchaseImpact'
import { buildSafeToSpend, DEFAULT_BUFFER } from '../utils/safeToSpend'

/**
 * Karar anı ekranı: "bunu alsam ne olur?" Mağazada telefonda 10 saniyede
 * cevap vermek için mobil öncelikli, tek ekran, tek soru.
 * Yeni matematik yok — mevcut projeksiyon (cashFlowForecast) ve harcanabilir
 * tutar (safeToSpend) üzerine kurulu.
 */

const BUFFER_KEY = 'denge:safe-to-spend-buffer'
const INSTALLMENT_PRESETS = [1, 3, 6, 9, 12]
const HORIZON_MONTHS = 6

function readBuffer(): number {
  const raw = localStorage.getItem(BUFFER_KEY)
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUFFER
}

const VERDICT_PRESENTATION: Record<PurchaseVerdict, { label: string; className: string; Icon: typeof CircleCheck }> = {
  rahat: { label: 'Rahatlıkla alabilirsin', className: 'border-success/30 bg-success/8 text-success', Icon: CircleCheck },
  dikkat: { label: 'Alabilirsin ama dikkat', className: 'border-warning/30 bg-warning/8 text-warning', Icon: CircleAlert },
  zorlayici: { label: 'Bu ay zorlar', className: 'border-destructive/30 bg-destructive/8 text-destructive', Icon: CircleX },
}

export function PurchaseDecisionPage() {
  const { formatAmount } = useBalancePrivacy()
  const snapshotQuery = useFinanceSnapshot()
  const [amountInput, setAmountInput] = useState('')
  const [installments, setInstallments] = useState(1)
  const [method, setMethod] = useState<PurchasePaymentMethod>('card')

  const amount = Number(amountInput.replace(/\./g, '').replace(',', '.'))
  const hasAmount = Number.isFinite(amount) && amount > 0
  const { reserved, reservedKnown } = useKasaReserved()

  const impact = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot || !hasAmount) return null

    const summaryInput = {
      assets: snapshot.assets,
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: snapshot.loanInstallments,
      debts: snapshot.debts,
      payments: snapshot.payments,
      salaryHistory: snapshot.salaryHistory,
      cardInstallments: snapshot.cardInstallments,
      cardStatements: snapshot.cardStatements,
    }

    const forecast = buildCashFlowForecast(summaryInput, { horizonMonths: HORIZON_MONTHS })
    const cashFlow = buildMonthlyCashFlow(summaryInput)
    const buffer = readBuffer()
    const safe = buildSafeToSpend({
      liquidCash: buildFinancialPosition(summaryInput).totalCashAssets,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer,
      // Kasa rezervi burada düşülmüyordu: kararın verildiği ekran harcanabilir
      // tutarı ayrılmış rezerv kadar FAZLA gösteriyor, üstelik Dashboard'daki
      // aynı isimli sayıdan farklı çıkıyordu (Faz D4).
      reserved,
    })

    return buildPurchaseImpact({
      amount,
      installments,
      method,
      forecast,
      safeToSpend: safe.amount,
      buffer,
    })
  }, [snapshotQuery.data, hasAmount, amount, installments, method, reserved])

  const verdict = impact ? VERDICT_PRESENTATION[impact.verdict] : null

  return (
    <section className="mx-auto min-w-0 max-w-xl space-y-4">
      <p className="text-[13px] text-ink-muted">
        Tutarı ve ödeme şeklini seç; önümüzdeki altı aya etkisini birkaç saniyede gör.
      </p>
      <Card variant="elevated" className="border-primary/20">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
              <ShoppingCart className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-black text-foreground">Bunu alsam ne olur?</p>
              <p className="text-xs text-muted-foreground">Tutarı yaz, önümüzdeki {HORIZON_MONTHS} ayı gör.</p>
            </div>
          </div>

          <Input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            placeholder="Tutar (TL)"
            aria-label="Alışveriş tutarı"
            autoFocus
            className="finance-value mt-4 h-14 w-full bg-background px-4 text-center text-2xl font-bold tabular-nums"
          />

          <div className="mt-3">
            <p className="finance-label">Taksit</p>
            <div className="mt-1.5 grid grid-cols-5 gap-1.5">
              {INSTALLMENT_PRESETS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setInstallments(count)}
                  className={`min-h-11 rounded-lg text-sm font-bold ring-1 transition ${
                    installments === count
                      ? 'bg-primary text-primary-foreground ring-primary'
                      : 'bg-card text-foreground ring-border hover:bg-muted'
                  }`}
                >
                  {count === 1 ? 'Peşin' : count}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <p className="finance-label">Nasıl</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(['card', 'cash'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMethod(value)
                    if (value === 'cash') setInstallments(1)
                  }}
                  className={`min-h-11 rounded-lg text-sm font-bold ring-1 transition ${
                    method === value
                      ? 'bg-primary text-primary-foreground ring-primary'
                      : 'bg-card text-foreground ring-border hover:bg-muted'
                  }`}
                >
                  {value === 'card' ? 'Kredi kartı' : 'Nakit / banka'}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {snapshotQuery.isPending ? (
        <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Veriler yükleniyor...</p>
      ) : null}

      {impact && verdict ? (
        <>
          <div className={`rounded-2xl border p-4 ${verdict.className}`}>
            <div className="flex items-start gap-2.5">
              <verdict.Icon className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-base font-black">{verdict.label}</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {impact.reasons.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <Card className="border-border/70">
            <CardContent className="p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-muted/45 px-3 py-2.5">
                  <p className="finance-label truncate">Aylık taksit</p>
                  <p className="finance-value mt-1 truncate text-sm font-bold text-foreground">
                    {formatAmount(impact.monthlyInstallment)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/45 px-3 py-2.5">
                  <p className="finance-label truncate">Sonra harcanabilir</p>
                  <p
                    className={`finance-value mt-1 truncate text-sm font-bold ${
                      impact.safeToSpendAfter < 0 ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {formatAmount(impact.safeToSpendAfter)}
                  </p>
                </div>
              </div>

              <p className="mt-4 finance-label">Aylık bakiye projeksiyonu</p>
              <div className="mt-1.5 space-y-1.5">
                {impact.months.map((month) => (
                  <div key={month.label} className="flex items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">{month.label}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <span className="text-xs text-muted-foreground line-through">{formatAmount(month.before)}</span>
                      <span className={`font-bold ${month.after < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {formatAmount(month.after)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-muted-foreground">
                Kartla alımda ilk taksit bir sonraki ekstrede nakit çıkışına dönüşür; bu yüzden bu ayın bakiyesi değişmez.
              </p>
              {!reservedKnown ? (
                <p className="mt-2 text-[11px] font-semibold text-warning">
                  Kasa rezervi doğrulanamadı — harcanabilir tutar rezerv düşülmeden hesaplandı, gerçekte daha düşük olabilir.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {!hasAmount && !snapshotQuery.isPending ? (
        <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          Tutarı yazınca kararı hesaplarım.
        </p>
      ) : null}
    </section>
  )
}
