// Supabase Edge Function: push-notify
// Sends scheduled Web Push notifications for upcoming payments, loan
// installments, card statement cuts, and the Monday weekly summary.
//
// Deploy:  supabase functions deploy push-notify
// Secrets: VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_SERVICE_ROLE_KEY
// Invoke:  POST /functions/v1/push-notify with Authorization: Bearer <service-role>
//
// Deliberately avoids npm modules: Web Push payload encryption and VAPID signing
// use WebCrypto plus small local helpers for P-256 public-key derivation.

import { fetchWithTimeout, handlePreflight, jsonResponse } from '../_shared/edge.ts'

const TIME_ZONE = 'Europe/Istanbul'
const PUSH_TTL_SECONDS = 60 * 60 * 24
const PUSH_TIMEOUT_MS = 12_000
const DB_TIMEOUT_MS = 12_000
const AES_128_GCM_RECORD_SIZE = 4096

const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const P256_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n
const P256_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n

const textEncoder = new TextEncoder()
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
})
const moneyFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type PaymentRow = {
  id: string
  user_id: string
  title: string
  amount: number | string
  due_date: string
}

type LoanInstallmentRow = {
  id: string
  user_id: string
  loan_id: string
  installment_no: number
  due_date: string
  amount: number | string
}

type LoanRow = {
  id: string
  bank_name: string
  loan_name: string
}

type CardRow = {
  id: string
  user_id: string
  bank_name: string
  card_name: string
  statement_day: number | null
  current_period_spending: number | string
}

type StatementArchiveRow = {
  card_id: string
  period_year: number
  period_month: number
}

type NotificationLogRow = {
  user_id: string
  notification_type: string
  reference_id: string
}

type PushPayload = {
  title: string
  body: string
  url: string
  tag: string
}

type NotificationCandidate = {
  userId: string
  notificationType: string
  referenceId: string
  payload: PushPayload
}

type RestClient = {
  select<T>(table: string, params: Record<string, string | string[]>): Promise<T[]>
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>
  deleteById(table: string, id: string): Promise<void>
}

type P256Point = { x: bigint; y: bigint } | null

type VapidKeys = {
  publicKey: string
  privateKey: CryptoKey
}

let cachedVapidKeys: Promise<VapidKeys> | null = null

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
  } catch {
    // Legacy projects expose SUPABASE_SERVICE_ROLE_KEY directly; malformed JSON
    // here simply means that fallback is unavailable.
  }

  return null
}

function isAuthorized(req: Request, serviceRoleKey: string): boolean {
  const authHeader = req.headers.get('authorization') ?? ''
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return bearer === serviceRoleKey || req.headers.get('apikey') === serviceRoleKey
}

function createRestClient(supabaseUrl: string, serviceRoleKey: string): RestClient {
  const baseUrl = supabaseUrl.replace(/\/+$/, '')
  const baseHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  }

  return {
    async select<T>(table: string, params: Record<string, string | string[]>): Promise<T[]> {
      const url = new URL(`${baseUrl}/rest/v1/${table}`)
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, item)
        } else {
          url.searchParams.set(key, value)
        }
      }

      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            ...baseHeaders,
            Accept: 'application/json',
          },
        },
        DB_TIMEOUT_MS,
      )

      if (!res.ok) throw new Error(`${table} select failed (${res.status}): ${await res.text()}`)
      return (await res.json()) as T[]
    },

    async insert(table, rows) {
      if (rows.length === 0) return

      const res = await fetchWithTimeout(
        `${baseUrl}/rest/v1/${table}`,
        {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(rows),
        },
        DB_TIMEOUT_MS,
      )

      if (!res.ok && res.status !== 409) {
        throw new Error(`${table} insert failed (${res.status}): ${await res.text()}`)
      }
    },

    async deleteById(table, id) {
      const url = new URL(`${baseUrl}/rest/v1/${table}`)
      url.searchParams.set('id', `eq.${id}`)

      const res = await fetchWithTimeout(
        url,
        {
          method: 'DELETE',
          headers: {
            ...baseHeaders,
            Prefer: 'return=minimal',
          },
        },
        DB_TIMEOUT_MS,
      )

      if (!res.ok) throw new Error(`${table} delete failed (${res.status}): ${await res.text()}`)
    },
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const raw = atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

function mod(value: bigint, divisor = P256_P): bigint {
  const result = value % divisor
  return result >= 0n ? result : result + divisor
}

function modInverse(value: bigint, divisor = P256_P): bigint {
  let low = mod(value, divisor)
  let high = divisor
  let lm = 1n
  let hm = 0n

  while (low > 1n) {
    const ratio = high / low
    const next = high - low * ratio
    const nextM = hm - lm * ratio
    high = low
    hm = lm
    low = next
    lm = nextM
  }

  return mod(lm, divisor)
}

function pointDouble(point: P256Point): P256Point {
  if (!point) return null
  if (point.y === 0n) return null

  const slope = mod((3n * point.x * point.x - 3n) * modInverse(2n * point.y))
  const x = mod(slope * slope - 2n * point.x)
  const y = mod(slope * (point.x - x) - point.y)
  return { x, y }
}

function pointAdd(left: P256Point, right: P256Point): P256Point {
  if (!left) return right
  if (!right) return left

  if (left.x === right.x) {
    if (mod(left.y + right.y) === 0n) return null
    return pointDouble(left)
  }

  const slope = mod((right.y - left.y) * modInverse(right.x - left.x))
  const x = mod(slope * slope - left.x - right.x)
  const y = mod(slope * (left.x - x) - left.y)
  return { x, y }
}

function scalarMultiply(scalar: bigint): P256Point {
  let n = scalar
  let result: P256Point = null
  let addend: P256Point = { x: P256_GX, y: P256_GY }

  while (n > 0n) {
    if ((n & 1n) === 1n) result = pointAdd(result, addend)
    addend = pointDouble(addend)
    n >>= 1n
  }

  return result
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`)
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function derivePublicKey(privateKeyBytes: Uint8Array): Uint8Array {
  if (privateKeyBytes.length !== 32) throw new Error('VAPID_PRIVATE_KEY 32 byte olmalı.')

  const scalar = bytesToBigInt(privateKeyBytes)
  if (scalar <= 0n || scalar >= P256_N) throw new Error('VAPID_PRIVATE_KEY geçerli P-256 aralığında değil.')

  const point = scalarMultiply(scalar)
  if (!point) throw new Error('VAPID public key türetilemedi.')

  return concatBytes(new Uint8Array([0x04]), bigIntTo32Bytes(point.x), bigIntTo32Bytes(point.y))
}

async function getVapidKeys(privateKeyValue: string): Promise<VapidKeys> {
  if (!cachedVapidKeys) {
    cachedVapidKeys = (async () => {
      const privateKeyBytes = base64UrlToBytes(privateKeyValue)
      const publicKeyBytes = derivePublicKey(privateKeyBytes)
      const jwk = {
        kty: 'EC',
        crv: 'P-256',
        d: bytesToBase64Url(privateKeyBytes),
        x: bytesToBase64Url(publicKeyBytes.slice(1, 33)),
        y: bytesToBase64Url(publicKeyBytes.slice(33, 65)),
      }
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      )

      return {
        publicKey: bytesToBase64Url(publicKeyBytes),
        privateKey,
      }
    })()
  }

  return cachedVapidKeys
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, toArrayBuffer(data)))
}

async function hkdfSha256(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm)
  const output = new Uint8Array(length)
  let previous: Uint8Array = new Uint8Array()
  let offset = 0
  let counter = 1

  while (offset < length) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])))
    output.set(previous.slice(0, Math.min(previous.length, length - offset)), offset)
    offset += previous.length
    counter += 1
  }

  return output
}

async function encryptWebPushPayload(payload: PushPayload, subscription: PushSubscriptionRow): Promise<Uint8Array> {
  const userPublicKeyBytes = base64UrlToBytes(subscription.p256dh)
  const authSecret = base64UrlToBytes(subscription.auth)

  if (userPublicKeyBytes.length !== 65 || userPublicKeyBytes[0] !== 0x04) {
    throw new Error('Geçersiz p256dh anahtarı.')
  }
  if (authSecret.length < 16) throw new Error('Geçersiz auth secret.')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const serverKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const serverPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey))
  const userPublicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(userPublicKeyBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: userPublicKey }, serverKeys.privateKey, 256),
  )

  const keyInfo = concatBytes(
    textEncoder.encode('WebPush: info\0'),
    userPublicKeyBytes,
    serverPublicKeyBytes,
  )
  const ikm = await hkdfSha256(authSecret, sharedSecret, keyInfo, 32)
  const cek = await hkdfSha256(salt, ikm, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfSha256(salt, ikm, textEncoder.encode('Content-Encoding: nonce\0'), 12)
  const plaintext = concatBytes(textEncoder.encode(JSON.stringify(payload)), new Uint8Array([0x02]))

  if (plaintext.length > AES_128_GCM_RECORD_SIZE - 16) {
    throw new Error('Push payload tek aes128gcm record sınırını aşıyor.')
  }

  const aesKey = await crypto.subtle.importKey('raw', toArrayBuffer(cek), 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce), tagLength: 128 },
      aesKey,
      toArrayBuffer(plaintext),
    ),
  )

  const header = new Uint8Array(21 + serverPublicKeyBytes.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, AES_128_GCM_RECORD_SIZE, false)
  header[20] = serverPublicKeyBytes.length
  header.set(serverPublicKeyBytes, 21)

  return concatBytes(header, ciphertext)
}

async function createVapidJwt(
  endpoint: string,
  vapidKeys: VapidKeys,
  subject: string,
): Promise<string> {
  const endpointUrl = new URL(endpoint)
  const aud = endpointUrl.origin
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60
  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToBase64Url(textEncoder.encode(JSON.stringify({ aud, exp, sub: subject })))
  const signingInput = `${header}.${claims}`
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapidKeys.privateKey,
      textEncoder.encode(signingInput),
    ),
  )

  return `${signingInput}.${bytesToBase64Url(signature)}`
}

async function sendWebPush(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
  vapidKeys: VapidKeys,
  vapidSubject: string,
): Promise<Response> {
  const encryptedPayload = await encryptWebPushPayload(payload, subscription)
  const jwt = await createVapidJwt(subscription.endpoint, vapidKeys, vapidSubject)

  return await fetchWithTimeout(
    subscription.endpoint,
    {
      method: 'POST',
      headers: {
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
      },
      body: toArrayBuffer(encryptedPayload),
    },
    PUSH_TIMEOUT_MS,
  )
}

function inFilter(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(',')})`
}

function dateOnlyInTimeZone(now = new Date()): string {
  return dateFormatter.format(now)
}

function weekdayInTimeZone(now = new Date()): string {
  return weekdayFormatter.format(now)
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function isoFromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso)
  return isoFromUtcDate(new Date(Date.UTC(year, month - 1, day + days)))
}

function daysBetweenIso(from: string, to: string): number {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  const fromMs = Date.UTC(a.year, a.month - 1, a.day)
  const toMs = Date.UTC(b.year, b.month - 1, b.day)
  return Math.round((toMs - fromMs) / 86_400_000)
}

function startOfWeekIso(iso: string): string {
  const { year, month, day } = parseIsoDate(iso)
  const date = new Date(Date.UTC(year, month - 1, day))
  const dayOfWeek = date.getUTCDay()
  const mondayOffset = (dayOfWeek + 6) % 7
  return addDaysIso(iso, -mondayOffset)
}

function dateInMonthIso(year: number, monthIndex: number, preferredDay: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return isoFromUtcDate(new Date(Date.UTC(year, monthIndex, Math.min(preferredDay, lastDay))))
}

function periodKey(cardId: string, year: number, month: number): string {
  return `${cardId}:${year}:${month}`
}

function nextUncutStatementDate(card: CardRow, todayIso: string, archivedPeriods: Set<string>): string | null {
  if (!card.statement_day) return null

  const { year, month } = parseIsoDate(todayIso)
  const monthIndex = month - 1
  const currentPeriod = periodKey(card.id, year, month)
  if (archivedPeriods.has(currentPeriod)) return dateInMonthIso(year, monthIndex + 1, card.statement_day)
  return dateInMonthIso(year, monthIndex, card.statement_day)
}

function numberValue(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toKurus(value: number | string): number {
  const amount = numberValue(value)
  const sign = amount < 0 ? -1 : 1
  return sign * Math.round(Math.abs(amount) * 100 + 1e-6)
}

function formatTL(value: number | string): string {
  return moneyFormatter.format(toKurus(value) / 100)
}

async function loadCandidates(
  db: RestClient,
  subscriptions: PushSubscriptionRow[],
  todayIso: string,
  weekday: string,
): Promise<NotificationCandidate[]> {
  const userIds = Array.from(new Set(subscriptions.map((row) => row.user_id)))
  if (userIds.length === 0) return []

  const tomorrowIso = addDaysIso(todayIso, 1)
  const weekStartIso = startOfWeekIso(todayIso)
  const weekEndIso = addDaysIso(weekStartIso, 6)
  const userFilter = inFilter(userIds)

  const [
    paymentsTomorrow,
    paymentsThisWeek,
    loanInstallmentsTomorrow,
    loanInstallmentsThisWeek,
    cards,
  ] = await Promise.all([
    db.select<PaymentRow>('payments', {
      select: 'id,user_id,title,amount,due_date',
      user_id: userFilter,
      status: 'eq.bekliyor',
      due_date: `eq.${tomorrowIso}`,
    }),
    db.select<PaymentRow>('payments', {
      select: 'id,user_id,title,amount,due_date',
      user_id: userFilter,
      status: 'eq.bekliyor',
      due_date: [`gte.${weekStartIso}`, `lte.${weekEndIso}`],
    }),
    db.select<LoanInstallmentRow>('loan_installments', {
      select: 'id,user_id,loan_id,installment_no,due_date,amount',
      user_id: userFilter,
      status: 'eq.bekliyor',
      due_date: `eq.${tomorrowIso}`,
    }),
    db.select<LoanInstallmentRow>('loan_installments', {
      select: 'id,user_id,loan_id,installment_no,due_date,amount',
      user_id: userFilter,
      status: 'eq.bekliyor',
      due_date: [`gte.${weekStartIso}`, `lte.${weekEndIso}`],
    }),
    db.select<CardRow>('cards', {
      select: 'id,user_id,bank_name,card_name,statement_day,current_period_spending',
      user_id: userFilter,
      card_type: 'eq.kredi_karti',
      statement_day: 'not.is.null',
      current_period_spending: 'gt.0',
    }),
  ])

  const loanIds = Array.from(
    new Set([...loanInstallmentsTomorrow, ...loanInstallmentsThisWeek].map((row) => row.loan_id)),
  )
  const loans = loanIds.length
    ? await db.select<LoanRow>('loans', {
      select: 'id,bank_name,loan_name',
      id: inFilter(loanIds),
    })
    : []
  const loansById = new Map(loans.map((loan) => [loan.id, loan]))

  const statementArchives = cards.length
    ? await db.select<StatementArchiveRow>('card_statement_archives', {
      select: 'card_id,period_year,period_month',
      user_id: userFilter,
    })
    : []
  const archivedPeriods = new Set(
    statementArchives.map((row) => periodKey(row.card_id, row.period_year, row.period_month)),
  )

  const candidates: NotificationCandidate[] = []

  for (const payment of paymentsTomorrow) {
    candidates.push({
      userId: payment.user_id,
      notificationType: 'payment_due_tomorrow',
      referenceId: `${payment.id}:${payment.due_date}`,
      payload: {
        title: `Yarın: ${payment.title} ödemesi (${formatTL(payment.amount)} ₺)`,
        body: 'Planlı ödeme vadesi yaklaşıyor.',
        url: '/odemeler',
        tag: `payment-due-${payment.id}-${payment.due_date}`,
      },
    })
  }

  for (const installment of loanInstallmentsTomorrow) {
    const loan = loansById.get(installment.loan_id)
    const bank = loan?.bank_name ?? loan?.loan_name ?? 'Banka'
    candidates.push({
      userId: installment.user_id,
      notificationType: 'loan_installment_due_tomorrow',
      referenceId: `${installment.id}:${installment.due_date}`,
      payload: {
        title: `Yarın: ${bank} kredi taksiti (${formatTL(installment.amount)} ₺)`,
        body: `${installment.installment_no}. taksit vadesi yaklaşıyor.`,
        url: '/borclar/krediler',
        tag: `loan-installment-due-${installment.id}-${installment.due_date}`,
      },
    })
  }

  for (const card of cards) {
    const statementDate = nextUncutStatementDate(card, todayIso, archivedPeriods)
    if (!statementDate || daysBetweenIso(todayIso, statementDate) !== 3) continue

    const cardLabel = `${card.bank_name} ${card.card_name}`.trim()
    candidates.push({
      userId: card.user_id,
      notificationType: 'card_statement_cut_3d',
      referenceId: `${card.id}:${statementDate}`,
      payload: {
        title: `${cardLabel} ekstre kesimi 3 gün sonra`,
        body: `Dönem içi harcama: ${formatTL(card.current_period_spending)} ₺`,
        url: '/kartlar',
        tag: `card-statement-cut-${card.id}-${statementDate}`,
      },
    })
  }

  if (weekday === 'Mon') {
    const weeklyByUser = new Map<string, { count: number; totalKurus: number }>()

    for (const payment of paymentsThisWeek) {
      const summary = weeklyByUser.get(payment.user_id) ?? { count: 0, totalKurus: 0 }
      summary.count += 1
      summary.totalKurus += toKurus(payment.amount)
      weeklyByUser.set(payment.user_id, summary)
    }

    for (const installment of loanInstallmentsThisWeek) {
      const summary = weeklyByUser.get(installment.user_id) ?? { count: 0, totalKurus: 0 }
      summary.count += 1
      summary.totalKurus += toKurus(installment.amount)
      weeklyByUser.set(installment.user_id, summary)
    }

    for (const [userId, summary] of weeklyByUser) {
      if (summary.count <= 0 || summary.totalKurus <= 0) continue

      candidates.push({
        userId,
        notificationType: 'weekly_summary',
        referenceId: `week:${weekStartIso}`,
        payload: {
          title: `Bu hafta: ${summary.count} ödeme, toplam ${formatTL(summary.totalKurus / 100)} ₺`,
          body: 'Haftalık ödeme planı hazır.',
          url: '/',
          tag: `weekly-summary-${weekStartIso}`,
        },
      })
    }
  }

  return candidates
}

function logKey(candidate: Pick<NotificationCandidate, 'userId' | 'notificationType' | 'referenceId'>): string {
  return `${candidate.userId}:${candidate.notificationType}:${candidate.referenceId}`
}

async function filterAlreadySent(db: RestClient, candidates: NotificationCandidate[]): Promise<NotificationCandidate[]> {
  if (candidates.length === 0) return []

  const userIds = Array.from(new Set(candidates.map((candidate) => candidate.userId)))
  const notificationTypes = Array.from(new Set(candidates.map((candidate) => candidate.notificationType)))
  const wantedKeys = new Set(candidates.map(logKey))

  const logs = await db.select<NotificationLogRow>('notification_log', {
    select: 'user_id,notification_type,reference_id',
    user_id: inFilter(userIds),
    notification_type: inFilter(notificationTypes),
  })
  const sentKeys = new Set(
    logs
      .map((log) => logKey({
        userId: log.user_id,
        notificationType: log.notification_type,
        referenceId: log.reference_id,
      }))
      .filter((key) => wantedKeys.has(key)),
  )

  return candidates.filter((candidate) => !sentKeys.has(logKey(candidate)))
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = env('SUPABASE_URL')
  const serviceRoleKey = getServiceRoleKey()
  const vapidPrivateKey = env('VAPID_PRIVATE_KEY')
  const vapidSubject = env('VAPID_SUBJECT')

  if (!supabaseUrl || !serviceRoleKey || !vapidPrivateKey || !vapidSubject) {
    return jsonResponse(
      {
        error:
          'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY ve VAPID_SUBJECT tanımlı olmalı.',
      },
      500,
    )
  }

  if (!isAuthorized(req, serviceRoleKey)) return jsonResponse({ error: 'Unauthorized' }, 401)

  const db = createRestClient(supabaseUrl, serviceRoleKey)
  const vapidKeys = await getVapidKeys(vapidPrivateKey)
  const todayIso = dateOnlyInTimeZone()
  const weekday = weekdayInTimeZone()

  try {
    const subscriptions = await db.select<PushSubscriptionRow>('push_subscriptions', {
      select: 'id,user_id,endpoint,p256dh,auth',
    })

    if (subscriptions.length === 0) {
      return jsonResponse({
        ok: true,
        today: todayIso,
        candidates: 0,
        sent: 0,
        staleDeleted: 0,
        failed: 0,
      })
    }

    const subscriptionsByUser = new Map<string, PushSubscriptionRow[]>()
    for (const subscription of subscriptions) {
      subscriptionsByUser.set(subscription.user_id, [
        ...(subscriptionsByUser.get(subscription.user_id) ?? []),
        subscription,
      ])
    }

    const candidates = await filterAlreadySent(
      db,
      await loadCandidates(db, subscriptions, todayIso, weekday),
    )
    const sentLogs: Record<string, unknown>[] = []
    let delivered = 0
    let staleDeleted = 0
    let failed = 0

    for (const candidate of candidates) {
      const userSubscriptions = subscriptionsByUser.get(candidate.userId) ?? []
      let candidateDelivered = 0

      for (const subscription of userSubscriptions) {
        try {
          const res = await sendWebPush(subscription, candidate.payload, vapidKeys, vapidSubject)
          if (res.status === 404 || res.status === 410) {
            await db.deleteById('push_subscriptions', subscription.id)
            staleDeleted += 1
            continue
          }

          if (res.ok) {
            delivered += 1
            candidateDelivered += 1
            continue
          }

          failed += 1
          console.error(`Push failed ${res.status} for ${subscription.endpoint}: ${await res.text()}`)
        } catch (error) {
          failed += 1
          console.error('Push send failed', error)
        }
      }

      if (candidateDelivered > 0) {
        sentLogs.push({
          user_id: candidate.userId,
          notification_type: candidate.notificationType,
          reference_id: candidate.referenceId,
        })
      }
    }

    await db.insert('notification_log', sentLogs)

    return jsonResponse({
      ok: true,
      today: todayIso,
      weekday,
      candidates: candidates.length,
      sent: sentLogs.length,
      deviceDeliveries: delivered,
      staleDeleted,
      failed,
    })
  } catch (error) {
    console.error('push-notify failed', error)
    return jsonResponse({ error: 'Push bildirimleri gönderilemedi.' }, 500)
  }
})
