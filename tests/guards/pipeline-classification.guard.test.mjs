import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const deploy = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')

// Git'in Bash'i Windows'ta da aynı workflow gövdesini çalıştırır.
function runReleaseScript(script, env) {
  return execFileSync('git', ['-c', 'alias.finance-release-test=!bash -e -c "$FINANCE_RELEASE_SCRIPT"', 'finance-release-test'], {
    encoding: 'utf8',
    env: { ...process.env, ...env, SHA: 'current', FINANCE_RELEASE_SCRIPT: script },
  })
}

function classifyRelease(files, event = 'push', base = 'last-success') {
  const command = deploy.match(/- name: Classify changes\n[\s\S]*?run: \|\n([\s\S]*?)\n {2}checks:/)?.[1]
  if (!command) throw new Error('Yayın sınıflandırıcısı bulunamadı')
  const output = join(tmpdir(), `finance-release-${randomUUID()}`).replaceAll('\\', '/')
  const gitMock = 'git() { test "$4" = --no-renames && test "$6" = "$FINANCE_RELEASE_BASE" || return 1; printf "%s\\n" "$FINANCE_RELEASE_FILES"; }'
  const ghMock = 'gh() { printf "%s\\n" "$FINANCE_RELEASE_BASE"; }'
  try {
    runReleaseScript([gitMock, ghMock, command].join('\n'), {
      EVENT_NAME: event,
      GITHUB_OUTPUT: output,
      FINANCE_RELEASE_BASE: base,
      FINANCE_RELEASE_FILES: files.join('\n'),
    })
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split(/\r?\n/).map(line => line.split('=')))
  } finally {
    rmSync(output, { force: true })
  }
}

function deployEdge(base, files) {
  const command = deploy.match(/- name: Deploy changed edge functions\n[\s\S]*?run: \|\n([\s\S]*?)\n {6}- name: Setup Node for scheduler configuration/)?.[1]
  if (!command) throw new Error('Edge yayın adımı bulunamadı')
  const gitMock = 'git() { test "$*" = "-c core.quotePath=false diff --no-renames --name-only last-success current -- supabase/functions scripts/configure-push-scheduler.mjs" || return 1; printf "%s\\n" "$FINANCE_RELEASE_FILES"; }'
  const supabaseMock = 'supabase() { test "$1 $2 $4 $5" = "functions deploy --project-ref test-project" || return 1; printf "released=%s\\n" "$3"; }'
  const output = runReleaseScript([gitMock, supabaseMock, command].join('\n'), {
    RELEASE_BASE: base,
    BEFORE: 'previous-push',
    EVENT_NAME: 'push',
    SUPABASE_PROJECT_REF: 'test-project',
    FINANCE_RELEASE_FILES: files.join('\n'),
  })
  return [...output.matchAll(/^released=(.+)$/gm)].map(match => match[1])
}

describe('production yayın kapsamı', () => {
  const none = { frontend: 'false', database: 'false', migrations: 'false', edge: 'false', release_base: 'last-success' }

  it('yalnız test ve belge değişince üretim kapsamı boş kalır', () => {
    assert.deepEqual(classifyRelease([
      'src/money.test.ts',
      'src/components/finance/nested/Modal.test.tsx',
      'tests/e2e/layout-viewport.spec.ts',
      'docs/BACKLOG.md',
    ]), none)
  })

  it('son başarılı yayından beri kalan uygulama değişikliğini test düzeltmesiyle birlikte yayımlar', () => {
    assert.deepEqual(classifyRelease(['src/utils/money.ts', 'src/utils/money.test.ts']), { ...none, frontend: 'true' })
  })

  it('veritabanı ve edge kapsamını testlerle birlikte korur', () => {
    assert.deepEqual(classifyRelease(['src/utils/money.test.ts', 'supabase/tests/cards.sql']), { ...none, database: 'true' })
    assert.deepEqual(classifyRelease(['supabase/migrations/20990101000000_example.sql', 'supabase/functions/parse-sms/index.ts']),
      { ...none, database: 'true', migrations: 'true', edge: 'true' })
    assert.deepEqual(classifyRelease(['supabase/functions/_shared/automationRules.ts']), { ...none, frontend: 'true', edge: 'true' })
  })

  it('manuel yayın veya başarılı taban bulunamadığında tüm kapıları açar', () => {
    const full = { frontend: 'true', database: 'true', migrations: 'true', edge: 'true', release_base: '' }
    assert.deepEqual(classifyRelease([], 'workflow_dispatch'), full)
    assert.deepEqual(classifyRelease([], 'push', ''), full)
  })

  it('önceki başarısız pushtaki edge değişikliğini son başarılı tabandan yayımlar', () => {
    const edgeFiles = ['supabase/functions/parse-sms/index.ts']
    const scope = classifyRelease([...edgeFiles, 'src/pages/DashboardPage.tsx'])
    assert.equal(scope.edge, 'true')
    assert.match(deploy, /release_base: \$\{\{ steps\.detect\.outputs\.release_base \}\}/)
    assert.match(deploy, /RELEASE_BASE: \$\{\{ needs\.changes\.outputs\.release_base \}\}/)
    assert.deepEqual(deployEdge(scope.release_base, edgeFiles), ['parse-sms'])
  })

  it('ortak edge kodu, scheduler veya eksik taban bütün fonksiyonları yayımlar', () => {
    const functions = readdirSync(new URL('../../supabase/functions/', import.meta.url), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== '_shared')
      .map(entry => entry.name)
      .sort()
    for (const files of [['supabase/functions/_shared/edge.ts'], ['scripts/configure-push-scheduler.mjs']]) {
      const scope = classifyRelease(files)
      assert.equal(scope.edge, 'true')
      assert.deepEqual(deployEdge(scope.release_base, files), functions)
    }
    assert.deepEqual(deployEdge(classifyRelease([], 'workflow_dispatch').release_base, []), functions)
  })
})
