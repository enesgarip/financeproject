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

function harness(transport: typeof fetch) {
  let handler = (async () => new Response()) as (request: Request) => Promise<Response>
  const module = { exports: {} }
  new Function('Deno', 'fetch', 'crypto', 'module', 'exports', code)({ env: { get: (key: string) => env[key] }, serve: (handle: typeof handler) => { handler = handle } }, transport, webcrypto, module, module.exports)
  return { parse: (module.exports as { parseSms(text: string): ParsedSms | null }).parseSms, handle: (text: string) => handler(new Request('https://local.example.test/parse-sms', { method: 'POST', headers: { 'x-webhook-secret': env.SMS_WEBHOOK_SECRET, 'content-type': 'application/json' }, body: JSON.stringify({ sms: text }) })) }
}

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
