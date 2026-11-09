import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const deploy = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n')

// Git'in Bash'i Windows'ta da aynı workflow gövdesini çalıştırır.
function classifyRelease(files, event = 'push', base = 'last-success') {
  const command = deploy.match(/- name: Classify changes\n[\s\S]*?run: \|\n([\s\S]*?)\n {2}checks:/)?.[1]
  if (!command) throw new Error('Yayın sınıflandırıcısı bulunamadı')
  const output = join(tmpdir(), `finance-release-${randomUUID()}`).replaceAll('\\', '/')
  const gitMock = 'git() { test "$4" = --no-renames && test "$6" = "$FINANCE_RELEASE_BASE" || return 1; printf "%s\\n" "$FINANCE_RELEASE_FILES"; }'
  const ghMock = 'gh() { printf "%s\\n" "$FINANCE_RELEASE_BASE"; }'
  try {
    execFileSync('git', ['-c', 'alias.finance-release-test=!bash -e -c "$FINANCE_RELEASE_SCRIPT"', 'finance-release-test'], {
      env: {
        ...process.env,
        EVENT_NAME: event,
        SHA: 'current',
        GITHUB_OUTPUT: output,
        FINANCE_RELEASE_BASE: base,
        FINANCE_RELEASE_FILES: files.join('\n'),
        FINANCE_RELEASE_SCRIPT: [gitMock, ghMock, command].join('\n'),
      },
    })
    return Object.fromEntries(readFileSync(output, 'utf8').trim().split(/\r?\n/).map(line => line.split('=')))
  } finally {
    rmSync(output, { force: true })
  }
}

describe('production yayın kapsamı', () => {
  const none = { frontend: 'false', database: 'false', migrations: 'false', edge: 'false' }

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
    const full = { frontend: 'true', database: 'true', migrations: 'true', edge: 'true' }
    assert.deepEqual(classifyRelease([], 'workflow_dispatch'), full)
    assert.deepEqual(classifyRelease([], 'push', ''), full)
  })
})
