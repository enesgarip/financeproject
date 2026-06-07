import { supabase } from './supabase'

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
  /** YYYY-MM-DD, or '' when the date could not be read. */
  date: string
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

export async function parseReceiptImage(file: File): Promise<ReceiptParseResult> {
  const { base64, mimeType } = await fileToBase64(file)

  const { data, error } = await supabase.functions.invoke('parse-receipt', {
    body: { imageBase64: base64, mimeType },
  })

  if (error) {
    // Edge function returns a JSON { error } body on non-2xx; surface it if present.
    const context = (error as { context?: { error?: string } })?.context
    throw new Error(context?.error ?? 'Fiş okunamadı, tekrar dene.')
  }
  const result = (data as { result?: ReceiptParseResult } | null)?.result
  if (!result || typeof result.amount !== 'number' || result.amount <= 0) {
    throw new Error('Görselden bir tutar okunamadı.')
  }
  return result
}
