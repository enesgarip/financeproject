import { toKurus } from './money'

/** SQL twins: private.payment_match_key / payment_provider / payment_matches_expense. */
export function paymentMatchKey(value: string | null | undefined): string {
  return (value ?? '').replace(/[Iİı]/g, 'i').toLowerCase()
    .replace(/[şğüöç]/g, (c) => ({ ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' })[c]!)
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function paymentProvider(value: string): string | null {
  const key = paymentMatchKey(value)
  if (/^su( faturasi)?$|\b(buski|iski|aski)\b/.test(key)) return 'water'
  if (/^elektrik( faturasi)?$|\b(uludag elektrik|enerjisa|uedas)\b/.test(key)) return 'electricity'
  if (/^(dogalgaz|dogal gaz)( faturasi)?$|\b(igdas|bursagaz)\b|\baksa\b.*\b(dogalgaz|dogal gaz)\b/.test(key)) return 'gas'
  if (/^internet( faturasi)?$|\b(turknet|superonline|turk telekom internet)\b/.test(key)) return 'internet'
  if (/^telefon( faturasi)?$|\b(turk telekom mobil|vodafone|turkcell)\b/.test(key)) return 'mobile'
  if (/\b(icloud)\b/.test(key)) return 'icloud'
  if (/\b(chatgpt|openai)\b/.test(key)) return 'chatgpt'
  if (/\bapple\b/.test(key)) return 'apple'
  return null
}

export function isVariableBill(value: string): boolean {
  return ['water', 'electricity', 'gas', 'internet', 'mobile'].includes(paymentProvider(value) ?? '')
}

export type PaymentMatchRule = {
  title: string
  amount: number
  amount_status: string
  match_merchant?: string | null
  match_reference?: string | null
  match_amount?: number | null
}

export function paymentDescriptionMatches(rule: PaymentMatchRule, description: string): boolean {
  const expected = paymentMatchKey(rule.match_merchant || rule.title)
  const actual = paymentMatchKey(description)
  if (!expected || !actual) return false
  const reference = paymentMatchKey(rule.match_reference)
  if (reference && !(` ${actual} `).includes(` ${reference} `)) return false
  const left = paymentProvider(expected)
  const right = paymentProvider(actual)
  if ((left === 'icloud' || left === 'chatgpt') && right === 'apple') return true
  // An explicit merchant is narrower than the generic provider alias.
  if (rule.match_merchant) return (` ${actual} `).includes(` ${expected} `)
  if (left || right) return left === right && (
    /^(su|elektrik|dogalgaz|dogal gaz|internet|telefon)( faturasi)?$/.test(expected)
    || (` ${actual} `).includes(` ${expected} `)
  )
  return (` ${actual} `).includes(` ${expected} `)
}

export function paymentMatchesExpense(rule: PaymentMatchRule, description: string, amount: number): boolean {
  if (toKurus(amount) <= 0 || !paymentDescriptionMatches(rule, description)) return false
  const provider = paymentProvider(rule.match_merchant || rule.title)
  const expected = rule.match_amount ?? rule.amount
  if (rule.match_amount != null || provider === 'icloud' || provider === 'chatgpt' || provider === 'apple') {
    return toKurus(amount) === toKurus(expected)
  }
  if (rule.amount_status === 'estimated' && isVariableBill(rule.match_merchant || rule.title)) return true
  return Math.abs(toKurus(amount) - toKurus(expected)) <= 500
}
