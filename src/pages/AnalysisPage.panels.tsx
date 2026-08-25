import { CheckCircle2, Repeat, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { saveCrudRow } from '../data/repositories/crudRepo'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { SERIT_FILL, SERIT_TEXT, useSeritAmount } from '../components/serit'
import type { Budget, CardExpense, Debt } from '../types/database'
import { dateInputValue, daysUntil, formatDate, startOfMonth } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { getCurrentSalary } from '../utils/financeSummary'
import { analysisObligationsInput, formatMonth, type AnalysisData } from '../utils/analysisView'
import { buildBudgetUsage } from '../utils/budgetAlerts'
import { buildBudgetRollover, buildBudgetSuggestions } from '../utils/budgetAnchor'
import { formatPercent } from '../utils/formatCurrency'
import { PRICE_RADAR_MONTHS } from '../data/repositories/analysisRepo'
import { type PriceTrend } from '../utils/priceIncreaseRadar'
import { canCutCurrentStatement } from '../utils/statementCycle'
import { buildFinanceObligationsForMonth } from '../utils/obligations'

import {
  buildSubscriptionPaymentDraft,
  buildSubscriptionSummary,
  subscriptionAlreadyPlanned,
  type SubscriptionItem,
} from '../utils/subscriptions'
import { diffTL, sumTL } from '../utils/money'
import { StatPill } from './AnalysisPage.atoms'

export function UpcomingInstallments({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const upcoming = useMemo(() => {
    const cardsById = new Map(data.cards.map((card) => [card.id, card]))
    const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
    const monthKey = dateInputValue(startOfMonth())
    const cardItems = data.cardInstallments
      .filter((item) => item.status !== 'paid' && (item.status === 'scheduled' || item.due_month >= monthKey))
      .map((item) => {
        const isPastScheduled = item.status === 'scheduled' && item.due_month < monthKey
        const statusLabel = isPastScheduled ? 'Geçmiş dönem' : item.status === 'posted' ? 'Bu dönem' : 'Planlı'

        return {
          id: `card-${item.id}`,
          title: item.description,
          subtitle: `${cardsById.get(item.card_id)?.card_name ?? 'Kart'} · ${formatDate(item.due_month)} · ${item.installment_no}/${item.installment_count}`,
          amount: item.amount,
          sortDate: item.due_month,
          statusLabel,
          tone: isPastScheduled ? 'destructive' : item.status === 'posted' ? 'default' : 'secondary',
        }
      })
    const loanItems = data.loanInstallments
      .filter((item) => item.status === 'bekliyor')
      .map((item) => {
        const loan = loansById.get(item.loan_id)
        const remaining = daysUntil(item.due_date)
        const statusLabel = remaining !== null && remaining < 0 ? 'Gecikmiş' : remaining === 0 ? 'Bugün' : 'Bekliyor'

        return {
          id: `loan-${item.id}`,
          title: loan ? loan.loan_name : 'Kredi taksidi',
          subtitle: `${loan?.bank_name ?? 'Kredi'} · ${formatDate(item.due_date)} · ${item.installment_no}. taksit`,
          amount: item.amount,
          sortDate: item.due_date,
          statusLabel,
          tone: remaining !== null && remaining < 0 ? 'destructive' : 'outline',
        }
      })
    // Sayaç kesmeden ÖNCEKİ gerçek toplamı söyler; liste ilk 8'i gösterir.
    const all = [...cardItems, ...loanItems].sort((a, b) => a.sortDate.localeCompare(b.sortDate) || b.amount - a.amount)
    return { items: all.slice(0, 8), totalCount: all.length }
  }, [data.cards, data.loans, data.cardInstallments, data.loanInstallments])

  return (
    <Card className="border-line-strong lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Yaklaşan taksitler</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              {upcoming.totalCount} kart / kredi taksiti{upcoming.totalCount > 8 ? ' · ilk 8 gösteriliyor' : ''}
            </p>
          </div>
          <WalletCards className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {upcoming.items.length === 0 ? (
          <p className="rounded-xl bg-page p-3 text-sm text-ink-muted">Bekleyen kart veya kredi taksiti yok.</p>
        ) : (
          upcoming.items.map((item) => (
            <div key={item.id} className="rounded-xl bg-page px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-semibold text-ink">{item.title}</p>
                    <Badge variant={item.tone as 'default' | 'secondary' | 'destructive' | 'outline'}>{item.statusLabel}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {item.subtitle}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-page px-2 py-1 font-mono text-xs font-bold tabular-nums text-ink ring-1 ring-line-strong">
                  {formatAmount(item.amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function BudgetProgress({
  budgets,
  expenses,
  salary = null,
  onUpdateLimit,
  onRollover,
}: {
  budgets: Budget[]
  expenses: CardExpense[]
  /** Çıpalı limitlerin çözümü için güncel maaş (salary_pct). */
  salary?: number | null
  /** Verilirse bayat manual limitler için tek tık "Güncelle" önerisi görünür. */
  onUpdateLimit?: (budgetId: string, amount: number) => Promise<void>
  /** Verilirse "geçen ayın bütçelerini taşı" şeridi görünür (tek tık, toplu). */
  onRollover?: (rows: Budget[]) => Promise<void>
}) {
  const seritAmount = useSeritAmount()
  const [busyId, setBusyId] = useState<string | null>(null)
  const usage = useMemo(() => buildBudgetUsage(budgets, expenses, new Date(), salary), [budgets, expenses, salary])
  // Kimliği her render değişebilen callback yerine VARLIĞI deps'e girer;
  // öneriler yalnız veriye bağlıdır.
  const hasUpdateAction = Boolean(onUpdateLimit)
  const suggestions = useMemo(
    () => (hasUpdateAction ? buildBudgetSuggestions(budgets, expenses) : []),
    [budgets, expenses, hasUpdateAction],
  )
  const suggestionById = useMemo(() => new Map(suggestions.map((item) => [item.budgetId, item])), [suggestions])
  const rollover = useMemo(() => (onRollover ? buildBudgetRollover(budgets) : []), [budgets, onRollover])

  const [actionError, setActionError] = useState('')

  async function runAction(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusyId(null)
    }
  }

  if (usage.length === 0 && rollover.length === 0) {
    return <p className="text-[13px] text-ink-muted">Bu ay için bütçe eklediğinde kategori kullanımı burada görünecek.</p>
  }

  // Şerit (`4d`): kategori limitleri kutu değil satır. Ad + "harcanan / limit"
  // mono, altında 3px çubuk — aşımda danger, %80+ warning, altı brand.
  return (
    <div>
      {actionError ? (
        <p role="alert" className="mb-3 rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">
          {actionError}
        </p>
      ) : null}
      {/* Ay devri: uygulama kendiliğinden satır YARATMAZ; tek tık kullanıcıda. */}
      {rollover.length > 0 && onRollover ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2.5">
          <p className="text-xs font-semibold text-info">
            Geçen ayın {rollover.length} bütçesi bu aya taşınmadı.
          </p>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => void runAction('rollover', () => onRollover(rollover))}
            className="shrink-0 rounded-lg bg-info px-3 py-1.5 text-xs font-bold text-white transition hover:bg-info/90 disabled:opacity-60"
          >
            {busyId === 'rollover' ? 'Taşınıyor...' : 'Bu aya taşı'}
          </button>
        </div>
      ) : null}

      <div className="[&>*+*]:border-t [&>*+*]:border-line">
      {usage.map((budget) => {
        const tone = budget.status === 'over' ? 'danger' : budget.status === 'warning' ? 'warning' : 'brand'
        const suggestion = suggestionById.get(budget.budgetId)

        return (
          <div key={budget.budgetId} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-[14.5px] font-semibold text-ink">
                {budget.category}
                {budget.anchorLabel ? (
                  <span className="ml-2 align-middle text-[11px] font-semibold text-ink-faint">{budget.anchorLabel}</span>
                ) : null}
              </p>
              <p className="serit-num shrink-0 text-[13px] text-ink">
                {seritAmount(budget.spent).amount}
                <span className="text-ink-faint"> / {seritAmount(budget.limit).amount} ₺</span>
              </p>
            </div>

            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full transition-[width] duration-200 ease-out"
                style={{ width: `${Math.min(100, budget.usageRate)}%`, background: SERIT_FILL[tone] }}
              />
            </div>

            {budget.status === 'over' ? (
              <p className="mt-1.5 text-xs" style={{ color: SERIT_TEXT.danger }}>
                Limit {seritAmount(diffTL(budget.spent, budget.limit)).amount} ₺ aşıldı
              </p>
            ) : budget.status === 'warning' ? (
              <p className="mt-1.5 text-xs" style={{ color: SERIT_TEXT.warning }}>
                Limite yaklaşıyor · {formatPercent(budget.usageRate)}
              </p>
            ) : null}

            {/* Bayat limit önerisi (#159 çizgisi): sayı sessizce DEĞİŞMEZ. */}
            {suggestion && onUpdateLimit ? (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-muted">
                  Son 3 ayın ortası {seritAmount(suggestion.suggested).amount} ₺ — limiti güncelleyeyim mi?
                </p>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void runAction(budget.budgetId, () => onUpdateLimit(suggestion.budgetId, suggestion.suggested))}
                  className="shrink-0 rounded-lg border border-line-strong bg-raised px-2.5 py-1 text-xs font-bold text-ink transition hover:bg-black/[.03] disabled:opacity-60 dark:hover:bg-white/[.04]"
                >
                  {busyId === budget.budgetId ? 'Güncelleniyor...' : 'Güncelle'}
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
      </div>
    </div>
  )
}

export function PriceIncreaseRadar({ trends }: { trends: PriceTrend[] }) {
  const { formatAmount } = useBalancePrivacy()
  if (trends.length === 0) return null
  const visible = trends.slice(0, 6)

  return (
    <Card className="border-line-strong lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Zam radarı</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Düzenli gider ve aboneliklerinde zamanla artan kalemler (son {PRICE_RADAR_MONTHS - 1} ay).</p>
          </div>
          <TrendingUp size={18} className="text-ink-faint" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-3 min-[640px]:grid-cols-2">
        {visible.map((trend) => (
          <div
            key={trend.key}
            className="rounded-xl bg-warning/8 px-3 py-2.5 ring-1 ring-warning/25"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{trend.label}</p>
                {trend.category ? (
                  <p className="truncate text-[11px] text-ink-muted">{trend.category}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md bg-warning/18 px-1.5 py-0.5 text-xs font-bold text-warning">
                +%{Math.round(trend.changePct)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {formatAmount(trend.firstAmount)} → {formatAmount(trend.lastAmount)} · {trend.monthsSpan} ayda
              {trend.monthsSpan >= 3 ? ` · yıllık ~%${Math.round(trend.annualizedPct)}` : ''}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PeopleLedger({ debts }: { debts: Debt[] }) {
  const { formatAmount } = useBalancePrivacy()
  const rows = Array.from(
    debts
      .filter((debt) => debt.status === 'açık')
      .reduce((map, debt) => {
        const current = map.get(debt.person_name) ?? { person: debt.person_name, borrowed: 0, receivable: 0, count: 0 }
        if (debt.direction === 'borç_aldım') current.borrowed = sumTL([current.borrowed, debt.estimated_value_try])
        else current.receivable = sumTL([current.receivable, debt.estimated_value_try])
        current.count += 1
        map.set(debt.person_name, current)
        return map
      }, new Map<string, { person: string; borrowed: number; receivable: number; count: number }>()),
    ([, value]) => value,
  ).sort((a, b) => Math.abs(b.receivable - b.borrowed) - Math.abs(a.receivable - a.borrowed))

  return (
    <Card className="border-line-strong lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kişi bazlı bakiye</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">Açık borç ve alacakları kişi profili gibi oku.</p>
          </div>
          <Users className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {rows.length === 0 ? (
          <p className="rounded-xl bg-page p-3 text-sm text-ink-muted">Açık kişi borcu veya alacağı yok.</p>
        ) : (
          rows.slice(0, 6).map((row) => {
            const net = diffTL(row.receivable, row.borrowed)
            return (
              <div key={row.person} className="rounded-xl bg-page p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{row.person}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{row.count} açık kayıt</p>
                  </div>
                  <Badge variant={net >= 0 ? 'default' : 'destructive'}>{net >= 0 ? 'Alacak' : 'Borç'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <StatPill label="Alacak" value={formatAmount(row.receivable)} tone="emerald" />
                  <StatPill label="Borç" value={formatAmount(row.borrowed)} tone="rose" />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

export function MonthCloseAssistant({ data, missingTables }: { data: AnalysisData; missingTables: string[] }) {
  const { formatAmount } = useBalancePrivacy()
  // Pahalı türetmeler (yükümlülük inşası + bütçe×harcama taraması) memo'da:
  // eskiden her üst render'da baştan koşuyordu. Gün anahtarı deps'te — veri
  // değişmese de gün dönünce kesim/vade durumu yeniden değerlendirilir.
  const todayKey = dateInputValue(new Date())
  const summary = useMemo(() => {
    const monthKey = `${todayKey.slice(0, 7)}-01`
    const today = new Date()
    const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
    const statementDayPassedCards = creditCards.filter((card) => canCutCurrentStatement(card, data.cardStatementArchives, today))
    const staleInstallments = data.cardInstallments.filter((item) => item.status === 'scheduled' && item.due_month <= monthKey).length
    const currentMonthPaymentIds = new Set(
      buildFinanceObligationsForMonth(analysisObligationsInput(data), startOfMonth())
        .filter((item) => item.kind === 'payment')
        .map((item) => item.sourceId),
    )
    const openPaymentCount = data.payments.filter((payment) => currentMonthPaymentIds.has(payment.id) || (payment.status === 'bekliyor' && (daysUntil(payment.due_date) ?? 0) < 0)).length
    const currentSalary = getCurrentSalary(data.salaryHistory)
    // Bütçe aşımı buildBudgetUsage'tan okunur (tek kaynak): eskiden buradaki
    // elle kopya %80 uyarı eşiğinden habersizdi ve çıpalı limiti çözemezdi.
    const budgetOverruns = buildBudgetUsage(data.budgets, data.cardExpenses, today, currentSalary?.amount ?? null)
      .filter((usage) => usage.status === 'over' && usage.limit > 0).length
    return { monthKey, statementDayPassedCards, staleInstallments, openPaymentCount, budgetOverruns, currentSalary }
  }, [data, todayKey])
  const { monthKey, statementDayPassedCards, staleInstallments, openPaymentCount, budgetOverruns, currentSalary } = summary
  const checks = [
    { label: 'Ekstreler kontrol edildi', done: statementDayPassedCards.length === 0, detail: statementDayPassedCards.length > 0 ? `${statementDayPassedCards.length} kart bekliyor` : 'Kesim günü geçmiş açık dönem yok' },
    { label: 'Taksitler işlendi', done: staleInstallments === 0, detail: staleInstallments > 0 ? `${staleInstallments} taksit planlı kaldı` : 'Bu aya kadar planlı taksit yok' },
    { label: 'Maaş kaydı güncel', done: Boolean(currentSalary), detail: currentSalary ? formatAmount(currentSalary.amount ?? 0) : 'Maaş eklenmedi' },
    { label: 'Faturalar kapandı', done: openPaymentCount === 0, detail: openPaymentCount > 0 ? `${openPaymentCount} açık ödeme` : 'Açık vade görünmüyor' },
    { label: 'Bütçe aşımı yok', done: budgetOverruns === 0, detail: budgetOverruns > 0 ? `${budgetOverruns} kategori limit üstü` : 'Limitler sakin' },
    { label: 'Veri altyapısı hazır', done: missingTables.length === 0, detail: missingTables.length > 0 ? `${missingTables.length} migration bekliyor` : 'Tablolar erişilebilir' },
  ]
  const completed = checks.filter((check) => check.done).length

  return (
    <Card className="border-0 bg-raised text-ink ring-1 ring-line-strong lg:col-span-12">
      <CardContent className="grid gap-4 p-4 min-[760px]:grid-cols-[0.72fr_1.28fr] min-[760px]:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-success" />
            <h2 className="text-base font-extrabold">Ay kapanış asistanı</h2>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {formatMonth(monthKey)} için {completed}/{checks.length} kontrol tamam. Aylık rapor kartından PDF alabilirsin.
          </p>
        </div>
        <div className="grid gap-2 min-[560px]:grid-cols-2 min-[980px]:grid-cols-3">
          {checks.map((check) => (
            <div key={check.label} className={`rounded-lg px-3 py-2 ${check.done ? 'bg-success/10 text-success' : 'bg-page text-ink-muted'}`}>
              <p className="truncate text-xs font-bold">{check.label}</p>
              <p className="mt-0.5 truncate text-[11px] opacity-70">{check.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function SubscriptionsPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const salary = getCurrentSalary(data.salaryHistory)
  const result = useMemo(
    () => buildSubscriptionSummary(data.cardExpenses, data.payments, salary?.amount ?? null),
    [data.cardExpenses, data.payments, salary],
  )

  // Radar → plan köprüsü: tespit yalnız bilgiydi, tek tıkla obligations/
  // forecast'in gördüğü aylık ödemeye döner. Yalnız kredi kartı kaynaklı
  // satırlarda sunulur (bank_auto + kart = nakit 0, çift sayma yok).
  const creditCardIds = useMemo(
    () => new Set(data.cards.filter((card) => card.card_type === 'kredi_karti').map((card) => card.id)),
    [data.cards],
  )
  const [planBusyId, setPlanBusyId] = useState<string | null>(null)
  const [planError, setPlanError] = useState('')

  async function planSubscription(item: SubscriptionItem) {
    if (!user) return
    const draft = buildSubscriptionPaymentDraft(item, (cardId) => creditCardIds.has(cardId))
    if (!draft) return
    setPlanBusyId(item.id)
    setPlanError('')
    const saveResult = await saveCrudRow('payments', { user_id: user.id, ...draft }, null)
    setPlanBusyId(null)
    if (!saveResult.ok) {
      setPlanError(saveResult.error.message ?? 'Ödeme planı eklenemedi.')
      return
    }
    // Analiz verisi snapshot'tan gelir; payments tazelensin.
    void queryClient.invalidateQueries({ queryKey: ['finance-snapshot'] })
  }

  return (
    <Card className="border-line-strong lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Abonelik & sabit giderler</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              {result.items.filter((i) => i.isActive).length} aktif · toplam {formatAmount(result.monthlyTotal)}/ay
              {result.incomeRatio !== null ? ` · gelire oranı %${result.incomeRatio}` : ''}
            </p>
          </div>
          <Repeat className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {planError ? (
          <p role="alert" className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">
            {planError}
          </p>
        ) : null}
        {result.items.length === 0 ? (
          <p className="rounded-xl bg-page p-3 text-sm text-ink-muted">Tekrarlayan harcama veya ödeme tespit edilmedi.</p>
        ) : (
          result.items.slice(0, 8).map((item) => {
            const planned = item.source === 'recurring_expense' && subscriptionAlreadyPlanned(item, data.payments)
            const plannable =
              !planned &&
              item.isActive &&
              buildSubscriptionPaymentDraft(item, (cardId) => creditCardIds.has(cardId)) !== null
            return (
            <div key={item.id} className={`rounded-xl px-3 py-2 text-sm ${item.isActive ? 'bg-page' : 'bg-page opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {item.category}
                    {item.source === 'recurring_expense' ? ` · ${item.monthCount} aydır tekrarlıyor` : ' · planlı ödeme'}
                    {planned ? ' · planda' : ''}
                    {!item.isActive ? ' · durdurulmuş olabilir' : ''}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-page px-2 py-1 font-mono text-xs font-bold tabular-nums text-ink ring-1 ring-line-strong">
                  {formatAmount(item.amount)}
                </span>
              </div>
              {plannable ? (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-muted">Ödeme planına eklensin mi? Nakit takvimi ve hatırlatmalar görür.</p>
                  <button
                    type="button"
                    disabled={planBusyId !== null}
                    onClick={() => void planSubscription(item)}
                    className="shrink-0 rounded-lg border border-line-strong bg-raised px-2.5 py-1 text-xs font-bold text-ink transition hover:bg-black/[.03] disabled:opacity-60 dark:hover:bg-white/[.04]"
                  >
                    {planBusyId === item.id ? 'Ekleniyor...' : 'Planla'}
                  </button>
                </div>
              ) : null}
            </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
export function SchemaMigrationNotice({ missingTables }: { missingTables: string[] }) {
  if (missingTables.length === 0) return null

  const optionalTableLabels: Record<string, string> = {
    card_installments: 'kart taksitleri',
    card_statement_archives: 'ekstre arşivi',
    budgets: 'bütçeler',
    savings_goals: 'birikim hedefleri',
  }
  const labels = missingTables.map((table) => optionalTableLabels[table] ?? table).join(', ')

  return (
    <Card className="border-warning/25 bg-warning/8 lg:col-span-12">
      <CardContent className="p-4">
        <p className="text-sm font-bold text-warning">Canlı veritabanı migration bekliyor</p>
        <p className="mt-1 text-sm text-warning/80">
          {labels} tabloları henüz canlı Supabase tarafında görünmüyor. Ekranı kırmadan mevcut verilerle devam ediyorum.
        </p>
      </CardContent>
    </Card>
  )
}
