import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { CrudPage, type FormField } from '../components/CrudPage'
import { saveCrudRow } from '../data/repositories/crudRepo'
import { fetchAccountEventsSince } from '../data/repositories/financePanelsRepo'
import { KasaModuPanel } from '../components/finance/KasaModuPanel'
import { SavingsGoalsPanel } from '../components/finance/SavingsGoalsPanel'
import { QueryError } from '../components/ui/query-error'
import { SkeletonCard, SkeletonHero } from '../components/ui/skeleton'
import type { Budget } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, endOfMonth, formatDate, startOfMonth } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { formatMonth } from '../utils/analysisView'
import { averageCategorySpend, budgetAnchorLabel, resolveBudgetRows } from '../utils/budgetAnchor'
import { buildFinancialPosition, buildMonthlyCashFlow, getCurrentSalary } from '../utils/financeSummary'
import { buildSafeToSpend } from '../utils/safeToSpend'
import { readSafeToSpendBuffer, useKasaBuckets, useKasaReserved } from '../hooks/useSafeToSpend'
import { bucketForGoal, isSameMonth } from '../utils/goalBucket'
import { findSalaryChangeCandidate, findSalaryDeposit } from '../utils/salaryDeposit'
import { SERIT_FILL, useSeritAmount, type SeritTone } from '../components/serit'
import { buildBudgetUsage } from '../utils/budgetAlerts'
import { averageMonthlyOutflow } from '../utils/goalTargetAnchor'
import { roundTL, sumTL } from '../utils/money'
import { BudgetProgress } from './AnalysisPage.panels'

/** Limit kuralı seçenekleri; maaş yüzdesi yalnız maaş kaydı varken sunulur
 *  (#157 çizgisi: veri yokken çıpa kaydetmek yerine seçenek hiç açılmaz). */
const ANCHOR_BASE_OPTIONS = [
  { value: 'manual', label: 'Sabit tutar' },
  { value: 'avg_spend', label: 'Son 3 ay ortalaması × çarpan' },
]
const SALARY_ANCHOR_OPTION = { value: 'salary_pct', label: 'Maaşın yüzdesi' }

function isAnchored(values: Record<string, string>) {
  return values.limit_anchor === 'avg_spend' || values.limit_anchor === 'salary_pct'
}

function monthStartValue(value: FormDataEntryValue | null) {
  const date = value ? new Date(`${String(value)}T00:00:00`) : new Date()
  return dateInputValue(startOfMonth(Number.isNaN(date.getTime()) ? new Date() : date))
}

export function PlanningPage() {
  const { formatAmount } = useBalancePrivacy()
  const snapshotQuery = useFinanceSnapshot()
  const seritAmount = useSeritAmount()
  const loading = snapshotQuery.isPending

  const missingTables = useMemo(
    () => snapshotQuery.data?.missingTables ?? [],
    [snapshotQuery.data],
  )

  const cardExpenses = useMemo(
    () => snapshotQuery.data?.cardExpenses ?? [],
    [snapshotQuery.data],
  )

  // Likit nakit (banka + nakit varlık) ve bu ayki harcanabilir (safeToSpend).
  // Likit → kasa modu kova hesabı; surplus → birikim önerisi "ayır / ara ver" bağlamı.
  // Dashboard kahraman rakamıyla aynı hesap: tampon VE kasa rezervi birlikte
  // düşülür. Rezerv burada eksikti, yani aynı isimli sayı Dashboard'dakinden
  // ayrılmış rezerv kadar fazla çıkıyordu (Faz D4).
  const { reserved } = useKasaReserved()
  const { liquidCash, monthlySurplus } = useMemo(() => {
    const data = snapshotQuery.data
    if (!data) return { liquidCash: 0, monthlySurplus: undefined as number | undefined }
    const position = buildFinancialPosition(data)
    const cashFlow = buildMonthlyCashFlow(data)
    const surplus = buildSafeToSpend({
      liquidCash: position.totalCashAssets,
      expectedIncome: cashFlow.expectedIncome,
      remainingOutflow: cashFlow.remainingOutflow,
      buffer: readSafeToSpendBuffer(),
      reserved,
    }).amount
    return { liquidCash: position.totalCashAssets, monthlySurplus: surplus }
  }, [snapshotQuery.data, reserved])

  /**
   * "N aylık gider" çıpalı hedefin dayanağı: gerçekleşen aylık nakit çıkışının
   * ortalaması (cari ay hariç). Projeksiyon değil, geçmiş — acil fon hedefi
   * tahmine değil, gerçekten harcadığın paraya dayansın.
   */
  const monthlyOutflow = useMemo(() => {
    const data = snapshotQuery.data
    if (!data) return 0
    return averageMonthlyOutflow(data.transactionHistory, data.payments, data.cards)
  }, [snapshotQuery.data])

  const { user } = useAuth()
  const userId = user?.id

  /** salary_pct çıpasının dayanağı: salary_history'nin bugünkü satırı. */
  const salaryAmount = useMemo(
    () => getCurrentSalary(snapshotQuery.data?.salaryHistory ?? [])?.amount ?? null,
    [snapshotQuery.data],
  )

  // Maaş günü şeridi: ayın ilk ~12 gününde, hesaba maaşa benzeyen giriş
  // düştüyse ve ayırması yapılmamış hedef kovası varsa tek satırlık dürtü.
  // Push'un ikizi ama uygulama İÇİ halkası: sessiz saat push'u sustursa da
  // kullanıcı sayfaya girince aynı sinyali görür. Tespit ±%10 bandıyla
  // (utils/salaryDeposit); sorgu yalnız pencere açıkken atılır.
  const todayDay = new Date().getDate()
  const monthStartIso = dateInputValue(startOfMonth())
  const salaryWindowOpen = todayDay <= 12 && Boolean(salaryAmount)
  const depositsQuery = useQuery({
    queryKey: ['salary-deposits', userId, monthStartIso],
    enabled: Boolean(userId) && salaryWindowOpen,
    queryFn: async () => {
      const result = await fetchAccountEventsSince(monthStartIso)
      return result.ok ? result.data : []
    },
  })
  const bucketsQuery = useKasaBuckets()
  const salaryStrip = useMemo(() => {
    if (!salaryWindowOpen) return null
    const match = findSalaryDeposit(depositsQuery.data ?? [], salaryAmount)
    if (!match) return null
    const goals = snapshotQuery.data?.savingsGoals ?? []
    const buckets = bucketsQuery.data ?? []
    const pending = goals.filter((goal) => {
      if (goal.status !== 'active') return false
      const bucket = bucketForGoal(goal.id, buckets)
      return bucket ? !isSameMonth(bucket.last_contribution_month, new Date()) : false
    })
    if (pending.length === 0) return null
    return { matchedAt: match.matchedAt, pendingCount: pending.length }
  }, [salaryWindowOpen, depositsQuery.data, salaryAmount, snapshotQuery.data, bucketsQuery.data])

  // Maaş değişikliği önerisi: ±%10 bandında yatış YOKKEN banda yakın bir giriş
  // varsa "maaşını güncelle" tek tık'ı. Uygulama sayıyı kendiliğinden
  // DEĞİŞTİRMEZ (#159 çizgisi); onay yeni salary_history satırı ekler.
  const [salaryUpdateBusy, setSalaryUpdateBusy] = useState(false)
  const [salaryUpdateError, setSalaryUpdateError] = useState('')
  const salaryChange = useMemo(() => {
    if (!salaryWindowOpen) return null
    return findSalaryChangeCandidate(depositsQuery.data ?? [], salaryAmount)
  }, [salaryWindowOpen, depositsQuery.data, salaryAmount])

  async function applySalaryChange(amount: number) {
    if (!userId) return
    setSalaryUpdateBusy(true)
    setSalaryUpdateError('')
    const result = await saveCrudRow(
      'salary_history',
      { user_id: userId, title: 'Maaş', amount, effective_date: monthStartIso, note: null },
      null,
    )
    setSalaryUpdateBusy(false)
    if (!result.ok) {
      setSalaryUpdateError(result.error.message ?? 'Maaş kaydı eklenemedi.')
      return
    }
    void snapshotQuery.refetch()
  }

  // Bütçe formu: çıpa seçimi + koşullu alanlar + canlı "bugünkü karşılık"
  // önizlemesi (#157 desenindeki gibi — kural seçilirken sonucu görürsün).
  const budgetFields: FormField[] = useMemo(
    () => [
      { name: 'month', label: 'Ay', type: 'date', required: true },
      { name: 'category', label: 'Kategori', type: 'select', options: expenseCategoryOptions },
      {
        name: 'limit_anchor',
        label: 'Limit kaynağı',
        type: 'select',
        options: salaryAmount ? [...ANCHOR_BASE_OPTIONS, SALARY_ANCHOR_OPTION] : ANCHOR_BASE_OPTIONS,
      },
      {
        name: 'limit_amount',
        label: 'Aylık limit',
        type: 'number',
        min: '0',
        step: '0.01',
        required: true,
        visibleWhen: (values) => !isAnchored(values),
      },
      {
        name: 'limit_anchor_value',
        label: 'Çarpan / yüzde',
        type: 'number',
        min: '0',
        step: '0.01',
        required: true,
        visibleWhen: isAnchored,
      },
      {
        name: 'limit_preview',
        label: 'Bugünkü karşılık',
        type: 'computed',
        visibleWhen: isAnchored,
        formatComputed: (value: number | null) => (value === null ? '—' : formatAmount(value)),
        compute: (values) => {
          const factor = parseNumber(values.limit_anchor_value)
          if (!factor || factor <= 0) return null
          if (values.limit_anchor === 'salary_pct') {
            return salaryAmount ? roundTL((salaryAmount * factor) / 100) : null
          }
          const monthDate = values.month ? new Date(`${values.month}T00:00:00`) : new Date()
          const base = averageCategorySpend(
            cardExpenses,
            values.category || expenseCategoryOptions[0]?.value || 'Diğer',
            Number.isNaN(monthDate.getTime()) ? new Date() : monthDate,
          )
          return roundTL(base * factor)
        },
      },
      { name: 'note', label: 'Not', type: 'textarea' },
    ],
    [salaryAmount, cardExpenses, formatAmount],
  )

  // Ay bütçesi toplamı: kategori limitlerinin ve harcamalarının toplamı.
  // "Hız" cümlesi ayın kaçıncı gününde olduğumuzla harcama oranını karşılaştırır —
  // %60 harcama ayın %30'unda alarm, %90'ında normaldir.
  const budgetTotals = useMemo(() => {
    const budgets = snapshotQuery.data?.budgets ?? []
    const usage = buildBudgetUsage(budgets, cardExpenses, new Date(), salaryAmount)
    if (usage.length === 0) return null

    const limit = sumTL(usage.map((item) => item.limit))
    const spent = sumTL(usage.map((item) => item.spent))
    if (limit <= 0) return null

    const usageRate = (spent / limit) * 100
    const today = new Date()
    const monthProgress = (today.getDate() / endOfMonth(today).getDate()) * 100
    const ahead = usageRate - monthProgress

    return {
      limit,
      spent,
      usageRate,
      tone: (usageRate > 100 ? 'danger' : usageRate >= 80 ? 'warning' : 'brand') as SeritTone,
      pace:
        ahead > 10
          ? `Ay ilerlemesi %${Math.round(monthProgress)}, bütçe kullanımı %${Math.round(usageRate)} — hız yüksek.`
          : ahead < -10
            ? `Ay ilerlemesi %${Math.round(monthProgress)}, bütçe kullanımı %${Math.round(usageRate)} — planın önündesin.`
            : `Ay ilerlemesi %${Math.round(monthProgress)}, bütçe kullanımı %${Math.round(usageRate)} — plana uygun gidiyorsun.`,
    }
  }, [snapshotQuery.data, cardExpenses, salaryAmount])

  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  // Yükleniyorken paneller boş veriyle çizilmez; hata durumunda sıfırlarla
  // "normal" görünmek yerine `role="alert"` + "Tekrar dene" (denetim §6).
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Plan verileri yükleniyor"
        className="space-y-6"
      >
        <span className="sr-only">Plan verileri yükleniyor</span>
        <SkeletonHero />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    )
  }

  if (snapshotQuery.isError) {
    return (
      <QueryError
        title="Plan verileri yüklenemedi"
        message={snapshotQuery.error instanceof Error ? snapshotQuery.error.message : undefined}
        onRetry={() => void snapshotQuery.refetch()}
        retrying={snapshotQuery.isFetching}
      />
    )
  }

  return (
    <section className="space-y-8">
      {/* Şerit (`4d`): kahraman "harcanan / limit" biçiminde ay bütçesi; bölen
          `ink-faint`, altında 4px çubuk ve hız yorumu. */}
      {budgetTotals ? (
        <div>
          <p className="uppercase text-ink-faint" style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}>
            Ay bütçesi
          </p>
          <p
            className="serit-num mt-2 text-[46px] font-semibold text-ink lg:text-[62px]"
            style={{ lineHeight: 0.95, letterSpacing: '-0.045em' }}
          >
            {seritAmount(budgetTotals.spent).amount}
            <span className="text-ink-faint">
              {' / '}
              {seritAmount(budgetTotals.limit).amount}
            </span>
            <span className="text-[19px] text-ink-faint lg:text-[23px]"> ₺</span>
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-out"
              style={{
                width: `${Math.min(100, budgetTotals.usageRate)}%`,
                background: SERIT_FILL[budgetTotals.tone],
              }}
            />
          </div>
          <p className="mt-2.5 text-[13px] text-ink-muted">{budgetTotals.pace}</p>
        </div>
      ) : null}

      {/* Maaş değişikliği önerisi: yeni tutar tek tıkla salary_history'e girer;
          maaş yüzdesi bütçe çıpaları ve nakit projeksiyonu da düzelir. */}
      {salaryChange ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2.5">
          <p className="text-sm font-medium text-info">
            {formatDate(salaryChange.matchedAt)} tarihinde {formatAmount(salaryChange.amount)} yattı — kayıtlı maaşın{' '}
            {formatAmount(salaryAmount ?? 0)}. Maaşın değişti mi?
          </p>
          <button
            type="button"
            disabled={salaryUpdateBusy}
            onClick={() => void applySalaryChange(salaryChange.amount)}
            className="shrink-0 rounded-lg bg-info px-3 py-1.5 text-xs font-bold text-white transition hover:bg-info/90 disabled:opacity-60"
          >
            {salaryUpdateBusy ? 'Güncelleniyor...' : `${formatAmount(salaryChange.amount)} olarak güncelle`}
          </button>
          {salaryUpdateError ? (
            <p role="alert" className="w-full text-xs font-medium text-warning">{salaryUpdateError}</p>
          ) : null}
        </div>
      ) : null}

      {/* Maaş günü dürtüsü: bilgi şeridi; aksiyon hedef kartlarındaki mevcut
          tek-tık "Ayır" akışıdır, burada ikinci bir yazma yolu açılmaz. */}
      {salaryStrip ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2.5">
          <p className="text-sm font-medium text-info">
            Maaş yattı görünüyor ({formatDate(salaryStrip.matchedAt)}) — {salaryStrip.pendingCount} hedefin bu ay
            ayırması bekliyor; aşağıdan tek tıkla ayırabilirsin.
          </p>
        </div>
      ) : null}

      {/* Varlık ve hesaplar hedefin "takip kaynağı" seçimi için gerekiyor;
          panel Supabase görmez, veriyi hazır snapshot'tan alır. */}
      {canManageGoals ? (
        <SavingsGoalsPanel
          monthlySurplus={monthlySurplus}
          assets={snapshotQuery.data?.assets ?? []}
          cards={snapshotQuery.data?.cards ?? []}
          monthlyOutflow={monthlyOutflow}
        />
      ) : null}

      <KasaModuPanel liquidCash={liquidCash} />

      {canManageBudgets ? (
        <CrudPage
          table="budgets"
          pageTitle="Bütçeler"
          pageLabel="Plan ve hedef"
          pageDescription="Kategori limitlerini ve birikim hedeflerini aylık ilerlemeyle birlikte yönet."
          addLabel="Bütçe ekle"
          fields={budgetFields}
          emptyTitle="Henüz bütçe yok"
          emptyDescription="Kategori bazlı aylık limit ekleyerek harcama takibini başlatabilirsin."
          orderBy="month"
          orderAscending={false}
          renderBeforeList={({ loading: crudLoading, rows, reload }) =>
            !crudLoading ? (
              <BudgetProgress
                budgets={rows as Budget[]}
                expenses={cardExpenses}
                salary={salaryAmount}
                onUpdateLimit={async (budgetId, amount) => {
                  const result = await saveCrudRow('budgets', { limit_amount: amount }, budgetId)
                  if (!result.ok) throw new Error(result.error.message ?? 'Bütçe güncellenemedi.')
                  await reload()
                  void snapshotQuery.refetch()
                }}
                onRollover={async (rowsToCopy) => {
                  if (!userId) return
                  // Sıralı insert: birkaç satır, yarıda kalırsa kalanlar şeritte
                  // görünmeye devam eder (idempotent his; unique ay+kategori korur).
                  for (const row of rowsToCopy) {
                    const result = await saveCrudRow(
                      'budgets',
                      {
                        user_id: userId,
                        month: dateInputValue(startOfMonth()),
                        category: row.category,
                        limit_amount: row.limit_amount,
                        note: row.note,
                        limit_anchor: row.limit_anchor,
                        limit_anchor_value: row.limit_anchor_value,
                      },
                      null,
                    )
                    if (!result.ok) throw new Error(result.error.message ?? `${row.category} bütçesi taşınamadı.`)
                  }
                  await reload()
                  void snapshotQuery.refetch()
                }}
              />
            ) : null
          }
          getInitialValues={(row?: Budget) => ({
            month: row?.month ?? dateInputValue(startOfMonth()),
            category: row?.category ?? expenseCategoryOptions[0]?.value ?? 'Diğer',
            limit_anchor: row?.limit_anchor ?? 'manual',
            limit_amount: row?.limit_amount ?? 0,
            limit_anchor_value: row?.limit_anchor_value ?? '',
            note: row?.note ?? '',
          })}
          mapForm={(formData, userId) => {
            const anchor = String(formData.get('limit_anchor') ?? 'manual')
            const anchored = anchor === 'avg_spend' || anchor === 'salary_pct'
            return {
              user_id: userId,
              month: monthStartValue(formData.get('month')),
              category: String(formData.get('category') ?? 'Diğer'),
              limit_anchor: anchored ? anchor : 'manual',
              // Çıpalı satırda türetilebilen saklanmaz: limit 0'a çekilir (#157 deseni).
              limit_amount: anchored ? 0 : parseNumber(formData.get('limit_amount')),
              limit_anchor_value: anchored ? parseNumber(formData.get('limit_anchor_value')) : null,
              note: String(formData.get('note') ?? '') || null,
            }
          }}
          renderTitle={(row) => row.category}
          renderSubtitle={(row) => formatMonth(row.month)}
          renderDetails={(row) => {
            const [resolved] = resolveBudgetRows([row], cardExpenses, salaryAmount)
            const label = budgetAnchorLabel(row)
            return [`Limit: ${formatAmount(resolved.limit_amount)}${label ? ` · ${label}` : ''}`]
          }}
        />
      ) : null}
    </section>
  )
}
