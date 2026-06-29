import { buildCashFlowForecast } from './cashFlowForecast'
import { buildFinancialPosition, buildMonthlyCashFlow, sum, type FinanceSummaryInput } from './financeSummary'
import { formatCurrency } from './formatCurrency'
import { buildInflationShield } from './inflationShield'
import { roundTL } from './money'

/**
 * Finansal Özet Raporu — kullanıcının verisini bir AI'ya (ör. ChatGPT) yapıştırıp
 * taktik alması veya periyodik özet için yapısal bir snapshot üretir.
 *
 * Tasarım kararı — GİZLİLİK YAPI GEREĞİ: rapor yalnızca kategori/tür bazında
 * agregasyon içerir; hiçbir hesap/banka/kişi ADI veya IBAN geçmez → sızdırılacak
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
}

export function buildFinancialReport(data: FinanceSummaryInput, options: FinancialReportOptions = {}): FinancialReport {
  const now = options.now ?? new Date()
  const horizonMonths = options.forecastMonths ?? 6
  const position = buildFinancialPosition(data)
  const shield = buildInflationShield(data.assets, data.cards)
  const monthly = buildMonthlyCashFlow(data, now)
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
        `gelecek taksit ${tl(position.totalCardFutureInstallmentDebt)})`,
    )
  }
  if (position.totalLoanDebt > 0) debtLines.push(`Krediler (kalan): ${tl(position.totalLoanDebt)}`)
  if (position.totalPersonalDebts > 0) debtLines.push(`Kişisel borçlar: ${tl(position.totalPersonalDebts)}`)
  if (position.totalPaymentLiabilities > 0) debtLines.push(`Bekleyen ödemeler: ${tl(position.totalPaymentLiabilities)}`)
  if (debtLines.length === 0) debtLines.push('Kayıtlı borç yok.')
  sections.push({ heading: 'Borç Dağılımı', lines: debtLines })

  // 4. Bu ay nakit akışı
  sections.push({
    heading: `Bu Ay Nakit Akışı (${monthly.monthLabel})`,
    lines: [
      `Gelir: ${tl(monthly.income)}`,
      `Nakit çıkışı: ${tl(monthly.outflow)}`,
      `Net: ${tl(monthly.netFlow)}`,
      `Tahmini ay sonu nakit: ${tl(monthly.projectedCash)}`,
    ],
  })

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
        `Tahmini yıllık nakit çıkışı: ${tl(annualExpenses)} (son ${horizonMonths} ay ort. ×12)`,
        `Net değer / yıllık nakit çıkışı: ${coverageYears.toFixed(1)} yıl`,
      ],
      note: 'Kaba gösterge; getiri/enflasyon varsayımı içermez, hawl/taksit dağılımına göre değişir.',
    })
  }

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
  out.push('Para birimi: TL. Değerler rapor tarihindeki tahmini değerlerdir. Hesap/banka/kişi adı içermez (yalnız yapı + rakam).')

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
