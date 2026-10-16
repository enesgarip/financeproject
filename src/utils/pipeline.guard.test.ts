import { describe, expect, it } from 'vitest'
import deploy from '../../.github/workflows/deploy.yml?raw'
import ci from '../../.github/workflows/ci.yml?raw'
import packageSource from '../../package.json?raw'

type Result = 'success' | 'failure' | 'cancelled' | 'skipped'
type Job = { result: Result; outputs?: Record<string, string> }

// Gerçek workflow koşulunu çalıştırır: testte release koşulunun kopyası yoktur.
function permits(job: string, needs: Record<string, Job>, cancelled = false) {
  const block = deploy.split(`\n  ${job}:\n`)[1]?.split(/\n {2}\w+:\n/)[0] ?? ''
  const expression = block.match(/if: >-\s*\$\{\{([\s\S]*?)\}\}/)?.[1]
  if (!expression) throw new Error(`${job} yayın koşulu bulunamadı`)
  return new Function('needs', 'cancelled', 'always', `return (${expression})`)(needs, () => cancelled, () => true)
}

function release(frontend: boolean, database: boolean, migrations: boolean, edge: boolean): Record<string, Job> {
  return {
    changes: { result: 'success', outputs: {
      frontend: String(frontend), database: String(database), migrations: String(migrations), edge: String(edge),
    } },
    verify: { result: 'success' },
    build: { result: 'success', outputs: { deployment_url: 'https://demo.vercel.app' } },
    database_check: { result: database ? 'success' : 'skipped' },
    backup: { result: migrations ? 'success' : 'skipped' },
    edge_check: { result: edge ? 'success' : 'skipped' },
    release_supabase: { result: migrations || edge ? 'success' : 'skipped' },
  }
}

describe('production yayın kapıları', () => {
  const profiles = [
    [true, false, false, false], // yalnız frontend
    [true, true, false, false], // frontend + DB testi/seed/config
    [true, true, true, false], // frontend + migration
    [true, false, false, true], // frontend + edge
    [true, true, true, true], // tam release
    [false, true, true, false], // yalnız migration
    [false, false, false, true], // yalnız edge
    [false, false, false, false], // yalnız docs
  ] as const

  for (const profile of profiles) {
    const [frontend, database, migrations, edge] = profile
    it(`kapsama göre gereken kapıları bekler: ${profile}`, () => {
      const needs = release(frontend, database, migrations, edge)
      expect(permits('publish_frontend', needs)).toBe(frontend)
      expect(permits('release_supabase', needs)).toBe(migrations || edge)
      expect(permits('publish_frontend', needs, true)).toBe(false)
      expect(permits('release_supabase', needs, true)).toBe(false)

      for (const job of ['changes', 'verify', 'database_check', 'backup', 'edge_check', 'release_supabase']) {
        for (const result of ['failure', 'cancelled'] as const) {
          const broken = { ...needs, [job]: { ...needs[job], result } }
          expect(permits('publish_frontend', broken), `${job}:${result}`).toBe(false)
          if (job !== 'release_supabase') expect(permits('release_supabase', broken), `${job}:${result}`).toBe(false)
        }
      }
      for (const job of ['changes', 'verify', ...(database ? ['database_check'] : []), ...(migrations ? ['backup'] : []), ...(edge ? ['edge_check'] : [])]) {
        const skipped = { ...needs, [job]: { ...needs[job], result: 'skipped' as const } }
        expect(permits('publish_frontend', skipped), `${job}:skipped`).toBe(false)
        expect(permits('release_supabase', skipped), `${job}:skipped`).toBe(false)
      }
      if (migrations || edge) {
        expect(permits('publish_frontend', { ...needs, release_supabase: { result: 'skipped' } })).toBe(false)
      }
    })
  }

  it('staged URL yokken veya build başarısızken canlıya çıkmaz', () => {
    const needs = release(true, false, false, false)
    for (const result of ['failure', 'cancelled', 'skipped'] as const) {
      expect(permits('publish_frontend', { ...needs, build: { ...needs.build, result } })).toBe(false)
    }
    expect(permits('publish_frontend', { ...needs, build: { result: 'success', outputs: { deployment_url: '' } } })).toBe(false)
  })

  it('required kontrol adını ve tüm alt işlerin başarı şartını korur', () => {
    for (const [workflow, job] of [[ci, 'quality'], [deploy, 'verify']]) {
      const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}\w+:\n/)[0]
      expect(block).toContain('name: Lint and Build')
      expect(block).toContain('needs: [checks, build]')
      expect(block).toContain('test "$CHECKS_RESULT" = success && test "$BUILD_RESULT" = success')
    }
  })

  it('Node dosya kontrollerini tam test ve CI kapılarında zorunlu tutar', () => {
    const { scripts } = JSON.parse(packageSource) as { scripts: Record<string, string> }
    for (const command of ['test:unit', 'test:coverage', 'test:changed']) {
      expect(scripts[command]).toMatch(/^npm run test:guards && /)
    }
    expect(scripts['test:guards']).toBe('node scripts/run-guards.mjs')
    expect(scripts['ci:local']).toContain('npm run test:unit')
    expect(scripts.verify).toContain('npm run test:coverage')
    for (const workflow of [ci, deploy]) expect(workflow).toContain('run: npm run test:coverage')
  })
})
