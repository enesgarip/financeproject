// run-db-tests.mjs ile aynı desen: yeni guard otomatik kapsanır, boş küme hata verir.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(root, 'tests/guards')
const files = readdirSync(directory).filter((file) => file.endsWith('.test.mjs')).sort()
for (const required of ['docs.guard.test.mjs', 'encoding.guard.test.mjs']) {
  if (!files.includes(required)) throw new Error(`Zorunlu dosya guard'ı bulunamadı: ${required}`)
}
const result = spawnSync(process.execPath, ['--test', ...files.map((file) => path.join(directory, file))], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
