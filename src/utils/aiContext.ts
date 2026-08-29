/**
 * AI asistan için kompakt finansal bağlam üretimi (/analiz/asistan).
 *
 * Snapshot'ın tamamını LLM'e göndermek hem token israfı hem gürültü; burada
 * financeSummary'nin hazır toplamları + sınırlı liste kesitleri sade Türkçe
 * metne dökülür. Edge function bu metni Gemini systemInstruction'ına gömer.
 *
 * Bölümler öncelik sırasıyla eklenir; `maxChars` aşılacaksa düşük öncelikli
 * bölümler SONDAN atılır — bölüm ortasından kırpma yok (yarım cümle LLM'i
 * yanıltır, eksik bölüm yanıltmaz).
 *
 * Para gösterimi formatSeritAmount ("12.480 ₺"): hem uygulama diliyle tutarlı
 * hem token açısından ucuz. Hesap/yuvarlama yok — rakamlar financeSummary'den
 * hazır gelir (money.ts disiplini orada).
 */
import type {
  Budget,
  CardExpense,
  SavingsGoal,
  SavingsGoalSource,
} from '../types/database'
import {
  buildFinancialPosition,
  buildMonthlyCashFlow,
  type FinanceSummaryInput,
} from './financeSummary'
import { formatSeritAmount } from './formatCurrency'
import { formatDate } from './date'

/** FinanceSnapshot'ın yapısal alt kümesi — sayfa snapshot'ı doğrudan geçirir. */
export type AiContextInput = FinanceSummaryInput & {
  cardExpenses: CardExpense[]
  budgets: Budget[]
  savingsGoalSources?: SavingsGoalSource[]
}

export type AiContextOptions = {
  now?: Date
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 12_000
const MAX_CARDS = 10
const MAX_PAYMENTS = 15
const MAX_CATEGORIES = 8
const MAX_EXPENSES = 20

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

/**
 * TL rakamı yalnız güvenli hedeflerde basılır: composite/çıpalı hedeflerde ve
 * kaynak-takipli hedeflerde target/current DB'de TL DEĞİLDİR (0 ya da birim) —
 * yanlış rakam konuşan asistandansa etiketle yetinen asistan iyidir.
 */
function goalLine(goal: SavingsGoal, sources: SavingsGoalSource[]) {
  const sourceTracked = sources.some((s) => s.goal_id === goal.id)
  const plainTl = goal.value_type === 'TRY' && goal.target_anchor === 'manual' && !sourceTracked
  if (plainTl) {
    return `- ${goal.name}: hedef ${tl(goal.target_amount)}, biriken ${tl(goal.current_amount)}`
  }
  const kind =
    goal.value_type === 'composite'
      ? 'karma hedef'
      : goal.target_anchor !== 'manual'
        ? 'çıpalı hedef (tutarı endeksli)'
        : 'kaynak-takipli hedef'
  return `- ${goal.name}: ${kind}; tutarını uygulamada görebilirsin`
}

export function buildAiFinanceContext(input: AiContextInput, options: AiContextOptions = {}): string {
  const now = options.now ?? new Date()
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const position = buildFinancialPosition(input)
  const flow = buildMonthlyCashFlow(input, now, { today: now })
  const currentMonth = monthKey(now)

  const sections: string[] = []

  // 1) Çerçeve — her zaman ilk sırada.
  sections.push(
    [
      `Tarih: ${day(localIsoDate(now))}. Tüm tutarlar TL.`,
      'Bu özet, kullanıcının uygulamadaki güncel verilerinden otomatik üretildi.',
    ].join('\n'),
  )

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

  // 4) Kartlar / hesaplar.
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

  // 5) Krediler — remaining_* alanları DB trigger'ıyla taksitlerden senkron.
  const loanLines = input.loans
    .filter((loan) => loan.status === 'active')
    .map((loan) => {
      const dayNote = loan.installment_day ? `, taksit günü ayın ${loan.installment_day}'i` : ''
      return `- ${loan.bank_name} ${loan.loan_name}: kalan ${tl(loan.remaining_amount)}, ${loan.remaining_installments} taksit, aylık ${tl(loan.monthly_payment)}${dayNote}`
    })
  if (loanLines.length > 0) sections.push(['KREDİLER', ...loanLines].join('\n'))

  // 6) Kişi borç/alacakları (açık olanlar).
  const debtLines = input.debts
    .filter((debt) => debt.status === 'açık')
    .map((debt) => {
      const label = debt.direction === 'borç_aldım' ? 'borcum' : 'alacağım'
      const due = debt.due_date ? `, vade ${day(debt.due_date)}` : ''
      return `- ${debt.person_name}: ${label} ${tl(debt.estimated_value_try)}${due}`
    })
  if (debtLines.length > 0) sections.push(['KİŞİ BORÇ/ALACAKLARI', ...debtLines].join('\n'))

  // 7) Yaklaşan planlı ödemeler (bekleyenler, vade sıralı).
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

  // 8) Bu ayın bütçeleri — kurallı limitte (anchor) rakam DB'de türetilir,
  //    burada yanlış 0 basmamak için yalnız etiket verilir.
  const budgetLines = input.budgets
    .filter((budget) => budget.month.slice(0, 7) === currentMonth)
    .map((budget) =>
      budget.limit_anchor === 'manual'
        ? `- ${budget.category}: limit ${tl(budget.limit_amount)}`
        : `- ${budget.category}: kurallı limit (uygulamada türetilir)`,
    )
  if (budgetLines.length > 0) sections.push(['BU AYIN BÜTÇELERİ', ...budgetLines].join('\n'))

  // 9) Birikim hedefleri.
  const goalLines = (input.savingsGoals ?? [])
    .filter((goal) => goal.status === 'active')
    .map((goal) => goalLine(goal, input.savingsGoalSources ?? []))
  if (goalLines.length > 0) sections.push(['BİRİKİM HEDEFLERİ', ...goalLines].join('\n'))

  // 10) Varlık kırılımı (kategori toplamları).
  const assetTotals = new Map<string, number>()
  for (const asset of input.assets) {
    const value = Number.isFinite(asset.estimated_value_try) ? asset.estimated_value_try : 0
    assetTotals.set(asset.category, (assetTotals.get(asset.category) ?? 0) + value)
  }
  const assetLine = [...assetTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, total]) => `${category} ${tl(total)}`)
    .join(' · ')
  if (assetLine) sections.push(`VARLIK KIRILIMI\n- ${assetLine}`)

  // 11) Bu ayın kart harcaması kategori dağılımı.
  const activeExpenses = input.cardExpenses.filter((expense) => expense.status !== 'cancelled')
  const monthExpenses = activeExpenses.filter((expense) => expense.spent_at.slice(0, 7) === currentMonth)
  const categoryTotals = new Map<string, number>()
  for (const expense of monthExpenses) {
    const value = Number.isFinite(expense.amount) ? expense.amount : 0
    categoryTotals.set(expense.category, (categoryTotals.get(expense.category) ?? 0) + value)
  }
  const categoryLines = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CATEGORIES)
    .map(([category, total]) => `- ${category}: ${tl(total)}`)
  if (categoryLines.length > 0) {
    sections.push([`BU AY KART HARCAMASI KATEGORİLERİ (${monthExpenses.length} işlem)`, ...categoryLines].join('\n'))
  }

  // 12) Son kart harcamaları.
  const expenseLines = activeExpenses
    .slice()
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, MAX_EXPENSES)
    .map((expense) => {
      const installments = expense.installment_count > 1 ? ` (${expense.installment_count} taksit)` : ''
      return `- ${day(expense.spent_at)}: ${expense.description} ${tl(expense.amount)} [${expense.category}]${installments}`
    })
  if (expenseLines.length > 0) sections.push(['SON KART HARCAMALARI', ...expenseLines].join('\n'))

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
