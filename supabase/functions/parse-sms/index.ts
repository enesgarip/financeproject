// Supabase Edge Function: parse-sms
// iOS Shortcuts'tan gelen DenizBank SMS'ini parse edip kart harcaması kaydeder.
//
// Deploy:  supabase functions deploy parse-sms
// Secrets: SMS_WEBHOOK_SECRET (iOS Shortcut'ta header olarak gönderilir)
// Invoke:  POST /functions/v1/parse-sms
//          Headers: x-webhook-secret: <secret>
//          Body: { "sms": "Degerli Musterimiz, ..." }

import { handlePreflight, jsonResponse, rateLimit } from '../_shared/edge.ts'

// --- SMS parsing -----------------------------------------------------------

// DenizBank harcama SMS formatı:
// "Degerli Musterimiz, 23.06.2026 15:18:21 tarihinde 9032 ile biten kartinizla,
//  FINDEKS FINANSAL YONETI firmasindan, 200 TL islem yapilmistir."
const DENIZBANK_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(\d{4})\s+ile\s+biten\s+kartinizla,\s+(.+?)\s+firmasindan,\s+([\d.,]+)\s+TL\s+islem/i

type ParsedSms = {
  spentAt: string
  lastFour: string
  merchant: string
  amount: number
}

function parseDenizbankSms(text: string): ParsedSms | null {
  const m = text.match(DENIZBANK_REGEX)
  if (!m) return null

  const [, datePart, timePart, lastFour, merchant, amountStr] = m
  const [d, mo, y] = datePart!.split('.')
  const isoDate = `${y}-${mo}-${d}T${timePart}`

  const amount = parseFloat(amountStr!.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    spentAt: isoDate,
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount: Math.round(amount * 100) / 100,
  }
}

// --- Category inference (mirrors src/utils/categories.ts) ------------------

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  { category: 'Market', keywords: ['market', 'migros', 'bim', 'a101', 'şok', 'sok', 'carrefour', 'carrefoursa', 'macrocenter', 'kasap', 'manav'] },
  { category: 'Yemek', keywords: ['yemek', 'restoran', 'restaurant', 'cafe', 'kahve', 'starbucks', 'yemeksepeti', 'getir yemek', 'burger', 'pizza', 'döner', 'doner', 'kebap'] },
  { category: 'Ulaşım', keywords: ['benzin', 'yakıt', 'yakit', 'petrol', 'shell', 'opet', 'bp', 'total', 'taksi', 'uber'] },
  { category: 'Fatura', keywords: ['fatura', 'elektrik', 'dogalgaz', 'internet', 'abonelik', 'turkcell', 'vodafone', 'superonline', 'findeks'] },
  { category: 'Sağlık', keywords: ['eczane', 'hastane', 'doktor', 'medikal'] },
  { category: 'Eğitim', keywords: ['okul', 'kurs', 'kitap', 'udemy'] },
  { category: 'Eğlence', keywords: ['sinema', 'konser', 'netflix', 'spotify', 'oyun'] },
  { category: 'Alışveriş', keywords: ['trendyol', 'hepsiburada', 'amazon', 'n11', 'zara', 'lcw', 'teknosa', 'media markt'] },
]

function normalizeForCategory(text: string): string {
  return text
    .replace(/[Iİ]/g, 'i')
    .toLowerCase()
    .replace(/[^a-zçğıöşü0-9\s]/g, ' ')
    .trim()
}

function inferCategory(merchant: string): string {
  const normalized = normalizeForCategory(merchant)
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) return rule.category
    }
  }
  return 'Diğer'
}

// --- Supabase helpers ------------------------------------------------------

function env(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.trim() ? value.trim() : null
}

function getServiceRoleKey(): string | null {
  const direct = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SERVICE_KEY')
  if (direct) return direct
  const secretKeys = env('SUPABASE_SECRET_KEYS')
  if (!secretKeys) return null
  try {
    const parsed = JSON.parse(secretKeys) as Record<string, unknown>
    for (const key of ['service_role', 'service_role_key', 'secret', 'default']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch { /* noop */ }
  return null
}

// --- Handler ---------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const limited = rateLimit(req, { bucket: 'parse-sms', max: 30, windowMs: 60_000 })
  if (limited) return limited

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // Webhook secret doğrulama
  const webhookSecret = env('SMS_WEBHOOK_SECRET')
  if (!webhookSecret) return jsonResponse({ error: 'SMS_WEBHOOK_SECRET tanımlı değil.' }, 500)

  const reqSecret = req.headers.get('x-webhook-secret')
  if (reqSecret !== webhookSecret) {
    return jsonResponse({ error: 'Yetkisiz.' }, 401)
  }

  // Supabase bağlantısı
  const supabaseUrl = env('SUPABASE_URL')
  const serviceRoleKey = getServiceRoleKey()
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase yapılandırması eksik.' }, 500)
  }

  // İstek gövdesini oku
  let body: { sms?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Geçersiz JSON.' }, 400)
  }

  const smsText = typeof body.sms === 'string' ? body.sms : ''
  if (!smsText) return jsonResponse({ error: 'SMS metni boş.' }, 400)

  // SMS'i parse et
  const parsed = parseDenizbankSms(smsText)
  if (!parsed) {
    return jsonResponse({ error: 'SMS formatı tanınamadı.', sms: smsText.slice(0, 100) }, 422)
  }

  // Supabase REST API ile kartı bul (card_aliases tablosu üzerinden)
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,
    'apikey': serviceRoleKey,
  }

  // card_aliases → cards join: son 4 hane ile ana kartı bul
  const aliasUrl = `${supabaseUrl}/rest/v1/card_aliases?last_four_digits=eq.${parsed.lastFour}&select=card_id,label,cards(id,card_name,bank_name,user_id)`
  const aliasRes = await fetch(aliasUrl, { headers })
  if (!aliasRes.ok) {
    return jsonResponse({ error: 'Kart sorgusu başarısız.' }, 502)
  }

  const aliases = await aliasRes.json() as Array<{
    card_id: string
    label: string | null
    cards: { id: string; card_name: string; bank_name: string; user_id: string }
  }>
  if (aliases.length === 0) {
    return jsonResponse({
      error: `Son 4 hanesi "${parsed.lastFour}" olan kart takma adı bulunamadı. card_aliases tablosuna kayıt ekleyin.`,
      parsed,
    }, 404)
  }

  const card = aliases[0]!.cards
  const category = inferCategory(parsed.merchant)

  // add_card_expense RPC çağrısı
  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/add_card_expense`
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_card_id: card.id,
      p_amount: parsed.amount,
      p_description: parsed.merchant,
      p_spent_at: parsed.spentAt,
      p_category: category,
      p_installment_count: 1,
      p_status: 'provision',
    }),
  })

  if (!rpcRes.ok) {
    const errBody = await rpcRes.text()
    return jsonResponse({ error: 'Harcama kaydedilemedi.', detail: errBody }, 502)
  }

  return jsonResponse({
    ok: true,
    card: card.card_name,
    merchant: parsed.merchant,
    amount: parsed.amount,
    category,
    spentAt: parsed.spentAt,
  })
})
