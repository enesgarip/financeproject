/**
 * AI asistan için kompakt finansal bağlam üretimi (/analiz/asistan).
 *
 * Snapshot'ın tamamını LLM'e göndermek hem token israfı hem gürültü; burada
 * financeSummary'nin hazır toplamları + sınırlı liste kesitleri sade Türkçe
 * metne dökülür. Edge function bu metni Gemini systemInstruction'ına gömer.
 *
 * Kapsam ilkesi: uygulamanın herhangi bir ekranda GÖSTEREBİLDİĞİ türetilmiş
 * rakam burada da basılır (taksit takvimi, bütçe gerçekleşmesi, hedef türetimi,
 * gelecek ay projeksiyonu) — asistanın "bu veriyi göremiyorum" demesi yalnız
 * gerçekten üretilemeyen değerlerde kalmalı. Türetme her zaman ekranların
 * kullandığı util'e delege edilir (buildBudgetUsage, resolveSavingsGoalRows,
 * buildCardInstallmentCalendar, buildMonthlyCashFlow) ki asistan ile ekran
 * asla farklı rakam söylemesin.
 *
 * Bölümler öncelik sırasıyla eklenir; `maxChars` aşılacaksa düşük öncelikli
 * bölümler SONDAN atılır — bölüm ortasından kırpma yok (yarım cümle LLM'i
 * yanıltır, eksik bölüm yanıltmaz).
 *
 * Para gösterimi formatSeritAmount ("12.480 ₺"): hem uygulama diliyle tutarlı
 * hem token açısından ucuz. Toplama sumTL ile (money.ts disiplini); kur ve
 * altın-birim gösterimleri bilinçli para-dışıdır (formatNumber, 2 hane).
 */
import type {
  Budget,
  CardExpense,
  KasaBucket,
  SavingsGoal,
  SavingsGoalSource,
  TransactionHistory,
} from '../types/database'
import { buildBudgetUsage } from './budgetAlerts'
import { buildCardInstallmentCalendar } from './cardInstallmentCalendar'
import { addMonths, formatDate, startOfMonth } from './date'
import {
  buildFinancialPosition,
  buildMonthlyCashFlow,
  getSalaryForDate,
  type FinanceSummaryInput,
} from './financeSummary'
import { formatNumber, formatSeritAmount } from './formatCurrency'
import { resolveSavingsGoalRows, type ResolvedSavingsGoals } from './goalSources'
import { averageMonthlyOutflow, goalTargetAnchorLabel } from './goalTargetAnchor'
import { unitRate, type MarketRatesSnapshot, type RateSymbol } from './marketRates'
import { sumTL } from './money'

/** FinanceSnapshot'ın yapısal alt kümesi — sayfa snapshot'ı doğrudan geçirir. */
export type AiContextInput = FinanceSummaryInput & {
  cardExpenses: CardExpense[]
  budgets: Budget[]
  savingsGoalSources?: SavingsGoalSource[]
  /** Son hareketler bölümü + "N aylık gider" hedef çıpası bu listeden türer. */
  transactionHistory?: TransactionHistory[]
}

export type AiContextOptions = {
  now?: Date
  maxChars?: number
  /** Canlı kur: verilirse kur satırı basılır ve altın/USD çıpalı hedef tutarı çözülür. */
  ratesSnapshot?: MarketRatesSnapshot | null
  /** Kasa kovaları: kovaya bağlı hedefin biriken tutarı bunlarsız türetilemez. */
  kasaBuckets?: KasaBucket[] | null
}

// Edge function bağlamı 24k karakterde reddeder (MAX_CONTEXT_CHARS); bölüm
// atma mekanizması yerine sunucu reddine düşmemek için altında kalınır.
const DEFAULT_MAX_CHARS = 16_000
const MAX_CARDS = 10
const MAX_PAYMENTS = 15
const MAX_CATEGORIES = 8
const MAX_EXPENSES = 20
const MAX_INSTALLMENT_PLANS = 12
const MAX_HISTORY = 10
const INSTALLMENT_MONTHS = 6
const TREND_MONTHS = 6

/** NaN/Infinity asla metne sızmasın: bozuk değer 0 gibi gösterilir. */
function tl(value: number | null | undefined) {
  return formatSeritAmount(Number.isFinite(value ?? 0) ? (value ?? 0) : 0)
}

/** timestamptz gelirse de güvenli: formatDate date-only bekler (CLAUDE gotcha). */
function day(value: string | null | undefined) {
  return formatDate(value ? value.slice(0, 10) : null)
}

/** Yerel takvim günü — toISOString UTC'ye kayar, TR'de akşam saatlerinde gün geriler. */
function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthKey(date: Date) {
  return localIsoDate(date).slice(0, 7)
}

function monthLabelOf(dateLike: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${dateLike.slice(0, 7)}-01T00:00:00`))
}

function shortMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric' }).format(date)
}

/** Sayaç gösterimi (karma hedef bileşenleri): bozuk değer 0 sayılır. */
function count(value: number | null | undefined) {
  return Number.isFinite(value ?? 0) ? String(value ?? 0) : '0'
}

/** Hedef tutarı hedefin biriminde: TL ise Şerit biçimi, altın ise birim + ad. */
function goalAmountText(valueType: SavingsGoal['value_type'], amount: number) {
  const safe = Number.isFinite(amount) ? amount : 0
  if (valueType === 'gram_altin') return `${formatNumber(safe)} gram altın`
  if (valueType === 'ceyrek_altin') return `${formatNumber(safe)} çeyrek altın`
  return tl(safe)
}

/**
 * Hedef satırı, TÜRETİLMİŞ değerlerle (resolveSavingsGoalRows çıktısı üzerinden).
 * Rakam yalnız iki taraf da güvenle çözülmüşse basılır:
 *  - biriken: kaynak bağı yoksa saklı değer; bağ varsa eksik/uygunsuz kaynak
 *    OLMAYAN çözüm (kirli toplamı gerçek sanan asistan, hiç bilmeyenden kötü),
 *  - hedef: çıpasızsa saklı değer; çıpalıysa taze (stale olmayan) çözüm.
 */
function goalLine(goal: SavingsGoal, resolved: ResolvedSavingsGoals) {
  if (goal.value_type === 'composite') {
    return `- ${goal.name}: karma hedef, ${count(goal.current_amount)}/${count(goal.target_amount)} bileşen hedefinde`
  }

  const resolution = resolved.goalResolutions.get(goal.id)
  const target = resolved.targetResolutions.get(goal.id)
  const anchored = goal.target_anchor !== 'manual'

  const currentClean = !resolution || (resolution.missing.length === 0 && resolution.unusable.length === 0)
  const targetClean = !anchored || (target !== undefined && !target.stale)
  if (!currentClean || !targetClean) {
    const kind = anchored ? 'çıpalı hedef (tutarı endeksli)' : 'kaynak-takipli hedef'
    return `- ${goal.name}: ${kind}; güncel tutarı uygulamada görebilirsin`
  }

  const anchorNote = anchored ? ` (çıpa: ${goalTargetAnchorLabel(goal) ?? 'endeksli'})` : ''
  const trackedNote = resolution ? ' — kaynaklardan türetildi' : ''
  return `- ${goal.name}: hedef ${goalAmountText(goal.value_type, goal.target_amount)}${anchorNote}, biriken ${goalAmountText(goal.value_type, goal.current_amount)}${trackedNote}`
}

/** Kur satırı: yalnız veri gelen semboller; alış tarafı (varlık değerlemesiyle aynı taraf). */
function ratesLine(snapshot: MarketRatesSnapshot | null | undefined) {
  if (!snapshot) return null
  const labels: Array<[RateSymbol, string]> = [
    ['USD', 'USD'],
    ['EUR', 'EUR'],
    ['GRA', 'gram altın'],
    ['CEYREKALTIN', 'çeyrek altın'],
  ]
  const parts = labels
    .map(([symbol, label]) => {
      const rate = unitRate(symbol, snapshot, 'buying')
      return rate === null ? null : `${label} ${formatNumber(rate)} TL`
    })
    .filter((part): part is string => part !== null)
  return parts.length > 0 ? `Piyasa kurları (alış): ${parts.join(' · ')}` : null
}

export function buildAiFinanceContext(input: AiContextInput, options: AiContextOptions = {}): string {
  const now = options.now ?? new Date()
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const position = buildFinancialPosition(input)
  const flow = buildMonthlyCashFlow(input, now, { today: now })
  const currentMonth = monthKey(now)
  const history = input.transactionHistory ?? []

  const sections: string[] = []

  // 1) Çerçeve — her zaman ilk sırada.
  const frame = [
    `Tarih: ${day(localIsoDate(now))}. Tüm tutarlar TL.`,
    'Bu özet, kullanıcının uygulamadaki güncel verilerinden otomatik üretildi.',
  ]
  const rates = ratesLine(options.ratesSnapshot)
  if (rates) frame.splice(1, 0, rates)
  sections.push(frame.join('\n'))

  // 2) Finansal pozisyon (bilanço stoku).
  sections.push(
    [
      'FİNANSAL POZİSYON',
      `- Net değer: ${tl(position.netWorth)} (alacaklar tahsil edilirse ${tl(position.netWorthIfReceivablesCollected)})`,
      `- Toplam varlık: ${tl(position.totalAssets)} (nakit + vadesiz: ${tl(position.totalCashAssets)})`,
      `- Toplam borç: ${tl(position.totalDebts)}`,
      `- Kredi kartı borcu: ${tl(position.totalCreditCardDebt)} (ekstre ${tl(position.totalCardStatementDebt)}, dönem içi ${tl(position.totalCardCurrentPeriod)}, provizyon ${tl(position.totalCardProvision)}, gelecek taksitler ${tl(position.totalCardFutureInstallmentDebt)})`,
      `- Kredi borcu: ${tl(position.totalLoanDebt)}`,
      `- Kişilere borç: ${tl(position.totalPersonalDebts)}, alacak: ${tl(position.totalReceivables)}`,
    ].join('\n'),
  )

  // 3) Bu ayın nakit akışı.
  sections.push(
    [
      `BU AY (${flow.monthLabel})`,
      `- Gelir: ${tl(flow.income)} (maaş ${tl(flow.salaryIncome)}), beklenen ek gelir: ${tl(flow.expectedIncome)}`,
      `- Ay toplam çıkışı: ${tl(flow.outflow)} (kart ${tl(flow.cardOutflow)}, kredi ${tl(flow.loanOutflow)}, planlı ödeme ${tl(flow.paymentOutflow)}, kişi borcu ${tl(flow.debtOutflow)})`,
      `- Bugünden ay sonuna kalan çıkış: ${tl(flow.remainingOutflow)}`,
      `- Net akış: ${tl(flow.netFlow)}, ay sonu nakit projeksiyonu: ${tl(flow.projectedCash)}`,
    ].join('\n'),
  )

  // 4) Gelecek ayın bilinen kalemleri — "önümüzdeki ay beni ne bekliyor?"
  //    sorusu bağlamsız kalmasın. Aynı motor (obligations) gelecek ay için koşar;
  //    kart kalemi ekstre/taksit projeksiyonudur, kesinleşmiş borç değildir.
  const nextFlow = buildMonthlyCashFlow(input, addMonths(startOfMonth(now), 1), { today: now })
  sections.push(
    [
      `GELECEK AY (${nextFlow.monthLabel}) — bugünden bilinen kalemler`,
      `- Beklenen gelir: ${tl(nextFlow.income)} (maaş ${tl(nextFlow.salaryIncome)})`,
      `- Bilinen çıkış: ${tl(nextFlow.outflow)} (kart ${tl(nextFlow.cardOutflow)}, kredi ${tl(nextFlow.loanOutflow)}, planlı ödeme ${tl(nextFlow.paymentOutflow)}, kişi borcu ${tl(nextFlow.debtOutflow)})`,
      `- Bilinen net: ${tl(nextFlow.netFlow)}`,
    ].join('\n'),
  )

  // 5) Kartlar / hesaplar.
  const cardLines = input.cards.slice(0, MAX_CARDS).map((card) => {
    const name = `${card.bank_name} ${card.card_name}`.trim()
    if (card.card_type === 'kredi_karti') {
      const cut = card.statement_day ? `kesim ayın ${card.statement_day}'i` : 'kesim günü yok'
      const due = card.due_day ? `son ödeme ayın ${card.due_day}'i` : 'son ödeme günü yok'
      return `- ${name} (kredi kartı): borç ${tl(card.debt_amount)} (ekstre ${tl(card.statement_debt_amount)}, dönem içi ${tl(card.current_period_spending)}, provizyon ${tl(card.provision_amount)}); ${cut}, ${due}`
    }
    return `- ${name} (banka hesabı): bakiye ${tl(card.current_balance)}`
  })
  if (cardLines.length > 0) sections.push(['KARTLAR VE HESAPLAR', ...cardLines].join('\n'))

  // 6) Kart taksit takvimi — henüz borca yazılmamış (scheduled) gelecek taksitler.
  //    'posted' satırlar kartın dönem içi/ekstre borcunda zaten sayılı; buraya
  //    katmak ayı çift şişirirdi (buildCardInstallmentCalendar aynı kuralı uygular).
  const installmentMonths = buildCardInstallmentCalendar(input.cardInstallments, input.cards, INSTALLMENT_MONTHS, now)
    .filter((month) => month.total > 0)
    .map((month) => `${month.monthLabel} ${tl(month.total)}`)

  type PlanEntry = {
    description: string
    cardId: string
    amount: number
    remaining: number
    total: number
    firstMonth: string
    lastMonth: string
  }
  const planMap = new Map<string, PlanEntry>()
  for (const item of input.cardInstallments) {
    if (item.status !== 'scheduled') continue
    const key = item.card_expense_id ? `exp:${item.card_expense_id}` : `desc:${item.card_id}:${item.description}:${item.installment_count}`
    const entry = planMap.get(key)
    if (!entry) {
      planMap.set(key, {
        description: item.description || 'Taksitli harcama',
        cardId: item.card_id,
        amount: item.amount,
        remaining: 1,
        total: item.installment_count,
        firstMonth: item.due_month,
        lastMonth: item.due_month,
      })
      continue
    }
    entry.remaining += 1
    if (item.due_month < entry.firstMonth) {
      // Aylık tutar en yakın vadenin satırından okunur (satırlar normalde eşittir).
      entry.firstMonth = item.due_month
      entry.amount = item.amount
    }
    if (item.due_month > entry.lastMonth) entry.lastMonth = item.due_month
  }
  const cardNameById = new Map(input.cards.map((card) => [card.id, `${card.bank_name} ${card.card_name}`.trim()]))
  const plans = [...planMap.values()].sort((a, b) => b.amount - a.amount)
  const planLines = plans.slice(0, MAX_INSTALLMENT_PLANS).map((plan) => {
    const cardName = cardNameById.get(plan.cardId) ?? 'Kart'
    return `- ${plan.description} (${cardName}): aylık ${tl(plan.amount)}, kalan ${plan.remaining}/${plan.total} taksit, bitiş ${monthLabelOf(plan.lastMonth)}`
  })
  if (plans.length > MAX_INSTALLMENT_PLANS) planLines.push(`- … ve ${plans.length - MAX_INSTALLMENT_PLANS} plan daha`)
  if (installmentMonths.length > 0 || planLines.length > 0) {
    const lines = ['KART TAKSİT TAKVİMİ (henüz borca yazılmamış gelecek taksitler)']
    if (installmentMonths.length > 0) lines.push(`- Aylık toplam: ${installmentMonths.join(' · ')}`)
    lines.push(...planLines)
    sections.push(lines.join('\n'))
  }

  // 7) Krediler — remaining_* alanları DB trigger'ıyla taksitlerden senkron.
  const loanLines = input.loans
    .filter((loan) => loan.status === 'active')
    .map((loan) => {
      const dayNote = loan.installment_day ? `, taksit günü ayın ${loan.installment_day}'i` : ''
      return `- ${loan.bank_name} ${loan.loan_name}: kalan ${tl(loan.remaining_amount)}, ${loan.remaining_installments} taksit, aylık ${tl(loan.monthly_payment)}${dayNote}`
    })
  if (loanLines.length > 0) sections.push(['KREDİLER', ...loanLines].join('\n'))

  // 8) Kişi borç/alacakları (açık olanlar).
  const debtLines = input.debts
    .filter((debt) => debt.status === 'açık')
    .map((debt) => {
      const label = debt.direction === 'borç_aldım' ? 'borcum' : 'alacağım'
      const due = debt.due_date ? `, vade ${day(debt.due_date)}` : ''
      return `- ${debt.person_name}: ${label} ${tl(debt.estimated_value_try)}${due}`
    })
  if (debtLines.length > 0) sections.push(['KİŞİ BORÇ/ALACAKLARI', ...debtLines].join('\n'))

  // 9) Yaklaşan planlı ödemeler (bekleyenler, vade sıralı).
  const todayIso = localIsoDate(now)
  const paymentLines = input.payments
    .filter((payment) => payment.status === 'bekliyor')
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, MAX_PAYMENTS)
    .map((payment) => {
      const late = payment.due_date.slice(0, 10) < todayIso ? ' (GECİKMİŞ)' : ''
      const recurring = payment.recurrence === 'monthly' ? ', aylık tekrar' : ''
      return `- ${day(payment.due_date)}: ${payment.title} ${tl(payment.amount)}${recurring}${late}`
    })
  if (paymentLines.length > 0) sections.push(['YAKLAŞAN PLANLI ÖDEMELER', ...paymentLines].join('\n'))

  // 10) Bu ayın bütçeleri — gerçekleşmeyle birlikte. Kurallı limitler ekranların
  //     kullandığı çözümle türetilir (buildBudgetUsage → resolveBudgetRows);
  //     maaşsız salary_pct gibi çözülemeyen satır rakam uydurmaz.
  const salary = getSalaryForDate(input.salaryHistory, todayIso)?.amount ?? null
  const budgetLines = buildBudgetUsage(input.budgets, input.cardExpenses, now, salary).map((usage) => {
    if (usage.limit <= 0 && usage.anchorLabel) {
      return `- ${usage.category}: kurallı limit (${usage.anchorLabel}) şu an hesaplanamıyor; harcanan ${tl(usage.spent)}`
    }
    const rule = usage.anchorLabel ? ` [kural: ${usage.anchorLabel}]` : ''
    const state = usage.status === 'over' ? ' — LİMİT AŞILDI' : usage.status === 'warning' ? ' — %80 eşiği geçildi' : ''
    return `- ${usage.category}: limit ${tl(usage.limit)}${rule}, harcanan ${tl(usage.spent)} (%${Math.round(usage.usageRate)})${state}`
  })
  if (budgetLines.length > 0) sections.push(['BU AYIN BÜTÇELERİ', ...budgetLines].join('\n'))

  // 11) Birikim hedefleri — ekranlarla aynı türetme (goalSources). Kur/kova
  //     verilmediyse ilgili hedef rakamsız etikete düşer, yanlış sayı basılmaz.
  const resolvedGoals = resolveSavingsGoalRows(
    input.savingsGoals ?? [],
    input.savingsGoalComponents ?? [],
    input.savingsGoalSources ?? [],
    {
      assets: input.assets,
      cards: input.cards,
      buckets: options.kasaBuckets ?? undefined,
      snapshot: options.ratesSnapshot ?? null,
      monthlyOutflow: averageMonthlyOutflow(history, input.payments, input.cards, 6, now),
    },
  )
  const goalLines = resolvedGoals.goals
    .filter((goal) => goal.status === 'active')
    .map((goal) => goalLine(goal, resolvedGoals))
  if (goalLines.length > 0) sections.push(['BİRİKİM HEDEFLERİ', ...goalLines].join('\n'))

  // 12) Varlık kırılımı (kategori toplamları).
  const assetTotals = new Map<string, number>()
  for (const asset of input.assets) {
    const value = Number.isFinite(asset.estimated_value_try) ? asset.estimated_value_try : 0
    assetTotals.set(asset.category, sumTL([assetTotals.get(asset.category), value]))
  }
  const assetLine = [...assetTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => `${category} ${tl(total)}`)
    .join(' · ')
  if (assetLine) sections.push(`VARLIK KIRILIMI\n- ${assetLine}`)

  // 13) Bu ayın kart harcaması kategori dağılımı.
  const activeExpenses = input.cardExpenses.filter((expense) => expense.status !== 'cancelled')
  const monthExpenses = activeExpenses.filter((expense) => expense.spent_at.slice(0, 7) === currentMonth)
  const categoryTotals = new Map<string, number>()
  for (const expense of monthExpenses) {
    const value = Number.isFinite(expense.amount) ? expense.amount : 0
    categoryTotals.set(expense.category, sumTL([categoryTotals.get(expense.category), value]))
  }
  const categoryLines = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CATEGORIES)
    .map(([category, total]) => `- ${category}: ${tl(total)}`)
  if (categoryLines.length > 0) {
    sections.push([`BU AY KART HARCAMASI KATEGORİLERİ (${monthExpenses.length} işlem)`, ...categoryLines].join('\n'))
  }

  // 14) Son kart harcamaları.
  const expenseLines = activeExpenses
    .slice()
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, MAX_EXPENSES)
    .map((expense) => {
      const installments = expense.installment_count > 1 ? ` (${expense.installment_count} taksit)` : ''
      return `- ${day(expense.spent_at)}: ${expense.description} ${tl(expense.amount)} [${expense.category}]${installments}`
    })
  if (expenseLines.length > 0) sections.push(['SON KART HARCAMALARI', ...expenseLines].join('\n'))

  // 15) Aylık harcama trendi — "geçen aylara göre nasılım?" sorusunun zemini.
  const trendParts: string[] = []
  let trendTotal = 0
  for (let offset = TREND_MONTHS; offset >= 0; offset -= 1) {
    const month = addMonths(startOfMonth(now), -offset)
    const key = monthKey(month)
    const total = sumTL(
      activeExpenses.filter((expense) => expense.spent_at.slice(0, 7) === key).map((expense) => (Number.isFinite(expense.amount) ? expense.amount : 0)),
    )
    trendTotal = sumTL([trendTotal, total])
    trendParts.push(`${shortMonthLabel(month)} ${tl(total)}`)
  }
  if (trendTotal > 0) {
    sections.push(`AYLIK KART HARCAMASI TRENDİ (son ${TREND_MONTHS} ay + bu ay)\n- ${trendParts.join(' · ')}`)
  }

  // 16) Son hareketler (ödeme/tahsilat/düzeltme kayıtları) — "şunu ödedim mi?"
  const historyLines = history
    .slice()
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, MAX_HISTORY)
    .map((item) => {
      const amount = item.amount !== null && Number.isFinite(item.amount) ? ` ${tl(item.amount)}` : ''
      return `- ${day(item.occurred_at)}: ${item.title}${amount}`
    })
  if (historyLines.length > 0) sections.push(['SON HAREKETLER', ...historyLines].join('\n'))

  // Bütçe aşımı: bölümler öncelik sırasıyla eklenir; sığmayan ilk bölümde durulur
  // (o ve sonrası atılır). İlk üç bölüm kısa olduğundan pratikte hep sığar.
  const kept: string[] = []
  let length = 0
  for (const section of sections) {
    const addition = (kept.length > 0 ? 2 : 0) + section.length
    if (length + addition > maxChars) break
    kept.push(section)
    length += addition
  }

  return kept.join('\n\n')
}
