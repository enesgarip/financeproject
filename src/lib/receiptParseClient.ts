import { supabase } from './supabase'
import { edgeErrorMessage } from './statementParseClient'
import { expenseCategories } from '../utils/categories'

/**
 * Parse a receipt / bill / bank-notification image into a single card expense,
 * via the `parse-receipt` Supabase edge function (which calls Gemini Flash
 * server-side so the API key stays off the client). The image is sent only for
 * parsing and is never stored.
 *
 * Throws a user-facing (Turkish) Error on failure so callers can surface it.
 */

export type ReceiptParseResult = {
  merchant: string
  /** Total amount in TRY (> 0). */
  amount: number
  /** YYYY-MM-DD, or '' when the date could not be read OR failed validation. */
  date: string
  /**
   * `expenseCategories` içindeki bir değer, ya da '' — model listede olmayan bir
   * kategori uydurduysa alan DÜŞÜRÜLÜR (bkz. sanitizeReceiptResult).
   */
  category: string
}

/** Read a File into a base64 string (without the data: prefix) plus its mime type. */
export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve({ base64: comma >= 0 ? result.slice(comma + 1) : result, mimeType: file.type || 'image/jpeg' })
    }
    reader.onerror = () => reject(new Error('Görsel okunamadı.'))
    reader.readAsDataURL(file)
  })
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * LLM çıktısı SÖZLEŞMEYE göre değil, isteğe göre üretilir: model uydurma bir
 * kategori ("Kırtasiye") ya da yerel biçimli bir tarih ("14.05.2026") dönebilir.
 * Bunlar doğrulanmadan forma yazılınca kategori sessizce listede olmayan bir
 * değere, tarih de geçersiz bir `date` input'una düşüyordu. Geçersiz alan
 * DÜŞÜRÜLÜR (boş bırakılır) — kullanıcı elle seçer, uydurma değer kaydedilmez.
 */
function sanitizeReceiptResult(raw: {
  merchant?: unknown
  amount: number
  date?: unknown
  category?: unknown
}): ReceiptParseResult {
  const category = typeof raw.category === 'string' ? raw.category.trim() : ''
  const date = typeof raw.date === 'string' ? raw.date.trim() : ''
  // Takvim geçerliliği de kontrol edilir: "2026-02-31" biçime uyar ama tarih değil.
  const dateValid = ISO_DATE_RE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)
  return {
    merchant: typeof raw.merchant === 'string' ? raw.merchant.trim() : '',
    amount: raw.amount,
    date: dateValid ? date : '',
    category: (expenseCategories as readonly string[]).includes(category) ? category : '',
  }
}

export async function parseReceiptImage(file: File): Promise<ReceiptParseResult> {
  const { base64, mimeType } = await fileToBase64(file)

  const { data, error } = await supabase.functions.invoke('parse-receipt', {
    body: { imageBase64: base64, mimeType },
  })

  if (error) {
    // Edge function returns a JSON { error } body on non-2xx; surface it (O3).
    throw new Error(await edgeErrorMessage(error, 'Fiş okunamadı, tekrar dene.'))
  }
  const result = (data as { result?: ReceiptParseResult } | null)?.result
  if (!result || typeof result.amount !== 'number' || result.amount <= 0) {
    throw new Error('Görselden bir tutar okunamadı.')
  }
  return sanitizeReceiptResult(result)
}
