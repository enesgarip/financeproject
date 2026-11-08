import type { FinanceObligation } from './obligations'

/** Yanıtı belirsiz yazma, modal/yenileme sonrasında da aynı kimlikle doğrulanır. */
export type PaymentAttempt = {
  id: string
  accountId: string | null
  amount: number
  obligationAmount: number
  skipSourceDebit: boolean
  paidAt?: string
}

function key(userId: string, intent: FinanceObligation) {
  return `denge:payment-attempt:v1:${userId}:${intent.action}:${intent.sourceId}`
}

export function readPaymentAttempt(userId: string, intent: FinanceObligation): PaymentAttempt | null {
  const raw = localStorage.getItem(key(userId, intent))
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    throw new Error('Önceki ödeme kaydı okunamadı. Yeni kayıt girmeden işlem geçmişini kontrol et.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Önceki ödeme kaydı okunamadı. İşlem geçmişini kontrol et.')
  const value = parsed as PaymentAttempt
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.id)
    || !(value.accountId === null || typeof value.accountId === 'string')
    || !Number.isFinite(value.amount) || value.amount <= 0 || !Number.isFinite(value.obligationAmount)
    || typeof value.skipSourceDebit !== 'boolean'
    || (value.paidAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value.paidAt))) {
    throw new Error('Önceki ödeme kaydı okunamadı. Yeni kayıt girmeden işlem geçmişini kontrol et.')
  }
  return value
}

export function savePaymentAttempt(userId: string, intent: FinanceObligation, attempt: PaymentAttempt) {
  localStorage.setItem(key(userId, intent), JSON.stringify(attempt))
}

export function clearPaymentAttempt(userId: string, intent: FinanceObligation) {
  // Temizleme başarısızsa kalan kayıt yalnız aynı sunucu makbuzunu tekrar okur.
  try { localStorage.removeItem(key(userId, intent)) } catch { /* Tekrar güvenliği korunur. */ }
}

/** Kullanıcının açıkça sıfırladığı/geri yüklediği veriyle eski niyeti karıştırma. */
export function clearUserPaymentAttempts(userId: string) {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const storageKey of keys) if (storageKey?.startsWith(`denge:payment-attempt:v1:${userId}:`) || storageKey?.startsWith(`denge:car-service-attempt:v1:${userId}:`)) localStorage.removeItem(storageKey)
  } catch { /* Depolamaya erişilemezse eski kayıt yeni niyet gibi gönderilmez. */ }
}
