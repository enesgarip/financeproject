import { buildCashFlowForecast } from './cashFlowForecast'
import { buildCreditLimitGroups, buildFinancialPosition, buildMonthlyCashFlow, sum, type FinanceSummaryInput } from './financeSummary'
import { formatCurrency } from './formatCurrency'
import { buildInflationShield } from './inflationShield'
import { diffTL, roundTL, sumTL } from './money'
import type { CardExpense, KasaBucket, SavingsGoalSource, TransactionHistory } from '../types/database'
import { buildCardInstallmentCalendar } from './cardInstallmentCalendar'
import { expenseCategories } from './categories'
import { formatDate } from './date'
import { resolveSavingsGoalRows } from './goalSources'
import { averageMonthlyOutflow } from './goalTargetAnchor'
import { totalReservedTL } from './kasaMode'
import type { MarketRatesSnapshot } from './marketRates'
import { buildMonthlySummary } from './monthlySummary'
import { buildFinanceObligationsForRange, type FinanceObligationKind } from './obligations'
import { buildRealizedMonthlyOutflow } from './realizedCashFlow'
import { buildSafeToSpend } from './safeToSpend'
import { formatSavingsGoalAmount } from './savingsGoal'

/**
 * Finansal Özet Raporu — kullanıcının verisini bir AI'ya (ör. ChatGPT) yapıştırıp
 * taktik alması veya periyodik özet için yapısal bir snapshot üretir.
 *
 * Tasarım kararı — GİZLİLİK YAPI GEREĞİ: rapor yalnızca kategori/tür bazında
 * agregasyon ve anonim kart/hedef satırları içerir; hesap/banka/kişi ADI veya IBAN geçmez → sızdırılacak
 * kimlik yoktur (maskeleme toggle'ından daha güçlü güvence). Yalnız yapı + rakam.
 *
 * Çoğunlukla DERLEME + SUNUM: mevcut domain çekirdeğini (buildFinancialPosition,
 * buildInflationShield, buildMonthlyCashFlow, buildCashFlowForecast) DRY yeniden
 * kullanır, yeni hesap icat etmez. Saf ve yan etkisiz; `now` test için enjekte edilir.
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
}

export type FinancialReportInput = FinanceSummaryInput & {
  cardExpenses?: CardExpense[]
  transactionHistory?: TransactionHistory[]
  savingsGoalSources?: SavingsGoalSource[]
  missingTables?: string[]
}

const OBLIGATION_LABELS: Record<FinanceObligationKind, string> = {
  payment: 'Planlı ödeme', card_statement: 'Kart ekstresi', card_debt: 'Kart borcu',
  card_installment: 'Kart taksiti', loan_installment: 'Kredi taksiti', legacy_loan_installment: 'Kredi taksiti',
  personal_debt: 'Kişisel borç', personal_receivable: 'Alacak tahsilatı', salary: 'Maaş',
}

export function buildFinancialReport(data: FinancialReportInput, options: FinancialReportOptions = {}): FinancialReport {
  const now = options.now ?? new Date()
  const horizonMonths = options.forecastMonths ?? 6
  const position = buildFinancialPosition(data)
  const shield = buildInflationShield(data.assets, data.cards)
  const monthly = buildMonthlyCashFlow(data, now, { today: now })
  const forecast = buildCashFlowForecast(data, { horizonMonths, from: now })

  const sections: ReportSection[] = []

  // 1. Net değer
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
        rows: shield.categories.map((c) => [c.category, tl(c.value), pct(c.value, shield.totalValue)]),
      },
      note:
        `Reel/korunaklı: ${tl(shield.protectedValue)} (${pct(shield.protectedValue, shield.totalValue)}) · ` +
        `Eriyen TL nakit: ${tl(shield.meltingValue)} (${pct(shield.meltingValue, shield.totalValue)})`,
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
    heading: 'Hesaplar ve Harcanabilir Tutar',
    lines: [
      `Banka hesapları (${accounts.filter((card) => card.account_kind !== 'cash').length}): ${tl(sumTL(accounts.filter((card) => card.account_kind !== 'cash').map((card) => card.current_balance)))}`,
      `Nakit cüzdanları (${accounts.filter((card) => card.account_kind === 'cash').length}): ${tl(sumTL(accounts.filter((card) => card.account_kind === 'cash').map((card) => card.current_balance)))}`,
      `Toplam likit: ${tl(position.totalCashAssets)} (nakit varlıklar dahil)`,
      `Hesap ve nakit cüzdanlarından tüm kart borcu düşülünce: ${tl(diffTL(sumTL(accounts.map((card) => card.current_balance)), position.totalCreditCardDebt))}`,
      ...(options.kasaBuckets != null && options.safeToSpendBuffer != null ? [
        `Güvenlik tamponu: ${tl(options.safeToSpendBuffer)}`,
        `Kasa rezervi: ${tl(totalReservedTL(options.kasaBuckets))}`,
        `Bu ay harcanabilir: ${tl(buildSafeToSpend({ liquidCash: position.totalCashAssets, expectedIncome: monthly.expectedIncome, remainingOutflow: monthly.remainingOutflow, buffer: options.safeToSpendBuffer, reserved: totalReservedTL(options.kasaBuckets) }).amount)}`,
      ] : ['Bu ay harcanabilir tutar hesaplanamadı: güvenlik tamponu veya kasa rezervi doğrulanamadı.']),
    ],
    note: 'Kart borcu sonrası fark ile bu ay harcanabilir tutar farklıdır. Harcanabilir tutar kalan gelir, yükümlülük, tampon ve kasa rezervini dikkate alır.',
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
      `Bugünden ay sonuna kalan nakit çıkışı: ${tl(monthly.remainingOutflow)}`,
      `Tahmini ay sonu nakit: ${tl(monthly.projectedCash)}`,
    ],
    note: 'Gelir maaş ve alacak planıdır; gerçekleşen gelir değildir. Kalan çıkış geçmiş vadeleri içermez. Kayıt dışı harcamalar ve gelecekteki yeni alışverişler projeksiyonda yoktur.',
  })

  const upcoming = buildFinanceObligationsForRange({ ...data, cardStatements: data.cardStatements ?? [] }, { from: now, days: 30 })
  sections.push({
    heading: 'Önümüzdeki 30 Gün',
    ...(upcoming.length ? {
      table: {
        headers: ['Tarih', 'Tür', 'Yön', 'Tutar', 'Nakit etkisi'],
        rows: upcoming.map((item) => [formatDate(item.date), OBLIGATION_LABELS[item.kind], item.direction === 'inflow' ? 'Giriş' : 'Çıkış', `${tl(item.amount)}${item.isEstimate ? ' (tahmini)' : ''}`, tl(item.cashImpactAmount ?? item.amount)]),
      },
    } : { lines: ['Bu aralıkta kayıtlı yükümlülük veya beklenen gelir yok.'] }),
    note: 'Nakit etkisi 0 olan kart kalemleri kart borcuna dönüşür. Geçmiş vadeler bu ileriye dönük listede yer almaz.',
  })

  if (data.cardExpenses) {
    const spending = buildMonthlySummary(data.cardExpenses, now)
    sections.push({
      heading: 'Kart Harcama Eğilimi',
      lines: [
        `Bu ay kaydedilen kart harcaması: ${tl(spending.currentMonthTotal)}`,
        `Geçen ayın tamamı: ${tl(spending.previousMonthTotal)}`,
        spending.changePercent === null ? 'Geçen ay aynı güne göre değişim hesaplanamadı (karşılaştırma tabanı yok).' : `Geçen ay aynı güne göre değişim: %${spending.changePercent}`,
      ],
      table: { headers: ['Kategori', 'Tutar', 'Pay'], rows: spending.categories.map((category) => [expenseCategories.includes(category.category) ? category.category : 'Diğer', tl(category.amount), `%${category.percentage}`]) },
      note: 'İptaller hariç, provizyonlar dahil. Taksitli alışverişler alışveriş tarihindeki kayıt tutarıyla gösterilir; nakit çıkışı ve taksit takvimiyle toplanmaz. Bu bölüm hesap/nakit harcamalarının tamamını kapsamaz.',
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

  if (data.savingsGoals?.length) {
    const resolved = resolveSavingsGoalRows(data.savingsGoals, data.savingsGoalComponents ?? [], data.savingsGoalSources ?? [], {
      assets: data.assets, cards: data.cards, buckets: options.kasaBuckets ?? undefined, snapshot: options.ratesSnapshot,
      monthlyOutflow: data.transactionHistory ? averageMonthlyOutflow(data.transactionHistory, data.payments, data.cards, 6, now) : null,
    })
    sections.push({
      heading: 'Birikim Hedefleri',
      table: { headers: ['Hedef', 'Biriken', 'Hedef tutarı', 'Hedef tarihi'], rows: resolved.goals.map((goal, index) => {
        const resolution = resolved.goalResolutions.get(goal.id)
        const target = resolved.targetResolutions.get(goal.id)
        const componentsClean = resolved.components.filter((component) => component.goal_id === goal.id).every((component) => {
          const value = resolved.componentResolutions.get(component.id)
          return !value || (!value.missing.length && !value.unusable.length)
        })
        const goalSourcesKnown = !data.missingTables?.includes('savings_goal_sources')
          && (goal.value_type !== 'composite' || !data.missingTables?.includes('savings_goal_components'))
        const currentClean = goalSourcesKnown && (!resolution || (!resolution.missing.length && !resolution.unusable.length)) && componentsClean
        return [`Hedef ${index + 1}`, currentClean ? formatSavingsGoalAmount(goal, goal.current_amount) : 'Kaynak doğrulanamadı', target?.stale ? 'Güncel çıpa verisi eksik' : formatSavingsGoalAmount(goal, goal.target_amount), formatDate(goal.target_date)]
      }) },
      note: 'İsimler anonimdir. Kaynağa bağlı birikim güncel varlık/hesap/kasadan türetilir; eksik kaynak veya çıpa kesin tutar gibi gösterilmez.',
    })
  }

  // 5. Nakit projeksiyonu
  const forecastSection: ReportSection = {
    heading: `${horizonMonths} Aylık Nakit Projeksiyonu`,
    lines: [
      `Başlangıç nakit: ${tl(forecast.startingBalance)}`,
      `${horizonMonths} ay sonu: ${tl(forecast.endingBalance)}`,
      forecast.lowest ? `En düşük nokta: ${forecast.lowest.monthLabel} · ${tl(forecast.lowest.balance)}` : null,
      forecast.firstNegative
        ? `İlk negatif ay: ${forecast.firstNegative.monthLabel} · ${tl(forecast.firstNegative.balance)}`
        : 'Projeksiyonda negatife düşen ay yok.',
    ].filter((line): line is string => line !== null),
    table: {
      headers: ['Ay', 'Gelir', 'Nakit çıkışı', 'Net', 'Ay sonu bakiye'],
      rows: forecast.months.map((m) => [m.monthLabel, tl(m.income), tl(m.outflow), tl(m.net), tl(m.endingBalance)]),
    },
  }
  sections.push(forecastSection)

  // 6. Servet kapsama (basit FIRE oranı — varsayım icat etmeden)
  const avgMonthlyOutflow =
    forecast.months.length > 0 ? sum(forecast.months, (m) => m.outflow) / forecast.months.length : 0
  const annualExpenses = roundTL(avgMonthlyOutflow * 12)
  if (annualExpenses > 0) {
    const coverageYears = position.netWorth / annualExpenses
    sections.push({
      heading: 'Servet Kapsama (FIRE göstergesi)',
      lines: [
        `Tahmini yıllık nakit çıkışı: ${tl(annualExpenses)} (gelecek ${horizonMonths} ay projeksiyonu ort. ×12)`,
        `Net değer / yıllık nakit çıkışı: ${coverageYears.toFixed(1)} yıl`,
      ],
      note: 'Kaba gösterge; getiri/enflasyon varsayımı içermez, ödeme/taksit dağılımına göre değişir.',
    })
  }

  sections.push({
    heading: 'Kapsam ve Yorumlama',
    lines: [
      'Bakiyeler uygulamadaki son kayıtlardır; banka ile anlık eşitleme veya banka doğrulaması anlamına gelmez.',
      'Alacaklar tahsil edilene kadar nakit değildir. Limit, varlık değeri ve harcanabilir tutar birbirinden farklıdır.',
      ...(data.missingTables?.length ? ['Bazı ek veri tabloları bu ortamda mevcut değil; taksit, ekstre veya hedef ayrıntıları eksik olabilir.'] : []),
      'AI için: nakit sıkışıklığını, yaklaşan ödemeleri, borç sırasını ve harcama eğilimlerini değerlendir. Eksik faiz oranı, gelir veya gider uydurma; ek bilgi gerekiyorsa sor.',
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
  out.push('Para birimi: TL (altın hedeflerinde birim ayrıca belirtilir). Bakiyeler son kayıtları, projeksiyonlar tahminleri gösterir. Hesap/banka/kişi adı içermez (yalnız yapı + rakam).')

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
