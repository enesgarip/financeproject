// `npm run verify` kuyruğu: deno kuruluysa edge fonksiyonlarını tip-denetler,
// kurulu değilse YÜKSEK SESLE uyarır ama engellemez — edge'e dokunmayan işte
// verify kilitlenmesin. Asıl zorlayıcı kapı CI'da (ci.yml Edge Deno Check +
// deploy.yml'de deploy-öncesi kontrol); bu, geri bildirimi yerele çeken erken
// uyarıdır. PR G dersi: parse-sms tip hatası CI deno koşmadığı için sessizdi.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const functionsDir = fileURLToPath(new URL('../supabase/functions', import.meta.url))
const targets = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => join('supabase/functions', entry.name, 'index.ts'))

if (targets.length === 0) {
  console.error('supabase/functions altında fonksiyon bulunamadı — beklenmedik durum.')
  process.exit(1)
}

const probe = spawnSync('deno', ['--version'], { shell: true, stdio: 'ignore' })
if (probe.status !== 0) {
  console.warn('')
  console.warn('⚠ deno bulunamadı — edge fonksiyonları tip-DENETLENMEDİ.')
  console.warn('  Edge dosyasına dokunduysan deno kurup şunu koş:')
  console.warn('    deno check supabase/functions/*/index.ts')
  console.warn('  (CI kapısı yine yakalar ama geri bildirim PR sonrasına kayar.)')
  console.warn('')
  process.exit(0)
}

const result = spawnSync('deno', ['check', ...targets], { shell: true, stdio: 'inherit' })
process.exit(result.status ?? 1)
