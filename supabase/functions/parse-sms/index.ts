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
// Parsing mantığı src/utils/smsParser.ts ile senkronize tutulmalı (testler orada).

// -- Helpers --

/** SMS metinlerindeki satır sonlarını ve çoklu boşlukları tek boşluğa indirger. */
function normalizeSmsWhitespace(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// src/utils/money.ts roundTL'nin Edge-runtime yerel ikizi.
function roundTL(value: number): number {
  if (!Number.isFinite(value)) return 0
  const sign = value < 0 ? -1 : 1
  return sign * Math.round(Math.abs(value) * 100 + 1e-6) / 100 || 0
}

function parseAmount(raw: string): number | null {
  const compact = raw.replace(/\s/g, '')
  const decimalIndex = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'))
  const decimalDigits = decimalIndex >= 0 ? compact.length - decimalIndex - 1 : 0
  const normalized = decimalIndex >= 0 && decimalDigits >= 1 && decimalDigits <= 2
    ? `${compact.slice(0, decimalIndex).replace(/[.,]/g, '')}.${compact.slice(decimalIndex + 1)}`
    : compact.replace(/[.,]/g, '')
  const amount = parseFloat(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return roundTL(amount)
}

function toIsoDate(datePart: string, timePart: string): string {
  const [d, mo, y] = datePart.split('.')
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${timePart}+03:00`
}

// -- Kart harcama SMS'leri --

const DENIZBANK_CARD_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(\d{4})\s+ile\s+biten\s+kartinizla,\s+(.+?)\s+firmasindan,\s+([\d.,]+)\s+TL\s+islem/i

const DENIZBANK_MASKED_CARD_REGEX =
  /\d{6}\*+(\d{4})\s+kartinizla\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde\s+(.+?)\s+isyerinden\s+yapilan\s+([\d.,]+)\s+TRY\s+tutarindaki\s+islem/i

const DENIZBANK_CARD_TRANSACTION_REGEX =
  /(\d{4})\s+ile\s+biten\s+kartinizla,?\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+tarihinde,?\s*([\d.,]+)\s+TL\s+tutarinda,?\s*(.+?)\s+kurumuna\s+ait\s+otomatik\s+odeme\s+talimatiniz\s+gerceklestirilmistir/i

type ParsedCardSms = {
  type: 'card'
  spentAt: string
  lastFour: string
  merchant: string
  amount: number
}

function parseDenizbankCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_CARD_REGEX)
  if (!m) return null

  const [, datePart, timePart, lastFour, merchant, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

function parseDenizbankMaskedCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_MASKED_CARD_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, merchant, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

function parseDenizbankCardTransactionSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_CARD_TRANSACTION_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, amountStr, merchant] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

const YAPIKREDI_CARD_REGEX =
  /(\d{4})\s+ile\s+biten\s+.+?\s+kartinizla\s+(\d{2}\.\d{2}\.\d{4})\s+saat\s+(\d{2}:\d{2})'de,\s*(.+?)\s+is\s+yerinden\s+([\d.,]+)\s+TL\s+islem/i

function parseYapikrediCardSms(text: string): ParsedCardSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(YAPIKREDI_CARD_REGEX)
  if (!m) return null

  const [, lastFour, datePart, timePart, merchant, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'card',
    spentAt: toIsoDate(datePart!, timePart!),
    lastFour: lastFour!,
    merchant: merchant!.trim(),
    amount,
  }
}

// -- Hesap hareketi SMS'leri --

const DENIZBANK_ACCOUNT_REGEX =
  /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})'da\s+(.+?)\s+(?:alicisina|gondericisinden)\s+([\d-]+)\s+numarali\s+hesabiniz(dan|a)\s+([\d.,]+)\s+TL\s+tutarinda\s+(\w+)\s+islemi/i

const DENIZBANK_INCOMING_ACCOUNT_REGEX =
  /(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)'da\s+(.+?)\s+gondericisinden\s+([\d-]+)\s+numarali\s+hesabiniza\s+(FAST|HAVALE|EFT)\s+ile\s+([\d.,]+)\s+(?:TL|TRY)\s+tutarinda\s+para\s+girisi\s+gerceklesmistir/i

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
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_ACCOUNT_REGEX)
  if (!m) return null

  const [, datePart, timePart, counterparty, accountNumber, dirSuffix, amountStr, txType] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'account',
    occurredAt: toIsoDate(datePart!, timePart!),
    accountNumber: accountNumber!,
    counterparty: counterparty!.trim(),
    amount,
    direction: dirSuffix === 'dan' ? 'out' : 'in',
    transactionType: txType!,
  }
}

function parseDenizbankIncomingAccountSms(text: string): ParsedAccountSms | null {
  const normalized = normalizeSmsWhitespace(text)
  const m = normalized.match(DENIZBANK_INCOMING_ACCOUNT_REGEX)
  if (!m) return null

  const [, datePart, timePart, counterparty, accountNumber, txType, amountStr] = m
  const amount = parseAmount(amountStr!)
  if (amount === null) return null

  return {
    type: 'account',
    occurredAt: toIsoDate(datePart!, timePart!),
    accountNumber: accountNumber!,
    counterparty: counterparty!.trim(),
    amount,
    direction: 'in',
    transactionType: txType!,
  }
}

type ParsedSms = ParsedCardSms | ParsedAccountSms

function parseSms(text: string): ParsedSms | null {
  return (
    parseDenizbankCardSms(text) ??
    parseDenizbankMaskedCardSms(text) ??
    parseDenizbankCardTransactionSms(text) ??
    parseYapikrediCardSms(text) ??
    parseDenizbankAccountSms(text) ??
    parseDenizbankIncomingAccountSms(text)
  )
}

function accountSmsNeedsExternalEventId(parsed: ParsedSms): boolean {
  return parsed.type === 'account' && /T\d{2}:\d{2}\+03:00$/.test(parsed.occurredAt)
}

// --- Category inference (mirrors src/utils/categories.ts) ------------------

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  { category: 'Market', keywords: ['market', 'migros', 'bim', 'a101', 'şok', 'sok', 'carrefour', 'carrefoursa', 'macrocenter', 'kasap', 'manav'] },
  { category: 'Yeme & İçme', keywords: ['yemek', 'restoran', 'restaurant', 'lokanta', 'bistro', 'cafe', 'kafe', 'coffee', 'kahve', 'kahvaltı', 'kahvalti', 'starbucks', 'sbux', 'sbx', 'gloria jeans', 'espressolab', 'yemeksepeti', 'getir yemek', 'trendyol yemek', 'burger', 'pizza', 'döner', 'doner', 'kebap', 'kebab', 'köfte', 'kofte', 'köfteci', 'kofteci', 'pastane', 'fırın', 'firin', 'tatlı', 'tatli', 'dondurma', 'waffle', 'salata', 'pide', 'lahmacun'] },
  { category: 'Ulaşım', keywords: ['benzin', 'yakıt', 'yakit', 'petrol', 'shell', 'opet', 'bp', 'total', 'taksi', 'uber'] },
  // 'abonelik' Fatura'dan çıkarıldı → yeni Abonelik kuralına taşındı (kural sırası
  // önce geldiği için Fatura'da kalsaydı Abonelik hiç eşleşemezdi). Bu blok
  // src/utils/categories.ts categoryRules'un substring-güvenli aynasıdır.
  { category: 'Fatura', keywords: ['fatura', 'elektrik', 'dogalgaz', 'internet', 'turkcell', 'vodafone', 'superonline', 'findeks'] },
  { category: 'Sağlık', keywords: ['eczane', 'hastane', 'doktor', 'medikal'] },
  { category: 'Eğitim', keywords: ['okul', 'kurs', 'kitap', 'udemy'] },
  { category: 'Eğlence', keywords: ['sinema', 'konser', 'netflix', 'spotify', 'oyun'] },
  { category: 'Alışveriş', keywords: ['trendyol', 'hepsiburada', 'hepsipay', 'amazon', 'n11', 'zara', 'lcw', 'teknosa', 'media markt'] },
  { category: 'Konut', keywords: ['kira', 'aidat', 'emlak', 'ipotek'] },
  { category: 'Abonelik', keywords: ['abonelik', 'icloud', 'blutv', 'exxen'] },
  { category: 'İş', keywords: ['reklam', 'google ads', 'meta ads', 'hosting', 'komisyon'] },
  { category: 'Kişisel Bakım', keywords: ['kuafor', 'berber', 'kozmetik', 'gratis', 'watsons', 'rossmann'] },
  { category: 'Hediye', keywords: ['hediye', 'bagis', 'kizilay'] },
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
  let body: { sms?: unknown; eventId?: unknown }
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

  const callerEventId = typeof body.eventId === 'string' && body.eventId.trim()
    ? body.eventId.trim()
    : req.headers.get('x-source-event-id')?.trim()

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

  if (accountSmsNeedsExternalEventId(parsed) && !callerEventId) {
    const errorMessage = 'Saniyesiz hesap SMS’i için kararlı eventId zorunludur.'
    await logSms(supabaseUrl, headers, {
      smsType: 'account_movement',
      status: 'error',
      errorMessage,
      amount: parsed.amount,
      summary: parsed.counterparty,
      rawSms: smsText,
    })
    return jsonResponse({ error: errorMessage }, 409)
  }

  // Saniyeli banka SMS'lerinde normalize ham-metin hash'i legacy retry
  // fallback'ıdır. Saniyesiz hesap hareketleri yukarıda dış event ID ister.
  const sourceEventId = callerEventId || await sha256Hex(normalizeSmsWhitespace(smsText))

  if (parsed.type === 'card') {
    return handleCardSms(parsed, smsText, sourceEventId, supabaseUrl, headers)
  } else {
    return handleAccountSms(parsed, smsText, sourceEventId, supabaseUrl, headers)
  }
})

// --- Card SMS handler ------------------------------------------------------

async function handleCardSms(
  parsed: ParsedCardSms,
  rawSms: string,
  sourceEventId: string,
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
  // K18 (denetim 2026-08-12): tenant sınırı. Webhook'un kullanıcı bağlamı yok;
  // SMS_OWNER_USER_ID tanımlıysa eşleşmeler o kullanıcıya daraltılır. Tanımlı
  // değilse bile aynı son-4 hane BİRDEN ÇOK kullanıcıda eşleşiyorsa keyfî ilk
  // kaydı seçmek yerine açıkça reddedilir (yanlış kullanıcının kartına yazma).
  const ownerUserId = env('SMS_OWNER_USER_ID')?.trim() || null
  const scopedAliases = ownerUserId
    ? aliases.filter((alias) => alias.cards.user_id === ownerUserId)
    : aliases

  if (scopedAliases.length === 0) {
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

  const distinctUserIds = new Set(scopedAliases.map((alias) => alias.cards.user_id))
  if (distinctUserIds.size > 1) {
    const errorMessage = `Son 4 hanesi "${parsed.lastFour}" birden çok kullanıcının kartıyla eşleşiyor; SMS_OWNER_USER_ID tanımlayın.`
    await logSms(supabaseUrl, headers, {
      smsType: 'card_expense',
      status: 'error',
      errorMessage,
      amount: parsed.amount,
      summary: parsed.merchant,
      rawSms,
    })
    return jsonResponse({ error: errorMessage }, 409)
  }

  const card = scopedAliases[0]!.cards
  const category = inferCategory(parsed.merchant)

  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/record_sms_card_expense`
  const rpcRes = await fetch(rpcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_card_id: card.id,
      p_amount: parsed.amount,
      p_description: parsed.merchant,
      p_spent_at: parsed.spentAt,
      p_category: category,
      p_user_id: card.user_id,
      p_source_event_id: sourceEventId,
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
  sourceEventId: string,
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  // K18: SMS_OWNER_USER_ID tanımlıysa RPC'ye geçilir — RPC service_role
  // çağrısında p_user_id'yi tenant filtresi olarak kullanır; tanımsızken tüm
  // kullanıcılarda hesap arıyordu (tekil eşleşme başka kullanıcıya yazabilirdi).
  const ownerUserId = env('SMS_OWNER_USER_ID')?.trim() || null
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
      p_source_event_id: sourceEventId,
      ...(ownerUserId ? { p_user_id: ownerUserId } : {}),
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
