import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
const archiveScript = path.resolve('scripts/archive-source-maps.mjs')
const traceScript = path.resolve('scripts/trace-client-error.mjs')
const temporary = []
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'denge-maps-'))
  temporary.push(root)
  mkdirSync(path.join(root, 'dist/assets'), { recursive: true })
  writeFileSync(path.join(root, 'dist/assets/app-test.js'), 'throw new Error("test");')
  writeFileSync(path.join(root, 'dist/assets/app-test.js.map'), JSON.stringify({ version: 3, file: 'app-test.js', sources: ['src/main.ts'], names: [], mappings: 'AAAA', sourcesContent: ['throw new Error("test");'] }))
  return root
}
afterEach(() => {
  for (const root of temporary.splice(0)) {
    // Yalnız mkdtemp ile oluşturulmuş ve doğrulanmış test klasörü silinir.
    assert.equal(path.dirname(root), os.tmpdir())
    assert.match(path.basename(root), /^denge-maps-/)
    rmSync(root, { recursive: true, force: true })
  }
})
test('haritaları public dist dışına taşır, bundle checksum ve release ile arşivler', () => {
  const root = fixture()
  execFileSync(process.execPath, [archiveScript], { cwd: root, env: { ...process.env, GITHUB_SHA: 'abc123' } })
  assert.deepEqual(readdirSync(path.join(root, 'dist/assets')), ['app-test.js'])
  const manifest = JSON.parse(readFileSync(path.join(root, '.diagnostics/source-maps/abc123/manifest.json'), 'utf8'))
  assert.equal(manifest.release, 'abc123')
  assert.equal(manifest.files[0].bundle, 'app-test.js')
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(spawnSync(process.execPath, [archiveScript, '--check-public'], { cwd: root }).status, 0)
})
test('public Vercel çıktısında unutulmuş map varsa deploy kapısını kırar', () => {
  const root = fixture()
  assert.notEqual(spawnSync(process.execPath, [archiveScript, '--check-public'], { cwd: root }).status, 0)
  execFileSync(process.execPath, [archiveScript], { cwd: root })
  mkdirSync(path.join(root, '.vercel/output/static/assets'), { recursive: true })
  writeFileSync(path.join(root, '.vercel/output/static/assets/leak.map'), '{}')
  assert.notEqual(spawnSync(process.execPath, [archiveScript, '--check-public'], { cwd: root }).status, 0)
})
test('sıkıştırılmış konumu özgün kaynak dosyasına çevirir', () => {
  const root = fixture()
  const output = execFileSync(process.execPath, [traceScript, path.join(root, 'dist/assets/app-test.js.map'), '1', '1'], { encoding: 'utf8' })
  assert.equal(output.trim(), 'src/main.ts:1:1')
})
