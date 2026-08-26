import { describe, expect, it } from 'vitest'

/**
 * Migration dosya adı guard'ı (docs.guard deseni — Vite lazy glob, Node fs yok).
 *
 * `schema_migrations` PK'sı timestamp: çakışan iki dosya `db reset`'i kriptik
 * 23505 ile patlatır ve bu HATA yalnız database-path'li CI job'ının 3-5
 * dakikalık kurulumundan sonra görünür — frontend-only PR'da hiç görünmez.
 * Paralel oturumlar (aynı repoda birden çok agent) aynı gün migration
 * açabildiği için risk gerçek ve CLAUDE.md'de gotcha olarak belgeliydi; bu
 * guard aynı hatayı her `npm run test:unit` koşusunda saniyeler içinde,
 * net mesajla yakalar.
 */

const migrationFiles = Object.keys(import.meta.glob('/supabase/migrations/*.sql')).map(
  (path) => path.split('/').at(-1)!,
)

const NAME_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/

describe('supabase/migrations dosya adları', () => {
  it('en az bir migration görür (glob kırılırsa guard sessizce boş geçmesin)', () => {
    expect(migrationFiles.length).toBeGreaterThan(100)
  })

  it('her dosya 14 haneli timestamp + snake_case ad biçiminde', () => {
    const bad = migrationFiles.filter((name) => !NAME_PATTERN.test(name))
    expect(bad, `Biçim dışı migration adı: ${bad.join(', ')}`).toEqual([])
  })

  it('timestamp benzersiz (schema_migrations PK — çakışma db reset 23505)', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const name of migrationFiles) {
      const stamp = NAME_PATTERN.exec(name)?.[1]
      if (!stamp) continue
      const existing = seen.get(stamp)
      if (existing) clashes.push(`${stamp}: ${existing} ↔ ${name}`)
      seen.set(stamp, name)
    }
    expect(clashes, `Çakışan migration timestamp'i: ${clashes.join('; ')}`).toEqual([])
  })

  it('timestamp geçerli bir tarih-saat (ay 01-12, gün 01-31, saat 00-23)', () => {
    const bad = migrationFiles.filter((name) => {
      const stamp = NAME_PATTERN.exec(name)?.[1]
      if (!stamp) return false
      const month = Number(stamp.slice(4, 6))
      const day = Number(stamp.slice(6, 8))
      const hour = Number(stamp.slice(8, 10))
      const minute = Number(stamp.slice(10, 12))
      return month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59
    })
    expect(bad, `Takvim dışı timestamp: ${bad.join(', ')}`).toEqual([])
  })
})
