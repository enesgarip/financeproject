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
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
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

type CardExpenseRow = {
  user_id: string
  amount: number | string
  category: string
  spent_at: string
}

// Taksit onayi bekleyen provizyon: SMS her zaman tek cekim dogurur, kullanici
// panelden taksit sayisini isaretlemezse 7. gunde oldugu gibi kesinlesir.
type PendingProvisionRow = {
  id: string
  user_id: string
  card_id: string
  description: string
  amount: number | string
  spent_at: string
}

type StatementArchiveRow = {
  card_id: string
  period_year: number
  period_month: number
}

type ReconcilableCardRow = {
  id: string
  user_id: string
}

type ReconciliationRow = {
  card_id: string
  user_id: string
  reconciled_at: string
}

// src/utils/reconciliation.ts STALE_AFTER_DAYS ile aynı tutulmalı.
const RECONCILE_STALE_AFTER_DAYS = 7

type NotificationLogRow = {
  user_id: string
  notification_type: string
  reference_id: string
}

type CarReminderRow = {
  id: string
  user_id: string
  car_id: string
  title: string
  due_date: string
}

type CarProfileRow = { id: string; name: string }

/** Hedefe bağlı kasa kovası; aylık ayırma yapılıp yapılmadığı buradan okunur. */
type GoalBucketRow = {
  id: string
  user_id: string
  name: string
  goal_id: string
  last_contribution_month: string | null
}

type GoalProfileRow = { id: string; name: string; status: string; value_type: string }

type SalaryRow = { user_id: string; amount: number; effective_date: string }

type DepositRow = { user_id: string; amount_kurus: number; occurred_at: string }

/**
 * Ayırma hatırlatmasının penceresi: ayın 2-5'i.
 *
 * 1'inde değil, çünkü maaş çoğu ay ilk iş gününde yatar ve para girmeden
 * "ayır" demek erken. Tek gün de değil, çünkü o günün cron koşusu düşerse
 * hatırlatma tamamen kaybolurdu; dedupe zaten aynı ay ikinci kez göndermez.
 */
const GOAL_REMINDER_DAY_FROM = 2
const GOAL_REMINDER_DAY_TO = 5
/**
 * Maaş yatışı TESPİT edildiyse pencere 12'ye uzar: maaş geç yatan ayda (6'sı
 * ve sonrası) takvim penceresi kaçmış olsa da hatırlatma gerçek yatışa bağlanır.
 * Dedupe (goal:ay) değişmez — ay başına yine tek gönderim.
 */
const GOAL_REMINDER_SALARY_DAY_TO = 12
/** utils/salaryDeposit.ts ikizi (±%10 bandı; testli mantık orada). */
const SALARY_MATCH_TOLERANCE = 0.1

// Kullanıcı bazlı tür tercihleri + sessiz saatler.
type NotificationPreferenceRow = {
  user_id: string
  payments_enabled: boolean
  loans_enabled: boolean
  statements_enabled: boolean
  weekly_enabled: boolean
  cars_enabled: boolean
  provisions_enabled: boolean
  goals_enabled: boolean
  quiet_hours_start: number | null
  quiet_hours_end: number | null
}

type PreferenceFlagKey =
  | 'payments_enabled'
  | 'loans_enabled'
  | 'statements_enabled'
  | 'weekly_enabled'
  | 'cars_enabled'
  | 'provisions_enabled'
  | 'goals_enabled'

// src/utils/notificationPreferences.ts ikizleri (Deno import edemez; testli mantık orada).
function notificationTypeToPrefKey(notificationType: string): PreferenceFlagKey | null {
  switch (notificationType) {
    case 'payment_due_tomorrow':
      return 'payments_enabled'
    case 'loan_installment_due_tomorrow':
      return 'loans_enabled'
    case 'card_statement_cut_3d':
      return 'statements_enabled'
    case 'weekly_summary':
    case 'reconciliation_stale_weekly':
      return 'weekly_enabled'
    case 'car_reminder_due_7d':
      return 'cars_enabled'
    case 'provision_installment_pending':
      return 'provisions_enabled'
    case 'goal_contribution_due':
      return 'goals_enabled'
    default:
      return null
  }
}

function isWithinQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

// Provizyon hatirlatma esikleri. Kucuk market harcamasi taksitli olmaz; asil
// risk buyuk ve unutulmus provizyonda. PROVISION_AUTO_POST_DAYS,
// run_scheduled_card_maintenance'in p_provision_stale_days varsayilanidir —
// ikisi birlikte degismelidir.
const PROVISION_REMINDER_MIN_AMOUNT = 1000
const PROVISION_REMINDER_AFTER_DAYS = 2
const PROVISION_AUTO_POST_DAYS = 7

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

type PushNotifyRequest = {
  mode?: 'test'
  endpoint?: string | null
}

type DeliverySummary = {
  sent: number
  deviceDeliveries: number
  staleDeleted: number
  failed: number
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
  const bearer = bearerToken(req)
  return bearer === serviceRoleKey || req.headers.get('apikey') === serviceRoleKey
}

function bearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') ?? ''
  return authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null
}

async function readRequestBody(req: Request): Promise<PushNotifyRequest> {
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const body = parsed as Record<string, unknown>
    return {
      mode: body.mode === 'test' ? 'test' : undefined,
      endpoint: typeof body.endpoint === 'string' && body.endpoint.trim() ? body.endpoint.trim() : null,
    }
  } catch {
    return {}
  }
}

async function authenticatedUserId(
  supabaseUrl: string,
  serviceRoleKey: string,
  req: Request,
): Promise<string | null> {
  const bearer = bearerToken(req)
  if (!bearer || bearer === serviceRoleKey) return null

  const res = await fetchWithTimeout(
    `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${bearer}`,
      },
    },
    DB_TIMEOUT_MS,
  )

  if (!res.ok) return null
  const user = await res.json() as { id?: unknown }
  return typeof user.id === 'string' && user.id ? user.id : null
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

function currentHourInTimeZone(now = new Date()): number {
  const hour = Number(hourFormatter.format(now))
  return Number.isFinite(hour) ? hour % 24 : 0
}

// Gönderim öncesi kapı: kapalı türü ve sessiz saat penceresindeki kullanıcıyı ele.
// Tercih satırı yoksa varsayılan hepsi açık (opt-out modeli).
function applyPreferences(
  candidates: NotificationCandidate[],
  preferencesByUser: Map<string, NotificationPreferenceRow>,
  currentHour: number,
): NotificationCandidate[] {
  return candidates.filter((candidate) => {
    const prefs = preferencesByUser.get(candidate.userId)
    if (!prefs) return true
    if (isWithinQuietHours(currentHour, prefs.quiet_hours_start, prefs.quiet_hours_end)) return false
    const key = notificationTypeToPrefKey(candidate.notificationType)
    if (!key) return true
    return prefs[key] !== false
  })
}

async function loadPreferences(db: RestClient, userIds: string[]): Promise<Map<string, NotificationPreferenceRow>> {
  if (userIds.length === 0) return new Map()
  const rows = await db.select<NotificationPreferenceRow>('notification_preferences', {
    select: 'user_id,payments_enabled,loans_enabled,statements_enabled,weekly_enabled,cars_enabled,provisions_enabled,goals_enabled,quiet_hours_start,quiet_hours_end',
    user_id: inFilter(userIds),
  })
  return new Map(rows.map((row) => [row.user_id, row]))
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
    carRemindersDue7d,
    pendingProvisions,
    goalBuckets,
    salaryRows,
    monthDeposits,
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
    db.select<CarReminderRow>('car_reminders', {
      select: 'id,user_id,car_id,title,due_date',
      user_id: userFilter,
      due_date: `eq.${addDaysIso(todayIso, 7)}`,
    }),
    db.select<PendingProvisionRow>('card_expenses', {
      select: 'id,user_id,card_id,description,amount,spent_at',
      user_id: userFilter,
      status: 'eq.provision',
      installment_count: 'eq.1',
      amount: `gte.${PROVISION_REMINDER_MIN_AMOUNT}`,
      spent_at: `lte.${addDaysIso(todayIso, -PROVISION_REMINDER_AFTER_DAYS)}`,
    }),
    // Hedefe bağlı kovalar; "bu ay ayrıldı mı" filtresi kodda (satır sayısı
    // kullanıcı başına birkaç tane, PostgREST or-filtresi kurmaya değmez).
    db.select<GoalBucketRow>('kasa_buckets', {
      select: 'id,user_id,name,goal_id,last_contribution_month',
      user_id: userFilter,
      goal_id: 'not.is.null',
    }),
    // Maaş tespiti için ham veri: maaş TUTARI türetilmiş değil, saklı bilgi —
    // sunucunun okuması "push'ta türetilmiş tutar hesaplanmaz" kuralını bozmaz.
    db.select<SalaryRow>('salary_history', {
      select: 'user_id,amount,effective_date',
      user_id: userFilter,
      effective_date: `lte.${todayIso}`,
      order: 'effective_date.desc',
    }),
    db.select<DepositRow>('account_ledger', {
      select: 'user_id,amount_kurus,occurred_at',
      user_id: userFilter,
      kind: 'eq.deposit',
      occurred_at: `gte.${todayIso.slice(0, 7)}-01`,
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

  const carIds = Array.from(new Set(carRemindersDue7d.map((row) => row.car_id)))
  const carProfiles = carIds.length ? await db.select<CarProfileRow>('cars', {
    select: 'id,name', id: inFilter(carIds),
  }) : []
  const carsById = new Map(carProfiles.map((car) => [car.id, car]))

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

  // Aylık ayırma hatırlatması: kovaya bu ay ayırma yapılmamış aktif hedefler.
  //
  // Bildirimde TUTAR YOK ve bu bilinçli: kaynağa bağlı hedefin `current_amount`
  // kolonu DB'de 0'dır (biriken tutar client'ta canlı fiyat/kurla türetilir —
  // bkz. utils/goalSources.ts), dolayısıyla sunucuda hesaplanacak "kalan" ya da
  // "aylık gerekli" YANLIŞ olurdu. Doğru sayı ekranda; bildirim yalnız oraya
  // çağırır.
  const reminderDay = parseIsoDate(todayIso).day
  // Maaş yatışı tespiti (utils/salaryDeposit.ts ikizi): kullanıcının güncel
  // maaşına ±%10 bandında bu ay bir 'deposit' düştü mü? Sıralama
  // effective_date.desc geldiği için kullanıcı başına İLK satır günceldir.
  const salaryByUser = new Map<string, number>()
  for (const row of salaryRows) {
    if (!salaryByUser.has(row.user_id) && row.amount > 0) salaryByUser.set(row.user_id, row.amount)
  }
  const salaryLandedUsers = new Set<string>()
  for (const deposit of monthDeposits) {
    const salary = salaryByUser.get(deposit.user_id)
    if (!salary) continue
    if (Math.abs(deposit.amount_kurus / 100 - salary) <= salary * SALARY_MATCH_TOLERANCE) {
      salaryLandedUsers.add(deposit.user_id)
    }
  }

  const inBaseWindow = reminderDay >= GOAL_REMINDER_DAY_FROM && reminderDay <= GOAL_REMINDER_DAY_TO
  const inSalaryWindow = reminderDay >= GOAL_REMINDER_DAY_FROM && reminderDay <= GOAL_REMINDER_SALARY_DAY_TO
  if (inBaseWindow || (inSalaryWindow && salaryLandedUsers.size > 0)) {
    const monthKey = todayIso.slice(0, 7)
    const pendingBuckets = goalBuckets.filter(
      (bucket) =>
        (bucket.last_contribution_month ?? '').slice(0, 7) !== monthKey &&
        (inBaseWindow || salaryLandedUsers.has(bucket.user_id)),
    )

    if (pendingBuckets.length > 0) {
      const goalIds = Array.from(new Set(pendingBuckets.map((bucket) => bucket.goal_id)))
      const goals = await db.select<GoalProfileRow>('savings_goals', {
        select: 'id,name,status,value_type',
        id: inFilter(goalIds),
        status: 'eq.active',
      })
      const goalsById = new Map(goals.map((goal) => [goal.id, goal]))

      for (const bucket of pendingBuckets) {
        const goal = goalsById.get(bucket.goal_id)
        // Tamamlanmış/silinmiş hedefin kovası dürtmez.
        if (!goal) continue

        // Yatış görüldüyse metin "doğru an"ı söyler; tutar yine YOK (üstteki
        // gerekçe geçerli — plan/kalan client'ta türetilir).
        const salaryLanded = salaryLandedUsers.has(bucket.user_id)
        candidates.push({
          userId: bucket.user_id,
          notificationType: 'goal_contribution_due',
          referenceId: `${goal.id}:${monthKey}`,
          payload: {
            title: salaryLanded ? `${goal.name}: maaş yattı görünüyor` : `${goal.name}: bu ay ayırma yapmadın`,
            body: salaryLanded
              ? `Maaş hesaba geçti; "${bucket.name}" kovasına bu ayın payını tek tıkla ayırabilirsin.`
              : `"${bucket.name}" kovasına bu ayın payını tek tıkla ayırabilirsin.`,
            url: '/odemeler/hedefler',
            tag: `goal-contribution-${goal.id}-${monthKey}`,
          },
        })
      }
    }
  }

  for (const reminder of carRemindersDue7d) {
    const carName = carsById.get(reminder.car_id)?.name ?? 'Aracın'
    candidates.push({
      userId: reminder.user_id,
      notificationType: 'car_reminder_due_7d',
      referenceId: `${reminder.id}:${reminder.due_date}`,
      payload: {
        title: `${carName}: ${reminder.title} 7 gün sonra`,
        body: `Planlanan tarih: ${reminder.due_date.split('-').reverse().join('.')}`,
        url: '/varliklar/araclar',
        tag: `car-reminder-${reminder.id}-${reminder.due_date}`,
      },
    })
  }

  // Taksit onayi bekleyen provizyonlar: otomatik kesinlesmeden once tek sefer
  // hatirlat. Dedupe kalici oldugu icin ayni provizyon her gun tekrar durtmez.
  if (pendingProvisions.length > 0) {
    const provisionCardIds = Array.from(new Set(pendingProvisions.map((row) => row.card_id)))
    const provisionCards = await db.select<CardRow>('cards', {
      select: 'id,user_id,bank_name,card_name,statement_day,current_period_spending',
      id: inFilter(provisionCardIds),
      card_type: 'eq.kredi_karti',
    })
    const provisionCardsById = new Map(provisionCards.map((card) => [card.id, card]))

    for (const provision of pendingProvisions) {
      const card = provisionCardsById.get(provision.card_id)
      if (!card) continue // kredi karti disi (banka karti) provizyonu taksitlenmez

      const waitedDays = daysBetweenIso(provision.spent_at.slice(0, 10), todayIso)
      const daysLeft = Math.max(0, PROVISION_AUTO_POST_DAYS - waitedDays)
      candidates.push({
        userId: provision.user_id,
        notificationType: 'provision_installment_pending',
        referenceId: provision.id,
        payload: {
          title: `${formatTL(provision.amount)} ₺ provizyon: taksitli miydi?`,
          body: daysLeft > 0
            ? `${provision.description} · ${`${card.bank_name} ${card.card_name}`.trim()} · ${daysLeft} gün sonra tek çekim olarak kesinleşir.`
            : `${provision.description} · ${`${card.bank_name} ${card.card_name}`.trim()} · tek çekim olarak kesinleşmek üzere.`,
          url: '/kartlar?section=ekstreler',
          tag: `provision-installment-${provision.id}`,
        },
      })
    }
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
    const prevWeekStartIso = addDaysIso(weekStartIso, -7)
    const prevWeekEndIso = addDaysIso(prevWeekStartIso, 6)

    const [lastWeekExpenses, prevWeekExpenses] = await Promise.all([
      db.select<CardExpenseRow>('card_expenses', {
        select: 'user_id,amount,category,spent_at',
        user_id: userFilter,
        status: 'eq.posted',
        spent_at: [`gte.${weekStartIso}`, `lte.${weekEndIso}`],
      }),
      db.select<CardExpenseRow>('card_expenses', {
        select: 'user_id,amount,category,spent_at',
        user_id: userFilter,
        status: 'eq.posted',
        spent_at: [`gte.${prevWeekStartIso}`, `lte.${prevWeekEndIso}`],
      }),
    ])

    type WeeklySpending = { totalKurus: number; categories: Map<string, number> }
    const spendingByUser = new Map<string, WeeklySpending>()
    const prevSpendingByUser = new Map<string, number>()

    for (const expense of lastWeekExpenses) {
      const entry = spendingByUser.get(expense.user_id) ?? { totalKurus: 0, categories: new Map() }
      const amountKurus = toKurus(expense.amount)
      entry.totalKurus += amountKurus
      const cat = expense.category || 'Diğer'
      entry.categories.set(cat, (entry.categories.get(cat) ?? 0) + amountKurus)
      spendingByUser.set(expense.user_id, entry)
    }

    for (const expense of prevWeekExpenses) {
      prevSpendingByUser.set(expense.user_id, (prevSpendingByUser.get(expense.user_id) ?? 0) + toKurus(expense.amount))
    }

    type WeeklySummary = { paymentCount: number; paymentTotalKurus: number }
    const weeklyByUser = new Map<string, WeeklySummary>()

    for (const payment of paymentsThisWeek) {
      const summary = weeklyByUser.get(payment.user_id) ?? { paymentCount: 0, paymentTotalKurus: 0 }
      summary.paymentCount += 1
      summary.paymentTotalKurus += toKurus(payment.amount)
      weeklyByUser.set(payment.user_id, summary)
    }

    for (const installment of loanInstallmentsThisWeek) {
      const summary = weeklyByUser.get(installment.user_id) ?? { paymentCount: 0, paymentTotalKurus: 0 }
      summary.paymentCount += 1
      summary.paymentTotalKurus += toKurus(installment.amount)
      weeklyByUser.set(installment.user_id, summary)
    }

    const allUserIds = new Set([...weeklyByUser.keys(), ...spendingByUser.keys()])

    for (const userId of allUserIds) {
      const payments = weeklyByUser.get(userId)
      const spending = spendingByUser.get(userId)
      const prevTotal = prevSpendingByUser.get(userId) ?? 0

      if (!payments && !spending) continue

      const parts: string[] = []

      if (spending && spending.totalKurus > 0) {
        parts.push(`${formatTL(spending.totalKurus / 100)} ₺ harcadın`)
        if (prevTotal > 0) {
          const changePct = Math.round(((spending.totalKurus - prevTotal) / prevTotal) * 100)
          if (changePct > 0) parts.push(`geçen haftadan %${changePct} fazla`)
          else if (changePct < 0) parts.push(`geçen haftadan %${Math.abs(changePct)} az`)
        }
      }

      let topCategory = ''
      if (spending && spending.categories.size > 0) {
        let maxKurus = 0
        for (const [cat, kurus] of spending.categories) {
          if (kurus > maxKurus) { maxKurus = kurus; topCategory = cat }
        }
      }

      const title = spending && spending.totalKurus > 0
        ? `Bu hafta ${parts.join(', ')}`
        : `Bu hafta: ${payments?.paymentCount ?? 0} ödeme, toplam ${formatTL((payments?.paymentTotalKurus ?? 0) / 100)} ₺`

      const bodyParts: string[] = []
      if (topCategory) bodyParts.push(`En büyük kalem: ${topCategory}`)
      if (payments && payments.paymentCount > 0) bodyParts.push(`${payments.paymentCount} yaklaşan ödeme`)

      candidates.push({
        userId,
        notificationType: 'weekly_summary',
        referenceId: `week:${weekStartIso}`,
        payload: {
          title,
          body: bodyParts.length > 0 ? bodyParts.join('. ') + '.' : 'Haftalık özet hazır.',
          url: '/',
          tag: `weekly-summary-${weekStartIso}`,
        },
      })
    }

    // Haftalık mutabakat hatırlatması. Uygulama manuel olduğu için app ile banka
    // arasında sürekli küçük fark birikir; haftalık kontrol farkı büyümeden
    // yakalar. referenceId hafta başı → haftada en fazla bir bildirim.
    const [reconcilableCards, reconciliations] = await Promise.all([
      db.select<ReconcilableCardRow>('cards', {
        select: 'id,user_id',
        user_id: userFilter,
      }),
      db.select<ReconciliationRow>('account_reconciliations', {
        select: 'card_id,user_id,reconciled_at',
        user_id: userFilter,
      }),
    ])

    const latestReconciledAt = new Map<string, string>()
    for (const row of reconciliations) {
      const current = latestReconciledAt.get(row.card_id)
      if (!current || row.reconciled_at > current) latestReconciledAt.set(row.card_id, row.reconciled_at)
    }

    const staleCountByUser = new Map<string, number>()
    for (const card of reconcilableCards) {
      const last = latestReconciledAt.get(card.id)
      const isStale = !last || daysBetweenIso(last.slice(0, 10), todayIso) > RECONCILE_STALE_AFTER_DAYS
      if (!isStale) continue
      staleCountByUser.set(card.user_id, (staleCountByUser.get(card.user_id) ?? 0) + 1)
    }

    for (const [userId, staleCount] of staleCountByUser) {
      candidates.push({
        userId,
        notificationType: 'reconciliation_stale_weekly',
        referenceId: `week:${weekStartIso}`,
        payload: {
          title: `${staleCount} hesapta mutabakat zamanı`,
          body: 'Bankadaki gerçek rakamla karşılaştır; fark varsa tek tıkla düzelt.',
          url: '/veri-sagligi',
          tag: `reconciliation-stale-${weekStartIso}`,
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

function groupSubscriptionsByUser(subscriptions: PushSubscriptionRow[]): Map<string, PushSubscriptionRow[]> {
  const subscriptionsByUser = new Map<string, PushSubscriptionRow[]>()
  for (const subscription of subscriptions) {
    subscriptionsByUser.set(subscription.user_id, [
      ...(subscriptionsByUser.get(subscription.user_id) ?? []),
      subscription,
    ])
  }
  return subscriptionsByUser
}

async function deliverCandidates(
  db: RestClient,
  subscriptionsByUser: Map<string, PushSubscriptionRow[]>,
  candidates: NotificationCandidate[],
  vapidKeys: VapidKeys,
  vapidSubject: string,
  shouldWriteLog: boolean,
): Promise<DeliverySummary> {
  const sentLogs: Record<string, unknown>[] = []
  let sent = 0
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
      sent += 1
      if (shouldWriteLog) {
        sentLogs.push({
          user_id: candidate.userId,
          notification_type: candidate.notificationType,
          reference_id: candidate.referenceId,
        })
      }
    }
  }

  await db.insert('notification_log', sentLogs)

  return {
    sent,
    deviceDeliveries: delivered,
    staleDeleted,
    failed,
  }
}

function buildTestCandidate(userId: string): NotificationCandidate {
  const referenceId = `manual:${new Date().toISOString()}`
  return {
    userId,
    notificationType: 'test',
    referenceId,
    payload: {
      title: 'Denge test bildirimi',
      body: 'Bu cihaz Web Push bildirimlerini alıyor.',
      url: '/veri-sagligi/islemler',
      tag: `push-test-${referenceId}`,
    },
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const body = await readRequestBody(req)

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

  const testUserId = body.mode === 'test'
    ? await authenticatedUserId(supabaseUrl, serviceRoleKey, req)
    : null
  if (body.mode === 'test') {
    if (!testUserId) return jsonResponse({ error: 'Unauthorized' }, 401)
  } else if (!isAuthorized(req, serviceRoleKey)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const db = createRestClient(supabaseUrl, serviceRoleKey)
  const vapidKeys = await getVapidKeys(vapidPrivateKey)
  const todayIso = dateOnlyInTimeZone()
  const weekday = weekdayInTimeZone()

  try {
    if (body.mode === 'test') {
      const subscriptionFilters: Record<string, string> = {
        select: 'id,user_id,endpoint,p256dh,auth',
        user_id: `eq.${testUserId}`,
      }
      if (body.endpoint) subscriptionFilters.endpoint = `eq.${body.endpoint}`

      const subscriptions = await db.select<PushSubscriptionRow>('push_subscriptions', subscriptionFilters)

      if (subscriptions.length === 0) {
        return jsonResponse({
          ok: false,
          mode: 'test',
          reason: 'no_subscription',
          sent: 0,
          deviceDeliveries: 0,
          staleDeleted: 0,
          failed: 0,
        })
      }

      const result = await deliverCandidates(
        db,
        groupSubscriptionsByUser(subscriptions),
        [buildTestCandidate(testUserId!)],
        vapidKeys,
        vapidSubject,
        false,
      )

      return jsonResponse({
        ok: result.sent > 0,
        mode: 'test',
        reason: result.sent > 0 ? undefined : 'delivery_failed',
        ...result,
      })
    }

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

    const preferencesByUser = await loadPreferences(
      db,
      Array.from(new Set(subscriptions.map((row) => row.user_id))),
    )
    const allowedCandidates = applyPreferences(
      await loadCandidates(db, subscriptions, todayIso, weekday),
      preferencesByUser,
      currentHourInTimeZone(),
    )
    const candidates = await filterAlreadySent(db, allowedCandidates)
    const result = await deliverCandidates(
      db,
      groupSubscriptionsByUser(subscriptions),
      candidates,
      vapidKeys,
      vapidSubject,
      true,
    )
    const failedEveryDelivery = candidates.length > 0 && result.sent === 0 && result.failed > 0

    return jsonResponse({
      ok: !failedEveryDelivery,
      today: todayIso,
      weekday,
      candidates: candidates.length,
      ...result,
    }, failedEveryDelivery ? 502 : 200)
  } catch (error) {
    console.error('push-notify failed', error)
    return jsonResponse({ error: 'Push bildirimleri gönderilemedi.' }, 500)
  }
})
