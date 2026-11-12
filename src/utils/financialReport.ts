import { buildCashFlowForecast } from './cashFlowForecast'
import { buildCreditLimitGroups, buildFinancialPosition, buildMonthlyCashFlow, type FinanceSummaryInput } from './financeSummary'
import { formatCurrency } from './formatCurrency'
import { buildInflationShield } from './inflationShield'
import { diffTL, roundTL, sumTL } from './money'
import type { CardExpense, KasaBucket, NetWorthSnapshot, SavingsGoalSource, TransactionHistory } from '../types/database'
import { buildCardInstallmentCalendar } from './cardInstallmentCalendar'
import { getScheduledCardCashDueDate } from './cardStatement'
import { expenseCategories } from './categories'
import { addDays, dateInputValue, formatDate } from './date'
import { resolveSavingsGoalRows } from './goalSources'
import { averageMonthlyOutflow } from './goalTargetAnchor'
import { totalReservedTL } from './kasaMode'
import type { MarketRatesSnapshot } from './marketRates'
import { buildMonthlySummary } from './monthlySummary'
import {
  buildFinanceObligationsForMonth, buildFinanceObligationsForRange, buildOutstandingObligations,
  summarizeFinanceObligations, type FinanceObligationKind,
} from './obligations'
import { buildRealizedMonthlyOutflow } from './realizedCashFlow'
import { buildSafeToSpend } from './safeToSpend'
import { formatSavingsGoalAmount, savingsGoalProgressRate } from './savingsGoal'

/**
 * Paylaşılabilir rapor, uygulamanın finans hesaplarından kategori toplamları
 * ve anonim ayrıntı satırları üretir. Kullanıcının serbest metinleri dışarı aktarılmaz.
 */

export type ReportSection = {
  heading: string
  /** Serbest metin satırları (markdown bullet olmadan; renderer ekler). */
  lines?: string[]
  table?: { headers: string[]; rows: string[][] }
  /** Bölüm hakkında kısa açıklama/dipnot. */
  note?: string
}

export type FinancialReport = {
  title: string
  generatedAt: string
  sections: ReportSection[]
}

const DATE_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
const READ_TIME_FMT = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
const ASSET_CATEGORIES = new Set(['Nakit', 'Nakit (USD)', 'Nakit (EUR)', 'Nakit (GBP)', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer'])
const CARD_DATA_LABELS: Readonly<Record<string, string>> = {
  card_statement_archives: 'ekstre arşivi',
  card_statement_payments: 'kısmi ekstre ödemeleri',
  card_installments: 'kart taksitleri',
}

function tl(value: number): string {
  return formatCurrency(roundTL(value))
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '%0'
  return `%${Math.round((part / whole) * 100)}`
}

export type FinancialReportOptions = {
  now?: Date
  forecastMonths?: number
  kasaBuckets?: KasaBucket[] | null
  safeToSpendBuffer?: number
  ratesSnapshot?: MarketRatesSnapshot | null
  snapshotReadAt?: number
  netWorthSnapshots?: ReadonlyArray<Pick<NetWorthSnapshot, 'snapshot_date' | 'net_worth'>>
}

export type FinancialReportInput = FinanceSummaryInput & {
  cardExpenses?: CardExpense[]
  transactionHistory?: TransactionHistory[]
  savingsGoalSources?: SavingsGoalSource[]
  missingTables?: string[]
}

const OBLIGATION_LABELS: Record<FinanceObligationKind, string> = {
  payment: 'Planlı ödeme', card_statement: 'Kart ekstresi', card_debt: 'Kart ekstresi (kart kaydı)',
  card_installment: 'Kart taksiti', loan_installment: 'Kredi taksiti', legacy_loan_installment: 'Kredi taksiti',
  personal_debt: 'Kişisel borç', personal_receivable: 'Alacak tahsilatı', salary: 'Maaş',
}

function buildPaymentWindow(data: FinancialReportInput, now: Date) {
  const input = { ...data, cardStatements: data.cardStatements ?? [] }
  const today = dateInputValue(now)
  const weekEnd = dateInputValue(addDays(now, 7))
  const windowEnd = dateInputValue(addDays(now, 30))
  const overdue = [
    ...buildOutstandingObligations(input, now),
    ...buildFinanceObligationsForMonth(input, now, { from: now }),
  ].filter((item) => item.date < today && item.action && item.direction === 'outflow')
    .sort((a, b) => a.date.localeCompare(b.date))

  const upcoming = buildFinanceObligationsForRange(input, { from: now, days: 30 })
    .filter((item) => item.kind !== 'card_installment' && !(item.kind === 'salary' && item.date === today))
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const scheduled = data.cardInstallments.flatMap((row) => {
    const date = getScheduledCardCashDueDate(cardsById.get(row.card_id), row)
    return date && date >= today && date <= windowEnd && row.amount > 0
      ? [{ date, amount: row.amount }]
      : []
  })
  const knownOutflow = (through: string) => sumTL([
    summarizeFinanceObligations(upcoming.filter((item) => item.date <= through), { from: now }).outflow,
    ...scheduled.filter((item) => item.date <= through).map((item) => item.amount),
  ])
  const expectedIncome = (kind: 'salary' | 'personal_receivable') =>
    sumTL(upcoming.filter((item) => item.kind === kind).map((item) => item.amount))

  return {
    overdue,
    overdueOutflow: summarizeFinanceObligations(overdue).outflow,
    upcoming,
    scheduled,
    weekEnd,
    windowEnd,
    outflow7: knownOutflow(weekEnd),
    outflow30: knownOutflow(windowEnd),
    salary30: expectedIncome('salary'),
    receivables30: expectedIncome('personal_receivable'),
  }
}

function netWorthComparison(snapshots: FinancialReportOptions['netWorthSnapshots'], netWorth: number, now: Date): string[] {
  if (!snapshots) return ['Net değer geçmişi bu rapor hazırlanırken doğrulanamadı.']
  const sorted = [...snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
  return [30, 90].map((days) => {
    const cutoff = dateInputValue(addDays(now, -days))
    const point = sorted.find((row) => row.snapshot_date <= cutoff && Number.isFinite(row.net_worth))
    if (!point) return `${days} günlük net değer karşılaştırması için yeterli geçmiş yok.`
    const change = diffTL(netWorth, point.net_worth)
    return `Net değer değişimi (${days} gün önceye en yakın eski kayıt, ${formatDate(point.snapshot_date)}): ${change > 0 ? '+' : ''}${tl(change)}`
  })
}

export function buildFinancialReport(data: FinancialReportInput, options: FinancialReportOptions = {}): FinancialReport {
  const now = options.now ?? new Date()
  const horizonMonths = options.forecastMonths ?? 6
  const position = buildFinancialPosition(data)
  const shield = buildInflationShield(data.assets, data.cards)
  const monthly = buildMonthlyCashFlow(data, now, { today: now })
  const forecast = buildCashFlowForecast(data, { horizonMonths, from: now })
  const windows = buildPaymentWindow(data, now)
  const missingCardData = Object.entries(CARD_DATA_LABELS)
    .filter(([table]) => data.missingTables?.includes(table))
    .map(([, label]) => label)
  const incompleteCalendar = monthly.unplacedCardIds.length > 0
  const reserved = options.kasaBuckets == null ? null : totalReservedTL(options.kasaBuckets)
  const buffer = options.safeToSpendBuffer
  const spendableLine = incompleteCalendar
    ? 'Bu ay harcanabilir: doğrulanamadı (kart kesim veya son ödeme günü eksik).'
    : missingCardData.length
      ? 'Bu ay harcanabilir: doğrulanamadı (kart verisi eksik).'
      : reserved == null || buffer == null
        ? 'Bu ay harcanabilir tutar hesaplanamadı (tampon veya kasa rezervi doğrulanamadı).'
        : `Bu ay harcanabilir: ${tl(buildSafeToSpend({
          liquidCash: position.totalCashAssets, expectedIncome: monthly.spendableIncome,
          remainingOutflow: monthly.remainingOutflow, buffer, reserved,
        }).amount)}`
  const coverage = [
    ...(missingCardData.length ? [`Eksik kart verisi: ${missingCardData.join(', ')}. Vade toplamları ve projeksiyon eksik olabilir.`] : []),
    ...(incompleteCalendar ? [`${monthly.unplacedCardIds.length} kartın kesim veya son ödeme günü eksik. Vade toplamları ve projeksiyon eksik olabilir.`] : []),
  ]
  const forecastRisk = [
    ...(forecast.lowest ? [`En düşük tahmini ay sonu nakdi: ${forecast.lowest.monthLabel} · ${tl(forecast.lowest.balance)}`] : []),
    ...(forecast.firstNegative ? [`İlk nakit açığı: ${forecast.firstNegative.monthLabel} · ${tl(forecast.firstNegative.balance)}`] : []),
  ]

  const sections: ReportSection[] = [{
    heading: 'Güncel Durum',
    lines: [
      `Son veri okuma: ${options.snapshotReadAt ? READ_TIME_FMT.format(options.snapshotReadAt) : 'bilinmiyor'}`,
      `Net değer: ${tl(position.netWorth)} · Toplam borç: ${tl(position.totalDebts)}`,
      `Likit bakiye: ${tl(position.totalCashAssets)} · Kasa rezervi: ${reserved == null ? 'doğrulanamadı' : tl(reserved)} · Güvenlik tamponu: ${buffer == null ? 'doğrulanamadı' : tl(buffer)}`,
      spendableLine,
      ...forecastRisk,
      ...coverage,
    ],
    note: 'Son okuma uygulama verisinin alındığı zamandır. Bakiyeler uygulamadaki kayıtları yansıtır.',
  }, {
    heading: 'Yakın Vadeler',
    lines: [
      `Vadesi geçmiş açık ödeme: ${windows.overdue.length} kayıt · kayıtlı nakit yükü ${tl(windows.overdueOutflow)}`,
      `Önümüzdeki 7 günün kayıtlı nakit yükü (bugün–${formatDate(windows.weekEnd)}): ${tl(windows.outflow7)}`,
      `Önümüzdeki 30 günün kayıtlı nakit yükü (bugün–${formatDate(windows.windowEnd)}): ${tl(windows.outflow30)}`,
      `30 günde beklenen girişler: maaş ${tl(windows.salary30)} · alacak tahsilatı ${tl(windows.receivables30)}`,
    ],
    note: '7 günlük yük 30 günlük tutara dahildir. Gecikmiş ödemeler ayrı gösterilir. Tutarlar tahmini ödeme ve kart takvimi kalemleri içerebilir.',
  }]

  const today = dateInputValue(now)
  const spending = data.cardExpenses ? buildMonthlySummary(data.cardExpenses
    .filter((row) => row.spent_at.slice(0, 10) <= today)
    .map((row) => expenseCategories.includes(row.category) ? row : { ...row, category: 'Diğer' }), now) : null
  const increases = (spending?.categories ?? []).map(({ category, amount }) => ({
    category,
    change: diffTL(amount, spending?.previousMonthToDateByCategory.get(category) ?? 0),
  })).filter(({ change }) => change > 0).sort((a, b) => b.change - a.change).slice(0, 3)
  sections.push({
    heading: 'Son Dönemdeki Değişim',
    lines: [
      ...(spending ? [
        `Ayın aynı gününe kadar kart harcaması: bu ay ${tl(spending.currentMonthTotal)} · geçen ay ${tl(spending.previousMonthToDateTotal)}`,
        spending.changePercent === null ? 'Yüzde değişimi için geçen ayın karşılaştırma tutarı yok.' : `Geçen ay aynı güne göre değişim: %${spending.changePercent}`,
        ...(increases.length ? [`En çok artan kategoriler: ${increases.map(({ category, change }) => `${category} +${tl(change)}`).join(' · ')}`] : []),
      ] : ['Kart harcama karşılaştırması için kayıtlar doğrulanamadı.']),
      ...netWorthComparison(options.netWorthSnapshots, position.netWorth, now),
    ],
    note: 'Kart harcaması alışveriş tarihine göre karşılaştırılır. Net değer değişimi varlık fiyatları ve borç bakiyelerindeki değişimleri de içerir.',
  })

  sections.push({
    heading: 'Net Değer',
    lines: [
      `Toplam varlık: ${tl(position.totalAssets)}`,
      `Toplam borç: ${tl(position.totalDebts)}`,
      `Net değer: ${tl(position.netWorth)}`,
      ...(position.totalReceivables > 0
        ? [`Alacaklar tahsil edilirse: ${tl(position.netWorthIfReceivablesCollected)}`]
        : []),
    ],
  })

  // 2. Varlık dağılımı (kategori) + enflasyon kalkanı oranı
  if (shield.totalValue > 0) {
    sections.push({
      heading: 'Varlık Dağılımı',
      table: {
        headers: ['Kategori', 'Değer', 'Pay'],
        rows: shield.categories.map((c) => [ASSET_CATEGORIES.has(c.category) ? c.category : 'Diğer', tl(c.value), pct(c.value, shield.totalValue)]),
      },
      note:
        `TL nakit dışındaki varlıklar: ${tl(shield.protectedValue)} (${pct(shield.protectedValue, shield.totalValue)}) · ` +
        `TL nakit: ${tl(shield.meltingValue)} (${pct(shield.meltingValue, shield.totalValue)})`,
    })
  }

  // 3. Borç dağılımı
  const debtLines: string[] = []
  if (position.totalCreditCardDebt > 0) {
    debtLines.push(
      `Kredi kartı: ${tl(position.totalCreditCardDebt)} ` +
        `(ekstre ${tl(position.totalCardStatementDebt)}, dönem içi ${tl(position.totalCardCurrentPeriod)}, ` +
        `provizyon ${tl(position.totalCardProvision)}, gelecek taksit ${tl(position.totalCardFutureInstallmentDebt)})`,
    )
  }
  if (position.totalLoanDebt > 0) debtLines.push(`Krediler (kalan): ${tl(position.totalLoanDebt)}`)
  if (position.totalPersonalDebts > 0) debtLines.push(`Kişisel borçlar: ${tl(position.totalPersonalDebts)}`)
  if (position.totalPaymentLiabilities > 0) debtLines.push(`Bekleyen ödemeler: ${tl(position.totalPaymentLiabilities)}`)
  if (debtLines.length === 0) debtLines.push('Kayıtlı borç yok.')
  sections.push({ heading: 'Borç Dağılımı', lines: debtLines })

  const accounts = data.cards.filter((card) => card.card_type === 'banka_karti')
  sections.push({
    heading: 'Hesaplar ve Nakit',
    lines: [
      `Banka hesapları (${accounts.filter((card) => card.account_kind !== 'cash').length}): ${tl(sumTL(accounts.filter((card) => card.account_kind !== 'cash').map((card) => card.current_balance)))}`,
      `Nakit cüzdanları (${accounts.filter((card) => card.account_kind === 'cash').length}): ${tl(sumTL(accounts.filter((card) => card.account_kind === 'cash').map((card) => card.current_balance)))}`,
      `Toplam likit: ${tl(position.totalCashAssets)} (nakit varlıklar dahil)`,
    ],
    note: 'Harcanabilir tutar likit bakiye, kalan maaş, yükümlülükler, tampon ve kasa rezerviyle hesaplanır.',
  })

  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  if (creditCards.length) {
    const groups = buildCreditLimitGroups(data.cards)
    sections.push({
      heading: 'Kart Borcu ve Limit Ayrıntıları',
      lines: [`Ortak limitler tek sayılmış toplam limit: ${tl(sumTL(groups.map((group) => group.limit)))}`, `Kalan limit: ${tl(sumTL(groups.map((group) => group.available)))}`],
      table: {
        headers: ['Kart', 'Toplam borç', 'Ekstre', 'Dönem içi', 'Provizyon'],
        rows: creditCards.map((card, index) => [`Kart ${index + 1}`, tl(card.debt_amount), tl(card.statement_debt_amount), tl(card.current_period_spending), tl(card.provision_amount ?? 0)]),
      },
      note: 'Kart adları anonimdir. Gelecek taksitler toplam borca dahildir; ayrıca eklenmez. Ekstre sütunu kartın kalan ekstre kovasıdır. Kullanılabilir limit nakit değildir.',
    })
  }

  const activeLoans = data.loans.filter((loan) => loan.status === 'active')
  if (activeLoans.length) {
    sections.push({
      heading: 'Aktif Krediler',
      table: {
        headers: ['Kredi', 'Kalan borç', 'Kalan taksit', 'Aylık ödeme', 'Bitiş'],
        rows: activeLoans.map((loan, index) => [
          `Kredi ${index + 1}`, tl(loan.remaining_amount), String(loan.remaining_installments), tl(loan.monthly_payment), formatDate(loan.end_date),
        ]),
      },
      note: 'Kalan borç, uygulamadaki taksit özetidir. Erken kapama için bankadan güncel tutar ve koşullar gerekir.',
    })
  }

  if (!data.missingTables?.includes('card_installments')) {
    const calendar = buildCardInstallmentCalendar(data.cardInstallments, data.cards, horizonMonths, now)
    sections.push({
      heading: 'Gelecek Taksit Takvimi',
      table: { headers: ['Ekstreye girecek ay', 'Planlı taksit'], rows: calendar.map((month) => [month.monthLabel, tl(month.total)]) },
      note: 'Yalnız henüz ekstreye girmemiş planlı taksitlerdir; ekstreye giriş ayı ödeme günü değildir. Kesinleşmiş ve ödenmiş taksitler tekrar sayılmaz.',
    })
  }

  // 4. Bu ay nakit akışı
  sections.push({
    heading: `Bu Ay Nakit Akışı (${monthly.monthLabel})`,
    lines: [
      `Beklenen toplam gelir: ${tl(monthly.income)}`,
      `Planlanan nakit çıkışı: ${tl(monthly.outflow)}`,
      `Planlanan net akış: ${tl(monthly.netFlow)}`,
      `Bu ay henüz beklenen gelir: ${tl(monthly.expectedIncome)} (alacak tahsilatı ${tl(monthly.remainingReceivableIncome)})`,
      `Ay sonuna kadar kalan nakit çıkışı (geciken açık yükümlülükler dahil): ${tl(monthly.remainingOutflow)}`,
      `Tahmini ay sonu nakit: ${tl(monthly.projectedCash)}`,
    ],
    note: 'Gelir maaş ve alacak planını gösterir. Maaş ilk iş gününden itibaren mevcut bakiyede varsayılır. Projeksiyon kayıtlı planlara dayanır.',
  })

  const obligationRow = (item: (typeof windows.upcoming)[number]) => {
    const label = item.kind === 'card_debt' && !item.action ? 'Dönem içi kart borcu (sonraki ekstre)' : OBLIGATION_LABELS[item.kind]
    return [
      item.date, label, item.direction === 'inflow' ? 'Giriş' : 'Çıkış',
      `${tl(item.amount)}${item.isEstimate ? ' (tahmini)' : ''}`, tl(item.cashImpactAmount ?? item.amount),
    ]
  }
  if (windows.overdue.length) {
    sections.push({
      heading: 'Vadesi Geçmiş Açık Ödemeler',
      table: {
        headers: ['Vade', 'Tür', 'Yön', 'Kalan tutar', 'Nakit etkisi'],
        rows: windows.overdue.map(obligationRow).map(([date, ...cells]) => [formatDate(date), ...cells]),
      },
    })
  }
  const upcomingRows = [
    ...windows.upcoming.map(obligationRow),
    ...windows.scheduled.map(({ date, amount }) => [date, 'Planlı kart taksiti (tahmini ödeme günü)', 'Çıkış', tl(amount), tl(amount)]),
  ].sort(([a], [b]) => a.localeCompare(b))
  sections.push({
    heading: 'Önümüzdeki 30 Gün',
    ...(upcomingRows.length ? {
      table: {
        headers: ['Tarih', 'Tür', 'Yön', 'Tutar', 'Nakit etkisi'],
        rows: upcomingRows.map(([date, ...cells]) => [formatDate(date), ...cells]),
      },
    } : { lines: ['Bu aralıkta kayıtlı yükümlülük veya beklenen gelir yok.'] }),
    note: 'Nakit etkisi sıfır olan kartlı planlı ödemeler karta yansır. Planlı kart taksitlerinin nakit etkisi, hesaplanan son ödeme gününde gösterilir.',
  })

  if (spending) {
    sections.push({
      heading: 'Kart Harcama Eğilimi',
      lines: [
        `Geçen ayın tamamı: ${tl(spending.previousMonthTotal)}`,
      ],
      table: { headers: ['Kategori', 'Bu ay bugüne kadar', 'Pay'], rows: spending.categories.map((category) => [category.category, tl(category.amount), `%${category.percentage}`]) },
      note: 'Kapsam kart alışverişleridir. Provizyonlar dahil, iptaller hariçtir. Taksitli alışverişler alışveriş tarihindeki toplam kayıt tutarıyla yer alır.',
    })
  }

  if (data.transactionHistory) {
    const realized = buildRealizedMonthlyOutflow(data.transactionHistory, data.payments, now, data.cards, data.cardExpenses)
    sections.push({
      heading: 'Bu Ay Kaydedilen Ödemeler',
      lines: [`Kart borcu ödemeleri: ${tl(realized.cardPayments)}`, `Fatura ve planlı ödemeler: ${tl(realized.billPayments)}`, `Kredi taksitleri: ${tl(realized.loanPayments)}`, `Kişisel borç ödemeleri: ${tl(realized.debtPayments)}`, `Toplam kayıtlı nakit ödeme: ${tl(realized.totalCash)}`],
      note: 'İşlem geçmişine kaydedilmiş ödemelerdir; tüm hesap çıkışları veya gerçekleşen gelir değildir. Kredi kartıyla ödenen faturalar nakit çıkışına tekrar katılmaz.',
    })
  }

  const activeGoals = data.savingsGoals?.filter((goal) => goal.status === 'active') ?? []
  if (activeGoals.length) {
    const resolved = resolveSavingsGoalRows(activeGoals, data.savingsGoalComponents ?? [], data.savingsGoalSources ?? [], {
      assets: data.assets, cards: data.cards, buckets: options.kasaBuckets ?? undefined, snapshot: options.ratesSnapshot,
      monthlyOutflow: data.transactionHistory ? averageMonthlyOutflow(data.transactionHistory, data.payments, data.cards, 6, now) : null,
    })
    sections.push({
      heading: 'Birikim Hedefleri',
      table: { headers: ['Hedef', 'Biriken', 'Hedef tutarı', 'İlerleme', 'Hedef tarihi'], rows: resolved.goals.map((goal, index) => {
        const resolution = resolved.goalResolutions.get(goal.id)
        const target = resolved.targetResolutions.get(goal.id)
        const componentsClean = resolved.components.filter((component) => component.goal_id === goal.id).every((component) => {
          const value = resolved.componentResolutions.get(component.id)
          return !value || (!value.missing.length && !value.unusable.length)
        })
        const goalSourcesKnown = !data.missingTables?.includes('savings_goal_sources')
          && (goal.value_type !== 'composite' || !data.missingTables?.includes('savings_goal_components'))
        const currentClean = goalSourcesKnown && (!resolution || (!resolution.missing.length && !resolution.unusable.length)) && componentsClean
        const targetClean = !target?.stale && (goal.value_type !== 'composite' || !data.missingTables?.includes('savings_goal_components'))
        const progress = currentClean && targetClean && goal.target_amount > 0 ? `%${Math.round(savingsGoalProgressRate(goal, resolved.components))}` : '—'
        return [
          `Hedef ${index + 1}`,
          currentClean ? formatSavingsGoalAmount(goal, goal.current_amount) : 'Kaynak doğrulanamadı',
          targetClean ? formatSavingsGoalAmount(goal, goal.target_amount) : 'Güncel hedef verisi eksik',
          progress, formatDate(goal.target_date),
        ]
      }) },
      note: 'İsimler anonimdir. Kaynağa bağlı birikim güncel varlık/hesap/kasadan türetilir; eksik kaynak veya çıpa kesin tutar gibi gösterilmez.',
    })
  }

  sections.push({
    heading: `${horizonMonths} Aylık Nakit Projeksiyonu`,
    lines: [
      `Başlangıç nakit: ${tl(forecast.startingBalance)}`,
      `${horizonMonths} ay sonu: ${tl(forecast.endingBalance)}`,
      ...(!forecast.firstNegative && !coverage.length ? ['Kayıtlı planlarla ay sonu nakdi eksiye düşmüyor.'] : []),
    ],
    table: {
      headers: ['Ay', 'Maaş', 'Beklenen alacak', 'Nakit çıkışı', 'Net', 'Ay sonu bakiye'],
      rows: forecast.months.map((m) => [m.monthLabel, tl(m.salary), tl(m.receivables), tl(m.outflow), tl(m.net), tl(m.endingBalance)]),
    },
    note: 'Ay sonu bakiyesi beklenen tahsilatı içerir. Rezerv ve tampon likit bakiyenin içindedir. Gelecekteki yeni harcamalar ancak kayda girdikçe projeksiyona yansır.',
  })

  sections.push({
    heading: 'Kapsam ve Yorumlama',
    lines: [
      ...(data.missingTables?.length ? ['Bazı ek veri tabloları bu ortamda mevcut değil; taksit, ekstre veya hedef ayrıntıları eksik olabilir.'] : []),
      'Sohbet bağlamı: Bu özetin tarihini dikkate al ve kullanıcının sorusuna göre ilgili rakamları kullan. Faiz oranı, gerçek tahsilat veya kayıt dışı gider gibi eksik bir bilgi sonucu etkiliyorsa kullanıcıya sor.',
    ],
  })

  return {
    title: 'Finansal Özet',
    generatedAt: DATE_FMT.format(now),
    sections,
  }
}

/** Raporu AI'ya yapıştırmaya uygun yapısal markdown'a çevirir (panoya kopyalama için). */
export function reportToMarkdown(report: FinancialReport): string {
  const out: string[] = []
  out.push(`# ${report.title} — ${report.generatedAt}`)
  out.push('Para birimi: TL. Altın hedeflerinde miktarın birimi ayrıca belirtilir. Ayrıntılar anonimdir.')

  for (const section of report.sections) {
    out.push('')
    out.push(`## ${section.heading}`)
    for (const line of section.lines ?? []) out.push(`- ${line}`)
    if (section.table) {
      out.push('')
      out.push(`| ${section.table.headers.join(' | ')} |`)
      out.push(`| ${section.table.headers.map(() => '---').join(' | ')} |`)
      for (const row of section.table.rows) out.push(`| ${row.join(' | ')} |`)
    }
    if (section.note) {
      out.push('')
      out.push(`> ${section.note}`)
    }
  }

  return out.join('\n')
}
