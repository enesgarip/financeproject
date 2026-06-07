// Supabase Edge Function: parse-receipt
// Extracts a single card expense from a photo/screenshot of a receipt, bill or
// bank notification using Google Gemini Flash (vision). The browser sends a
// base64 image; this function calls Gemini server-side so the API key never
// reaches the client, and returns a clean { merchant, amount, date, category }.
//
// Deploy:  supabase functions deploy parse-receipt
// Secret:  supabase secrets set GEMINI_API_KEY=...   (from https://aistudio.google.com/app/apikey)
// Invoke:  supabase.functions.invoke('parse-receipt', { body: { imageBase64, mimeType } })
//
// The image is forwarded to Google only for parsing and is never stored.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Must mirror src/utils/categories.ts expenseCategories.
const CATEGORIES = ['Market', 'Yemek', 'Ulaşım', 'Alışveriş', 'Fatura', 'Sağlık', 'Eğlence', 'Eğitim', 'Diğer']
const MODEL = 'gemini-2.5-flash'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // ~8 MB of base64

const PROMPT = `Sen bir Türkçe fiş/fatura okuyucususun. Verilen görsel bir alışveriş fişi, fatura veya banka harcama bildirimidir.
Görselden tek bir harcamayı çıkar ve SADECE şu JSON şemasında yanıt ver:
{"merchant": string, "amount": number, "date": "YYYY-MM-DD", "category": string}
Kurallar:
- amount: ödenen TOPLAM tutar (TL), sadece sayı (ondalık nokta ile). KDV dahil genel toplamı al.
- date: fiş/işlem tarihi YYYY-MM-DD. Tarih okunamıyorsa boş string "".
- merchant: mağaza/işyeri adı veya kısa açıklama.
- category: şunlardan biri olmalı: ${CATEGORIES.join(', ')}. Emin değilsen "Diğer".
- Görsel bir harcama içermiyorsa amount: 0 döndür.`

type ParsedReceipt = { merchant: string; amount: number; date: string; category: string }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function coerceResult(raw: unknown): ParsedReceipt {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const amount = typeof obj.amount === 'number' ? obj.amount : Number(obj.amount)
  const category = typeof obj.category === 'string' && CATEGORIES.includes(obj.category) ? obj.category : 'Diğer'
  const date = typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) ? obj.date : ''
  return {
    merchant: typeof obj.merchant === 'string' ? obj.merchant.trim().slice(0, 120) : '',
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    date,
    category,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY tanımlı değil.' }, 500)

  let body: { imageBase64?: unknown; mimeType?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Geçersiz istek gövdesi.' }, 400)
  }

  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  if (!imageBase64 || !mimeType.startsWith('image/')) {
    return jsonResponse({ error: 'Geçerli bir görsel gönderilmedi.' }, 400)
  }
  if (imageBase64.length > MAX_IMAGE_BYTES) {
    return jsonResponse({ error: 'Görsel çok büyük (en fazla ~6 MB).' }, 413)
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`
  const payload = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }

  let geminiText: string
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      return jsonResponse({ error: `Gemini hatası (${res.status}).` }, 502)
    }
    const json = await res.json()
    geminiText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  } catch {
    return jsonResponse({ error: 'Görsel okunamadı, tekrar dene.' }, 502)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(geminiText)
  } catch {
    return jsonResponse({ error: 'Yanıt çözümlenemedi, tekrar dene.' }, 502)
  }

  const result = coerceResult(parsed)
  if (result.amount <= 0) {
    return jsonResponse({ error: 'Görselden bir tutar okunamadı.' }, 422)
  }

  return jsonResponse({ result, asOf: new Date().toISOString() })
})
