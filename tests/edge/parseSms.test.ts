import { readFileSync } from 'node:fs'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { buildSync } from 'esbuild'
import { expect, it, vi } from 'vitest'
import { parseSms, type ParsedSms } from '../../src/utils/smsParser'

// Gerçek edge entry'si çalışır; yalnız Deno host ve REST transport'u sahtedir.
const dir = path.resolve('supabase/functions/parse-sms')
const code = buildSync({ stdin: { contents: readFileSync(path.join(dir, 'index.ts'), 'utf8') + '\nexport { parseSms };', resolveDir: dir, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'browser' }).outputFiles[0].text
const env: Record<string, string> = { SMS_WEBHOOK_SECRET: 'local-test-secret', SUPABASE_URL: 'https://local-db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'local-test-key', SMS_OWNER_USER_ID: '7a171300-0000-4000-8000-000000000001' }
const sms = '52***047 hesabiniza, EN***** GA***** tarafindan 34.820,00 TL FAST odemesi gelmistir. Guncel Bakiye 34.905,37 TL 07/11/2026 15:31:54 B016'
const foreignSms = 'Degerli Musterimiz, 07.11.2026 19:37:28 tarihinde 9032 ile biten kartinizla, STEAMGAMES.COM 4259522 firmasindan, 59,99 USD islem yapilmistir. Tum finansal bilgilerinizi iceren bildirimlerinize ulasmak icin DenizKartim, MobilDeniz ve Internet Bankaciligi kanallarimizi kullanmanizi tavsiye ederiz. Kart yonetimi, kampanyalar ve daha fazlasi icin DenizKartim uygulamamiza goz atin: http://dnz.im/pySZk Bilgi:08502220800 MERSIS:0292008449600341 B002'

function harness(transport: typeof fetch) {
  let handler = (async () => new Response()) as (request: Request) => Promise<Response>
  const module = { exports: {} }
  new Function('Deno', 'fetch', 'crypto', 'module', 'exports', code)({ env: { get: (key: string) => env[key] }, serve: (handle: typeof handler) => { handler = handle } }, transport, webcrypto, module, module.exports)
  return { parse: (module.exports as { parseSms(text: string): ParsedSms | null }).parseSms, handle: (text: string) => handler(new Request('https://local.example.test/parse-sms', { method: 'POST', headers: { 'x-webhook-secret': env.SMS_WEBHOOK_SECRET, 'content-type': 'application/json' }, body: JSON.stringify({ sms: text }) })) }
}

it('gerçek USD SMS frontend ve canlı edge aynasında aynı döviz tutarını verir', () => {
  const { parse } = harness(vi.fn())
  for (const currency of ['USD', 'EUR', 'GBP', 'TL', 'TRY']) expect(parse(foreignSms.replace('USD', currency))).toEqual(parseSms(foreignSms.replace('USD', currency)))
  expect(parse(foreignSms)).toMatchObject({ currency: 'USD', amount: 59.99, merchant: 'STEAMGAMES.COM 4259522', lastFour: '9032', spentAt: '2026-11-07T19:37:28+03:00' })
})

it('USD webhook yalnız bekleme RPC’sine yazar; TL yazıcısına USD tutarı ulaşmaz ve retry kimliği korunur', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, body: JSON.parse(String(init?.body)) })
    return Response.json(path.endsWith('/resolve_sms_card_alias') ? [{ card_id: 'card', cards: { id: 'card', user_id: env.SMS_OWNER_USER_ID, card_name: 'Deniz', bank_name: 'DenizBank' } }] : 'pending')
  })
  const { handle } = harness(transport)
  expect(await (await handle(foreignSms)).json()).toMatchObject({ ok: true, type: 'foreign_card_pending', amount: 59.99, currency: 'USD' })
  await handle(foreignSms.replaceAll(' ', '\n'))
  const queued = calls.filter(call => call.path.endsWith('/queue_foreign_card_sms'))
  expect(queued).toHaveLength(2)
  expect(queued[0].body).toMatchObject({ p_native_amount: 59.99, p_currency: 'USD', p_card_id: 'card', p_user_id: env.SMS_OWNER_USER_ID })
  expect(queued[1].body.p_source_event_id).toBe(queued[0].body.p_source_event_id)
  expect(calls.some(call => call.path.endsWith('/record_sms_card_expense'))).toBe(false)
  expect(calls.filter(call => call.path.endsWith('/sms_log')).every(call => call.body.amount === null && call.body.status === 'success')).toBe(true)
})

it('bekleme RPC’si hata verirse USD SMS’i başarılı saymaz', async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async input => {
    if (String(input).endsWith('/resolve_sms_card_alias')) return Response.json([{ card_id: 'card', cards: { id: 'card', user_id: env.SMS_OWNER_USER_ID } }])
    return Response.json(null, { status: 500 })
  })
  expect((await harness(transport).handle(foreignSms)).status).toBe(502)
  expect(transport.mock.calls.some(([input]) => String(input).endsWith('/record_sms_card_expense'))).toBe(false)
})

it('YKB gerçek SMS, canlı edge ayrıştırıcısı ile frontend aynasında aynı sonucu üretir', () => {
  const { parse } = harness(vi.fn())
  for (const text of [sms, sms.replaceAll(' ', '\n'), sms.replace('FAST', 'HAVALE'), sms.replace('B016', 'B002')]) {
    expect(parse(text)).toEqual(parseSms(text))
  }
})

it('webhook maskeyi ve işlem tutarını koruyarak RPC çağırır; normalize tekrar aynı olay kimliğini taşır', async () => {
  const calls: Array<{ pathname: string; body: Record<string, unknown> }> = []
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const pathname = new URL(String(input)).pathname
    calls.push({ pathname, body: JSON.parse(String(init?.body)) })
    return Response.json(pathname.includes('/rpc/') ? { user_id: env.SMS_OWNER_USER_ID, card_name: 'Test YKB', current_balance: 34905.37, matched_debt: null } : null)
  })
  const { handle } = harness(transport)
  const response = await handle(sms)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true, type: 'account_movement', accountNumber: '52***047', amount: 34820, occurredAt: '2026-11-07T15:31:54+03:00' })
  expect((await handle(sms.replaceAll(' ', '\n'))).status).toBe(200)
  const writes = calls.filter(call => call.pathname.endsWith('/record_sms_account_movement'))
  expect(writes).toHaveLength(2)
  expect(writes[0].body).toMatchObject({ p_user_id: env.SMS_OWNER_USER_ID, p_account_number: '52***047', p_amount: 34820, p_direction: 'in', p_counterparty: 'EN***** GA*****', p_occurred_at: '2026-11-07T15:31:54+03:00', p_transaction_type: 'FAST' })
  expect(writes[0].body.p_source_event_id).toMatch(/^[a-f0-9]{64}$/)
  expect(writes[1].body.p_source_event_id).toBe(writes[0].body.p_source_event_id)
  expect(calls.filter(call => call.pathname.endsWith('/sms_log')).every(call => call.body.sms_type === 'account_movement' && call.body.status === 'success' && call.body.user_id === env.SMS_OWNER_USER_ID)).toBe(true)
})

it('belirsiz hesap RPC hatasını başarı saymaz ve sahibine bağlı hata kaydı oluşturur', async () => {
  const logs: Record<string, unknown>[] = []
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    if (String(input).endsWith('/record_sms_account_movement')) return Response.json({ message: 'Maskeli hesap numarasi birden fazla hesapla eslesti.' }, { status: 400 })
    logs.push(JSON.parse(String(init?.body)))
    return Response.json(null)
  })
  const response = await harness(transport).handle(sms)
  expect(response.status).toBe(502)
  expect(logs).toHaveLength(1)
  expect(logs[0]).toMatchObject({ user_id: env.SMS_OWNER_USER_ID, status: 'error', sms_type: 'account_movement', amount: 34820 })
})
