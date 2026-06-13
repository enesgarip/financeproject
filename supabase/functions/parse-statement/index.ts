// Supabase Edge Function: parse-statement
// Banka-bağımsız kredi kartı ekstre okuyucu (roadmap Y3). İstemci PDF'ten
// çıkardığı düz metni gönderir; bu fonksiyon Google Gemini Flash'ı server-side
// çağırıp ekstre üst bilgisi + işlem satırlarını yapısal JSON olarak döndürür.
// DenizBank için istemci hâlâ yerel hızlı parser'ı kullanır; bu fonksiyon
// DİĞER bankalar için fallback'tir. Kategori atama İSTEMCİDE yapılır
// (suggestExpenseCategory) — LLM'e kategori güvenilmez, tutarlılık için.
//
// Deploy:  supabase functions deploy parse-statement
// Secret:  GEMINI_API_KEY (parse-receipt ile aynı anahtar)
// Invoke:  supabase.functions.invoke('parse-statement', { body: { text } })
//
// Metin yalnız çözümleme için Google'a iletilir, ASLA saklanmaz.

import { fetchWithTimeout, handlePreflight, jsonResponse, rateLimit } from '../_shared/edge.ts'

const MODEL = 'gemini-2.5-flash'
const MAX_TEXT_BYTES = 200_000 // ~200 KB düz metin
const GEMINI_TIMEOUT_MS = 30_000

const PROMPT = `Sen bir Türkçe kredi kartı EKSTRE çözümleyicisin. Sana bir kredi kartı ekstresinin düz metni verilir.
SADECE şu JSON şemasında yanıt ver:
{"statementDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","totalDebt":number,"transactions":[{"date":"YYYY-MM-DD","description":string,"amount":number,"installmentNo":number,"installmentCount":number}]}
Kurallar:
- statementDate: ekstre/hesap kesim tarihi. dueDate: son ödeme tarihi. Okunamıyorsa "".
- totalDebt: dönem borcu / toplam ekstre tutarı (TL, sadece sayı).
- transactions: SADECE harcama/çekim satırları. Ödeme, iade, faiz tahsilatı, devreden bakiye satırlarını DAHİL ETME.
- amount: işlem tutarı (TL, ondalık nokta ile, pozitif). Metindeki tutarı AYNEN al, yuvarlama/uydurma yapma.
- date: işlem tarihi YYYY-MM-DD. Okunamıyorsa ekstre dönemine yakın bir tarih yerine "" bırak.
- description: işyeri/işlem açıklaması (kısa).
- Taksitli işlemde "3/12" gibi notasyon varsa installmentNo=3, installmentCount=12. Tek çekim/peşinse installmentNo=1, installmentCount=0.
- Hiç işlem yoksa transactions: [].
- KATEGORİ EKLEME; yalnız yukarıdaki alanları döndür.`

type RawTx = {
  date: string
  description: string
  amount: number
  installmentNo: number
  installmentCount: number
}
type RawStatement = {
  statementDate: string
  dueDate: string
  totalDebt: number
  transactions: RawTx[]
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function coerceStatement(raw: unknown): RawStatement {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const totalDebt = Number(obj.totalDebt)
  const txArray = Array.isArray(obj.transactions) ? obj.transactions : []

  const transactions: RawTx[] = []
  for (const item of txArray) {
    const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const amount = Number(t.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const count = Number.isFinite(Number(t.installmentCount)) ? Math.max(0, Math.trunc(Number(t.installmentCount))) : 0
    const no = Number.isFinite(Number(t.installmentNo)) ? Math.max(1, Math.trunc(Number(t.installmentNo))) : 1
    transactions.push({
      date: isIsoDate(t.date) ? t.date : '',
      description: typeof t.description === 'string' ? t.description.trim().slice(0, 160) : '',
      amount: Math.round(amount * 100) / 100,
      installmentNo: no,
      installmentCount: count,
    })
  }

  return {
    statementDate: isIsoDate(obj.statementDate) ? obj.statementDate : '',
    dueDate: isIsoDate(obj.dueDate) ? obj.dueDate : '',
    totalDebt: Number.isFinite(totalDebt) && totalDebt > 0 ? Math.round(totalDebt * 100) / 100 : 0,
    transactions,
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  // Gemini'yi çağıran pahalı uç — tek-IP'den kota istismarını kes.
  const limited = rateLimit(req, { bucket: 'parse-statement', max: 15, windowMs: 60_000 })
  if (limited) return limited
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY tanımlı değil.' }, 500)

  let body: { text?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Geçersiz istek gövdesi.' }, 400)
  }

  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) return jsonResponse({ error: 'Ekstre metni boş.' }, 400)
  if (text.length > MAX_TEXT_BYTES) return jsonResponse({ error: 'Ekstre metni çok büyük.' }, 413)

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`
  const payload = {
    contents: [{ parts: [{ text: `${PROMPT}\n\n--- EKSTRE METNİ ---\n${text}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  }

  let geminiText: string
  try {
    const res = await fetchWithTimeout(
      endpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      GEMINI_TIMEOUT_MS,
    )
    if (!res.ok) return jsonResponse({ error: `Gemini hatası (${res.status}).` }, 502)
    const json = await res.json()
    geminiText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  } catch {
    return jsonResponse({ error: 'Ekstre okunamadı, tekrar dene.' }, 502)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(geminiText)
  } catch {
    return jsonResponse({ error: 'Yanıt çözümlenemedi, tekrar dene.' }, 502)
  }

  const result = coerceStatement(parsed)
  if (!result.totalDebt && result.transactions.length === 0) {
    return jsonResponse({ error: 'Ekstreden işlem okunamadı.' }, 422)
  }

  return jsonResponse({ result, asOf: new Date().toISOString() })
})
