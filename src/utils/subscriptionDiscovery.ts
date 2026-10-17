/** Read-only discovery. Suggestions never enter financial projections until planned. */
import type { CardExpense, Payment } from '../types/database'
import { dateInputValue, startOfDay } from './date'
import { toKurus } from './money'
import { isVariableBill, paymentDescriptionMatches, paymentMatchKey, paymentMatchesExpense, paymentProvider } from './paymentMatching'

export type DiscoveryExpense = Pick<CardExpense, 'id' | 'card_id' | 'spent_at' | 'amount' | 'status' | 'description' | 'category' | 'installment_count' | 'note'>
export type DiscoveryPayment = Pick<Payment, 'id' | 'title' | 'amount' | 'amount_status' | 'payment_method' | 'auto_source_card_id' | 'status' | 'recurrence' | 'recurrence_day' | 'recurrence_end_date' | 'due_date' | 'match_merchant' | 'match_reference' | 'match_amount'>
export type SubscriptionCandidate = {
  id: string
  cardId: string
  merchant: string
  category: string
  amount: number
  dates: string[]
  confidence: 'possible' | 'strong'
  status: 'new' | 'planned' | 'missing_recurrence' | 'ambiguous'
  paymentId: string | null
  needsServiceName: boolean
  variable: boolean
  priceChanged: boolean
  /** A 28-day purchase must not silently become a monthly contract. */
  calendarMonthly: boolean
  isActive: boolean
}

export function discoverySince(now: Date = new Date()): string {
  return dateInputValue(new Date(now.getFullYear(), now.getMonth() - 5, 1))
}

function bankMerchantKey(description: string): string {
  return paymentMatchKey(description)
    .replace(/\b(london gbr|cork irl|istanbul tr|istanbul tur)$/, '').trim()
}

function merchantKey(description: string): string {
  const key = bankMerchantKey(description)
  // Statement parsers may truncate the processor suffix or join PRIME + TR.
  if (/^(iyzico )?amazonprimet$|^amazon prime$/.test(key)) return 'amazon prime'
  if (/^fs supercellstore\b/.test(key)) return key.replace(/\s+fsprg(?: nl)?(?: nld)?$/, '')
  return key
}

function digitalMerchant(description: string): boolean {
  return /\b(apple|youtube|spotify|netflix|amazonprimet|amazon prime|chatgpt|openai|supercellstore|adobe|microsoft|google one|blutv|exxen|disney)\b/.test(merchantKey(description))
}

function day(date: string): number { return Number(date.slice(8, 10)) }
function distance(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000
}
function closeAmount(a: number, b: number): boolean {
  return Math.abs(toKurus(a) - toKurus(b)) <= toKurus(b) * 0.15
}
function regular(rows: DiscoveryExpense[]): boolean {
  return rows.length >= 2 && new Set(rows.map((r) => r.spent_at.slice(0, 7))).size >= 2
    && rows.every((row, i) => i === 0 || (distance(rows[i - 1]!.spent_at, row.spent_at) >= 25
      && distance(rows[i - 1]!.spent_at, row.spent_at) <= 38))
}

function matchingPlans(rows: DiscoveryExpense[], payments: DiscoveryPayment[]): DiscoveryPayment[] {
  const last = rows.at(-1)!
  const apple = paymentProvider(last.description) === 'apple'
  return payments.filter((p) => p.status === 'bekliyor' && p.auto_source_card_id === last.card_id
    && p.payment_method === 'bank_auto'
    && (!p.recurrence_end_date || p.recurrence_end_date >= last.spent_at)
    && (paymentMatchesExpense(p, last.description, last.amount)
      || (!apple && (paymentDescriptionMatches(p, last.description)
        || (digitalMerchant(last.description) && !p.match_reference
          && merchantKey(p.match_merchant || p.title).replace(/ premium$/, '') === merchantKey(last.description).replace(/^google /, ''))))))
}

export function discoverSubscriptions(expenses: DiscoveryExpense[], payments: DiscoveryPayment[], now: Date = new Date()): SubscriptionCandidate[] {
  const cutoff = discoverySince(now)
  const today = dateInputValue(now)
  const activeSince = dateInputValue(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const groups = new Map<string, DiscoveryExpense[]>()
  const seen = new Set<string>()
  for (const row of expenses) {
    if (seen.has(row.id) || row.status !== 'posted' || row.installment_count > 1 || toKurus(row.amount) <= 0
      || row.spent_at < cutoff || row.spent_at > today || !row.description.trim()) continue
    seen.add(row.id)
    if (/odeme kaydindan olusturuldu/.test(paymentMatchKey(row.note))) continue
    const variable = isVariableBill(row.description)
    // Frequent shopping and fuel are not subscriptions, even at identical prices.
    if (!variable && !digitalMerchant(row.description)
      && ['Market', 'Ulaşım', 'Yeme & İçme', 'Alışveriş', 'Sağlık', 'Kişisel Bakım', 'Hediye'].includes(row.category)) continue
    const key = `${row.card_id}|${merchantKey(row.description)}`
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  const candidates: SubscriptionCandidate[] = []
  for (const [key, observations] of groups) {
    const rows = observations.sort((a, b) => a.spent_at.localeCompare(b.spent_at) || a.id.localeCompare(b.id))
    const apple = paymentProvider(rows[0]!.description) === 'apple'
    const variable = isVariableBill(rows[0]!.description)
    const used = new Set<string>()
    // Try every observed amount. An extra one-off purchase cannot poison a stream.
    const streams: DiscoveryExpense[][] = []
    for (const seed of rows) {
      const samePrice = rows.filter((r) => apple
        ? toKurus(r.amount) === toKurus(seed.amount) && Math.abs(day(r.spent_at) - day(seed.spent_at)) <= 3
        : variable || closeAmount(r.amount, seed.amount))
      if (regular(samePrice)) streams.push(samePrice)
      // A named digital merchant may change price on the same monthly schedule.
      if (!apple && digitalMerchant(seed.description)) {
        const calendar = rows.filter((r) => Math.abs(day(r.spent_at) - day(seed.spent_at)) <= 3)
        if (new Set(calendar.map((r) => r.spent_at.slice(0, 7))).size === calendar.length && regular(calendar)) streams.push(calendar)
      }
    }
    streams.sort((a, b) => b.length - a.length || b.at(-1)!.spent_at.localeCompare(a.at(-1)!.spent_at))
    for (const stream of streams) {
      if (stream.some((r) => used.has(r.id))) continue
      // Two utility contracts or duplicate charges in one month remain ambiguous.
      if (variable && new Set(stream.map((r) => r.spent_at.slice(0, 7))).size !== stream.length) continue
      stream.forEach((r) => used.add(r.id))
      const latest = stream.at(-1)!
      const plans = matchingPlans(stream, payments)
      const plan = plans.length === 1 ? plans[0]! : null
      // A named Apple plan may already use its new price (e.g. iCloud).
      // Old same-day charges are not proof of a second, missing service.
      const possibleApplePlan = apple && plans.length === 0 && payments.some((p) =>
        p.status === 'bekliyor' && p.payment_method === 'bank_auto' && p.auto_source_card_id === latest.card_id
        && p.recurrence === 'monthly' && (!p.recurrence_end_date || p.recurrence_end_date >= latest.spent_at)
        && Math.abs((p.recurrence_day ?? day(p.due_date)) - day(latest.spent_at)) <= 3
        && paymentDescriptionMatches(p, latest.description))
      // Provider-only resemblance cannot identify a phone line/utility contract.
      // A possible existing plan needs review rather than a second plan button.
      const possibleBillPlan = variable && plans.length === 0 && payments.some((p) =>
        p.status === 'bekliyor' && p.payment_method === 'bank_auto' && p.auto_source_card_id === latest.card_id
        && (!p.recurrence_end_date || p.recurrence_end_date >= latest.spent_at)
        && (paymentProvider(p.match_merchant || p.title)
          ?? (/telefon/.test(paymentMatchKey(p.title)) ? 'mobile' : null)) === paymentProvider(latest.description))
      const monthCount = new Set(stream.map((r) => r.spent_at.slice(0, 7))).size
      candidates.push({
        id: `${key}|${apple ? `${toKurus(latest.amount)}|${day(stream[0]!.spent_at)}` : toKurus(stream[0]!.amount)}`,
        cardId: latest.card_id, merchant: latest.description, category: latest.category, amount: latest.amount,
        dates: stream.map((r) => r.spent_at), confidence: monthCount >= 3 ? 'strong' : 'possible',
        status: plans.length > 1 || possibleApplePlan || possibleBillPlan ? 'ambiguous' : plan ? plan.recurrence === 'monthly' ? 'planned' : 'missing_recurrence' : 'new',
        paymentId: plan?.id ?? null, needsServiceName: apple && !plan, variable,
        priceChanged: stream.some((r) => !closeAmount(r.amount, latest.amount)),
        calendarMonthly: !/\bsupercellstore\b/.test(merchantKey(latest.description))
          && Math.max(...stream.map((r) => day(r.spent_at))) - Math.min(...stream.map((r) => day(r.spent_at))) <= 6,
        isActive: latest.spent_at >= activeSince,
      })
    }
  }
  return candidates.sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.amount - a.amount || a.id.localeCompare(b.id))
}

/** Editable metadata only: no payment posting, expense, balance or ledger writes. */
export function candidatePlanDraft(candidate: SubscriptionCandidate, title: string, recurrenceDay: number, now: Date = new Date()) {
  if (!title.trim() || (candidate.needsServiceName && merchantKey(title) === merchantKey(candidate.merchant))) return null
  if (!Number.isInteger(recurrenceDay) || recurrenceDay < 1 || recurrenceDay > 31) return null
  const due = (month: number) => new Date(now.getFullYear(), month, Math.min(recurrenceDay, new Date(now.getFullYear(), month + 1, 0).getDate()))
  let date = due(now.getMonth())
  if (date < startOfDay(now)) date = due(now.getMonth() + 1)
  return {
    title: title.trim(), category: candidate.variable ? 'Fatura' as const
      : digitalMerchant(candidate.merchant) || candidate.category === 'Abonelik' ? 'Dijital üyelik' as const
        : candidate.category === 'Sigorta' ? 'Sigorta' as const
          : candidate.category === 'Eğitim' ? 'Eğitim' as const : 'Diğer' as const,
    amount: candidate.amount, amount_status: 'estimated' as const, due_date: dateInputValue(date),
    status: 'bekliyor' as const, payment_method: 'bank_auto' as const, auto_source_card_id: candidate.cardId,
    recurrence: 'monthly' as const, recurrence_day: recurrenceDay, recurrence_end_date: null,
    match_merchant: bankMerchantKey(candidate.merchant), match_amount: candidate.variable ? null : candidate.amount,
    note: 'Ekstre tekrarları incelenerek aylık plan oluşturuldu.',
  }
}
