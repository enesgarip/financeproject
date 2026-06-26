// Supabase Edge Function: parse-sms
// iOS Shortcuts'tan gelen banka SMS'ini parse edip kart harcaması (provizyon)
// veya hesap hareketi (giriş/çıkış) kaydeder.
// Desteklenen bankalar: DenizBank (kart + hesap), Yapı Kredi (kart)
//
// Deploy:  supabase functions deploy parse-sms
// Secrets: SMS_WEBHOOK_SECRET (iOS Shortcut'ta header olarak gönderilir)
// Invoke:  POST /functions/v1/parse-sms
//          Headers: x-webhook-secret: <secret>
//          Body: { "sms": "Degerli Musterimiz, ..." }

import { handlePreflight, jsonResponse, rateLimit } from '../_shared/edge.ts'

// --- SMS parsing -----------------------------------------------------------

// -- Kart harcama SMS'leri --

// DenizBank harcama SMS formatı:
// "Degerli Musterimiz, 23.06.2026 15:18:21 tarihinde 9032 ile biten kartinizla,
//  FINDEKS FINANSAL YONETI firmasindan, 200 TL islem yapilmistir."
const DENIZBANK_CARD_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(\d{4})\s+ile\s+biten\s+kartinizla,\s+(.+?)\s+firmasindan,\s+([\d.,]+)\s+TL\s+islem/i

type ParsedCardSms = {
  type: 'card'
  spentAt: string
  lastFour: string
  merchant: string
  amount: number
}

function parseDenizbankCardSms(text: string): ParsedCardSms | null {
  const m = text.match(DENIZBANK_CARD_REGEX)
  if (!m) return null

  const [, datePart, timePart, lastFour, merchant, amountStr] = m
  const [d, mo, y] = datePart!.split('.')
  const isoDate = `${y}-${mo}-${d}T${timePart}`

  const amount = parseFloat(amountStr!.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    type: 'card',
    spentAt: isoDate,
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount: Math.round(amount * 100) / 100,
  }
}

// Yapı Kredi harcama SMS formatı:
// "Sayin ENES GARIP, 7735 ile biten Hepsiburada Worldcard kartinizla
//  23.03.2026 saat 10:30'de,HEPSIPAY *HEPSIBURADA is yerinden 31.834,00 TL
//  islem yapilmistir."
const YAPIKREDI_CARD_REGEX =
  /(\d{4})\s+ile\s+biten\s+.+?\s+kartinizla\s+(\d{2}\.\d{2}\.\d{4})\s+saat\s+(\d{2}:\d{2})'de,\s*(.+?)\s+is\s+yerinden\s+([\d.,]+)\s+TL\s+islem/i

function parseYapikrediCardSms(text: string): ParsedCardSms | null {
  const m = text.match(YAPIKREDI_CARD_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, merchant, amountStr] = m
  const [d, mo, y] = datePart!.split('.')
  const isoDate = `${y}-${mo}-${d}T${timePart}`

  const amount = parseFloat(amountStr!.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    type: 'card',
    spentAt: isoDate,
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount: Math.round(amount * 100) / 100,
  }
}

// -- Hesap hareketi SMS'leri --

// DenizBank hesap hareketi SMS formatı:
// Giden: "... 24.06.2026 21:40:15'da Ipek Bayram alicisina 4230-13300128-351
//         numarali hesabinizdan 600,00 TL tutarinda FAST islemi gerceklesmistir."
// Gelen: "... 24.06.2026 21:40:15'da Ipek Bayram gondericisinden 4230-13300128-351
//         numarali hesabiniza 600,00 TL tutarinda FAST islemi gerceklesmistir."
const DENIZBANK_ACCOUNT_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})'da\s+(.+?)\s+(?:alicisina|gondericisinden)\s+([\d-]+)\s+numarali\s+hesabiniz(dan|a)\s+([\d.,]+)\s+TL\s+tutarinda\s+(\w+)\s+islemi/i

type ParsedAccountSms = {
  type: 'account'
  occurredAt: string
  accountNumber: string
  counterparty: string
  amount: number
  direction: 'in' | 'out'
  transactionType: string
}

function parseDenizbankAccountSms(text: string): ParsedAccountSms | null {
  const m = text.match(DENIZBANK_ACCOUNT_REGEX)
  if (!m) return null

  const [, datePart, timePart, counterparty, accountNumber, dirSuffix, amountStr, txType] = m
  const [d, mo, y] = datePart!.split('.')
  const isoDate = `${y}-${mo}-${d}T${timePart}`

  const amount = parseFloat(amountStr!.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    type: 'account',
    occurredAt: isoDate,
    accountNumber: accountNumber!,
    counterparty: counterparty!.trim(),
    amount: Math.round(amount * 100) / 100,
    direction: dirSuffix === 'dan' ? 'out' : 'in',
    transactionType: txType!,
  }
}

type ParsedSms = ParsedCardSms | ParsedAccountSms

function parseSms(text: string): ParsedSms | null {
  return parseDenizbankCardSms(text) ?? parseYapikrediCardSms(text) ?? parseDenizbankAccountSms(text)
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
  { category: 'Alışveriş', keywords: ['trendyol', 'hepsiburada', 'hepsipay', 'amazon', 'n11', 'zara', 'lcw', 'teknosa', 'media markt'] },
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

// --- SMS log -----------------------------------------------------------

async function logSms(
  supabaseUrl: string,
  headers: Record<string, string>,
  entry: {
    userId?: string | null
    smsType: 'card_expense' | 'account_movement' | 'unrecognized'
    status: 'success' | 'error'
    summary?: string | null
    amount?: number | null
    errorMessage?: string | null
    rawSms: string
  },
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/rest/v1/sms_log`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: entry.userId ?? null,
        sms_type: entry.smsType,
        status: entry.status,
        summary: entry.summary ?? null,
        amount: entry.amount ?? null,
        error_message: entry.errorMessage ?? null,
        raw_sms: entry.rawSms,
      }),
    })
  } catch {
    // SMS log yazımı başarısızsa ana akışı bozma — sadece görünürlük kaybolur.
  }
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

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,
    'apikey': serviceRoleKey,
  }

  // SMS'i parse et (DenizBank kart/hesap + Yapı Kredi kart)
  const parsed = parseSms(smsText)
  if (!parsed) {
    await logSms(supabaseUrl, headers, {
      smsType: 'unrecognized',
      status: 'error',
      errorMessage: 'SMS formatı tanınamadı.',
      rawSms: smsText,
    })
    return jsonResponse({ error: 'SMS formatı tanınamadı.', sms: smsText.slice(0, 100) }, 422)
  }

  if (parsed.type === 'card') {
    return handleCardSms(parsed, smsText, supabaseUrl, headers)
  } else {
    return handleAccountSms(parsed, smsText, supabaseUrl, headers)
  }
})

// --- Card SMS handler ------------------------------------------------------

async function handleCardSms(
  parsed: ParsedCardSms,
  rawSms: string,
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  const aliasUrl = `${supabaseUrl}/rest/v1/card_aliases?last_four_digits=eq.${parsed.lastFour}&select=card_id,label,cards(id,card_name,bank_name,user_id)`
  const aliasRes = await fetch(aliasUrl, { headers })
  if (!aliasRes.ok) {
    await logSms(supabaseUrl, headers, {
      smsType: 'card_expense',
      status: 'error',
      errorMessage: 'Kart sorgusu başarısız.',
      amount: parsed.amount,
      summary: parsed.merchant,
      rawSms,
    })
    return jsonResponse({ error: 'Kart sorgusu başarısız.' }, 502)
  }

  const aliases = await aliasRes.json() as Array<{
    card_id: string
    label: string | null
    cards: { id: string; card_name: string; bank_name: string; user_id: string }
  }>
  if (aliases.length === 0) {
    await logSms(supabaseUrl, headers, {
      smsType: 'card_expense',
      status: 'error',
      errorMessage: `Son 4 hanesi "${parsed.lastFour}" olan kart takma adı bulunamadı.`,
      amount: parsed.amount,
      summary: parsed.merchant,
      rawSms,
    })
    return jsonResponse({
      error: `Son 4 hanesi "${parsed.lastFour}" olan kart takma adı bulunamadı. card_aliases tablosuna kayıt ekleyin.`,
      parsed,
    }, 404)
  }

  const card = aliases[0]!.cards
  const category = inferCategory(parsed.merchant)

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
      p_user_id: card.user_id,
    }),
  })

  if (!rpcRes.ok) {
    const errBody = await rpcRes.text()
    await logSms(supabaseUrl, headers, {
      userId: card.user_id,
      smsType: 'card_expense',
      status: 'error',
      errorMessage: `Harcama kaydedilemedi: ${errBody}`,
      amount: parsed.amount,
      summary: `${card.card_name} · ${parsed.merchant}`,
      rawSms,
    })
    return jsonResponse({ error: 'Harcama kaydedilemedi.', detail: errBody }, 502)
  }

  await logSms(supabaseUrl, headers, {
    userId: card.user_id,
    smsType: 'card_expense',
    status: 'success',
    amount: parsed.amount,
    summary: `${card.card_name} · ${parsed.merchant}`,
    rawSms,
  })

  return jsonResponse({
    ok: true,
    type: 'card_expense',
    card: card.card_name,
    merchant: parsed.merchant,
    amount: parsed.amount,
    category,
    spentAt: parsed.spentAt,
  })
}

// --- Account SMS handler ---------------------------------------------------

async function handleAccountSms(
  parsed: ParsedAccountSms,
  rawSms: string,
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/record_sms_account_movement`
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_account_number: parsed.accountNumber,
      p_amount: parsed.amount,
      p_direction: parsed.direction,
      p_counterparty: parsed.counterparty,
      p_occurred_at: parsed.occurredAt,
      p_transaction_type: parsed.transactionType,
    }),
  })

  if (!rpcRes.ok) {
    const errBody = await rpcRes.text()
    await logSms(supabaseUrl, headers, {
      smsType: 'account_movement',
      status: 'error',
      errorMessage: `Hesap hareketi kaydedilemedi: ${errBody}`,
      amount: parsed.amount,
      summary: parsed.counterparty,
      rawSms,
    })
    return jsonResponse({ error: 'Hesap hareketi kaydedilemedi.', detail: errBody }, 502)
  }

  const card = await rpcRes.json() as { user_id?: string; card_name?: string }
  await logSms(supabaseUrl, headers, {
    userId: card.user_id,
    smsType: 'account_movement',
    status: 'success',
    amount: parsed.amount,
    summary: `${card.card_name ?? ''} · ${parsed.counterparty}`,
    rawSms,
  })

  return jsonResponse({
    ok: true,
    type: 'account_movement',
    accountNumber: parsed.accountNumber,
    counterparty: parsed.counterparty,
    amount: parsed.amount,
    direction: parsed.direction,
    transactionType: parsed.transactionType,
    occurredAt: parsed.occurredAt,
  })
}
