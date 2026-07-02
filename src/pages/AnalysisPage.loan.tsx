import { Banknote, Calculator, ShieldAlert, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { analysisFinanceSummaryInput, type AnalysisData } from '../utils/analysisView'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { buildLoanAffordability } from '../utils/loanAffordability'
import { StatPill } from './AnalysisPage.atoms'

const DECISION_LABEL = {
  suitable: 'Uygun',
  caution: 'Sınırda',
  not_recommended: 'Zorlayıcı',
} as const

const DECISION_BADGE = {
  suitable: 'success',
  caution: 'warning',
  not_recommended: 'destructive',
} as const

function pct(value: number) {
  return `%${Math.round(value * 100)}`
}

export function LoanAffordabilityPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const [requestedPrincipal, setRequestedPrincipal] = useState(100000)
  const [termMonths, setTermMonths] = useState(24)
  const [monthlyInterestRatePct, setMonthlyInterestRatePct] = useState(3.5)

  const result = useMemo(
    () =>
      buildLoanAffordability(analysisFinanceSummaryInput(data), {
        requestedPrincipal,
        termMonths,
        monthlyInterestRatePct,
      }),
    [data, requestedPrincipal, termMonths, monthlyInterestRatePct],
  )

  const decisionTone = result.decision === 'suitable' ? 'emerald' : result.decision === 'not_recommended' ? 'rose' : 'stone'
  const loadPct = Math.min(100, Math.round(result.requestedLoadRatio * 100))
  const maxMonthlyPayment = result.safeMonthlyPayment
  const recommendation = result.recommendation

  function applyRecommendation() {
    if (!recommendation) return
    setRequestedPrincipal(recommendation.principal)
    setTermMonths(recommendation.termMonths)
  }

  return (
    <Card className="border-border/70 lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kredi uygunluğu</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Mevcut nakit akışıyla yeni bir kredi taksidinin baskısını ölçer.</p>
          </div>
          <Badge variant={DECISION_BADGE[result.decision]}>{DECISION_LABEL[result.decision]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-4">
          <StatPill label="Güvenli taksit alanı" value={formatAmount(maxMonthlyPayment)} tone={maxMonthlyPayment > 0 ? 'emerald' : 'rose'} />
          <StatPill label="Tahmini maks. kredi" value={formatAmount(result.maxPrincipal)} tone={result.maxPrincipal > 0 ? 'emerald' : 'rose'} />
          <StatPill label="Seçilen kredi taksiti" value={formatAmount(result.requestedMonthlyPayment)} tone={decisionTone} />
          <StatPill label="Kredi sonrası yük" value={pct(result.requestedLoadRatio)} tone={decisionTone} />
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {result.decision === 'not_recommended' ? (
                <ShieldAlert size={16} className="shrink-0 text-destructive" />
              ) : (
                <Banknote size={16} className="shrink-0 text-primary" />
              )}
              <p className="text-sm font-semibold text-foreground">{result.summary}</p>
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
              mevcut yük {pct(result.currentLoadRatio)}
            </span>
          </div>
          <Progress value={loadPct} autoColor size="default" />
          <div className="mt-3 grid gap-2 min-[760px]:grid-cols-3">
            <StatPill label="Düzenli maaş" value={formatAmount(result.stableMonthlyIncome)} />
            <StatPill label="Ölçülen aylık yük" value={formatAmount(result.assessedMonthlyLoad)} />
            <StatPill label="Nakit tamponu" value={`${result.cashBufferMonths.toFixed(1)} ay`} tone={result.cashBufferMonths >= 1 ? 'emerald' : 'rose'} />
          </div>
        </div>

        {recommendation ? (
          <div className="rounded-xl border border-primary/20 bg-primary/8 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="shrink-0 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Önerilen dengeli senaryo</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{recommendation.rationale}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={applyRecommendation}>
                <Sparkles />
                Bu öneriyi dene
              </Button>
            </div>
            <div className="mt-3 grid gap-2 min-[560px]:grid-cols-4">
              <StatPill label="Önerilen tutar" value={formatAmount(recommendation.principal)} tone="emerald" />
              <StatPill label="Önerilen vade" value={`${recommendation.termMonths} ay`} />
              <StatPill label="Aylık taksit" value={formatAmount(recommendation.monthlyPayment)} tone="emerald" />
              <StatPill label="Toplam maliyet" value={formatAmount(recommendation.totalInterest)} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-warning/20 bg-warning/8 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-semibold text-foreground">Dengeli bir kredi önerisi üretilemedi.</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Düzenli gelir, nakit tamponu veya mevcut yük güvenli aralıkta olmadığında sistem otomatik tutar önermiyor.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-3 min-[760px]:grid-cols-3">
          <label className="rounded-xl bg-muted/40 p-3">
            <span className="finance-label">Denenecek kredi tutarı</span>
            <input
              type="number"
              min="0"
              step="5000"
              value={requestedPrincipal}
              onChange={(event) => setRequestedPrincipal(parseNumber(event.target.value))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Vade</span>
              <span className="text-sm font-bold tabular-nums text-foreground">{termMonths} ay</span>
            </div>
            <input
              type="range"
              min="3"
              max="60"
              step="3"
              value={termMonths}
              onChange={(event) => setTermMonths(Number(event.target.value))}
              aria-label="Kredi vadesi"
              className="mt-2 w-full accent-primary"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Aylık faiz</span>
              <span className="text-sm font-bold tabular-nums text-foreground">%{monthlyInterestRatePct.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="8"
              step="0.1"
              value={monthlyInterestRatePct}
              onChange={(event) => setMonthlyInterestRatePct(Number(event.target.value))}
              aria-label="Aylık faiz oranı"
              className="mt-2 w-full accent-primary"
            />
          </label>
        </div>

        <div className="grid gap-3 min-[720px]:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center gap-2">
              <Calculator size={15} className="text-muted-foreground" />
              <p className="finance-label">Seçilen kredi özeti</p>
            </div>
            <div className="mt-2 grid gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Toplam geri ödeme</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">{formatAmount(result.requestedTotalPayment)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tahmini faiz maliyeti</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">{formatAmount(result.requestedTotalInterest)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">En düşük stres bakiyesi</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {result.requestedStressLowestBalance === null ? '—' : formatAmount(result.requestedStressLowestBalance)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 p-3">
            <p className="finance-label">Kararı etkileyen sinyaller</p>
            <div className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
              {result.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              İlk taksit gelecek ay varsayılır. Banka kredi skoru, sigorta/masraf ve kampanya koşulları bu hesapta yoktur.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
