// Yalnız release job'unda; secret env→HTTPS body→Vault. SQL/response loglanmaz.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
export async function configurePushScheduler(env = process.env, request = fetch) {
  const { SUPABASE_PROJECT_REF: ref, SUPABASE_ACCESS_TOKEN: token, SUPABASE_ANON_KEY: apikey, PUSH_CRON_SECRET: secret } = env
  if (!ref || !/^[a-z0-9]+$/.test(ref) || !token || !apikey || !secret) throw new Error('Push zamanlayıcı ortam ayarları eksik.')
  const quote = value => "'" + value.replaceAll("'", "''") + "'"
  const query = `select public.configure_push_scheduler(${quote(`https://${ref}.supabase.co/functions/v1/push-notify`)},${quote(apikey)},${quote(secret)}) as configured;`
  let response
  try {
    response = await request(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000),
    })
  } catch { throw new Error('Push zamanlayıcı yapılandırma bağlantısı başarısız.') }
  if (!response.ok) throw new Error(`Push zamanlayıcı yapılandırması başarısız (HTTP ${response.status}).`)
  let result
  try { result = await response.json() }
  catch { throw new Error('Push zamanlayıcı yapılandırması geçersiz yanıt döndürdü.') }
  if (!Array.isArray(result) || result[0]?.configured !== true) throw new Error('Push zamanlayıcı yapılandırması doğrulanamadı.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  configurePushScheduler().then(() => console.log('Push zamanlayıcısı yapılandırıldı; 15 dakikada bir kontrol.')).catch(error => { console.error(error.message); process.exitCode = 1 })
}
