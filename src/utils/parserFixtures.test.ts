import { describe, expect, it } from 'vitest'
import { expenseCategories } from './categories'
import { parseDenizBankMovementPdf } from './denizBankMovementParser'
import { parseDenizBankStatement } from './denizBankStatementParser'

/**
 * Golden-file parser koruması. `__fixtures__/parsers/` altındaki her metin
 * örneği için yapısal invariantlar doğrulanır — tek tek satır beklentisi değil,
 * "çıktı anlamlı mı" kuralları. Banka formatı kayarsa veya parser'a dokunulursa
 * sessiz yanlış okuma burada patlar.
 *
 * Yeni format eklemek = dizine dosya bırakmak (bkz. __fixtures__/parsers/README.md).
 * Dosyalar Vite'ın `?raw` glob'u ile okunur; node:fs kullanılmaz (tsconfig.app
 * node tiplerini içermiyor — bkz. encoding.guard.test.ts).
 */
const FIXTURES = import.meta.glob<string>('/src/utils/__fixtures__/parsers/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function fixtureName(path: string): string {
  return path.split('/').pop() ?? path
}

const entries = Object.entries(FIXTURES)

describe('parser golden fixtures', () => {
  it('en az bir fixture bulunur (glob yolu bozulmadı)', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('her fixture tanınan bir önek taşır', () => {
    for (const [path] of entries) {
      const name = fixtureName(path)
      expect(name.startsWith('statement.') || name.startsWith('movement.'), `${name} bilinmeyen önek`).toBe(true)
    }
  })

  for (const [path, text] of entries) {
    const name = fixtureName(path)

    if (name.startsWith('statement.')) {
      describe(name, () => {
        const parsed = parseDenizBankStatement(text)

        it('ekstre başlığını okur', () => {
          expect(parsed.totalDebt).toBeGreaterThan(0)
          expect(parsed.statementDate).toMatch(ISO_DATE)
          expect(parsed.dueDate).toMatch(ISO_DATE)
          expect(parsed.dueDate >= parsed.statementDate).toBe(true)
        })

        it('en az bir işlem satırı çıkarır', () => {
          expect(parsed.transactions.length).toBeGreaterThan(0)
        })

        it('her işlem satırı yapısal olarak geçerli', () => {
          for (const tx of parsed.transactions) {
            expect(tx.description.trim().length, `boş açıklama: ${JSON.stringify(tx)}`).toBeGreaterThan(0)
            expect(tx.amount, `pozitif olmayan tutar: ${tx.description}`).toBeGreaterThan(0)
            expect(tx.date === '' || ISO_DATE.test(tx.date), `geçersiz tarih: ${tx.date}`).toBe(true)
            expect(expenseCategories, `bilinmeyen kategori: ${tx.category}`).toContain(tx.category)
            expect(tx.installmentNo).toBeGreaterThanOrEqual(1)
            if (tx.isInstallment) {
              // count === 0 kasıtlı: satır taksitli ama toplam taksit sayısı
              // PDF'te yazmıyor (bkz. parseInstallmentInfo). Tüketiciler
              // `count > 1` ile korunur; 1 ise çelişki demektir.
              expect(tx.installmentCount, `taksitli satır count=1: ${tx.description}`).not.toBe(1)
              if (tx.installmentCount > 1) expect(tx.installmentNo).toBeLessThanOrEqual(tx.installmentCount)
            }
          }
        })

        it('işlem toplamı ekstre borcunu aşmaz', () => {
          // Ekstre borcu devreden bakiye + dönem içi harcamadır; tek tek satırlar
          // bunun üstüne çıkıyorsa bir satır iki kez okunmuş demektir.
          const total = parsed.transactions.reduce((sum, tx) => sum + tx.amount, 0)
          expect(total).toBeLessThanOrEqual(parsed.totalDebt * 1.5)
        })
      })
    }

    if (name.startsWith('movement.')) {
      describe(name, () => {
        const parsed = parseDenizBankMovementPdf(text)

        it('hiçbir satır okunamadan atlanmaz', () => {
          expect(parsed.ignoredRows, `atlanan satırlar: ${parsed.ignoredRows.join(' | ')}`).toHaveLength(0)
        })

        it('en az bir hareket çıkarır', () => {
          expect(parsed.movements.length + parsed.payments.length).toBeGreaterThan(0)
        })

        it('her hareket yapısal olarak geçerli', () => {
          for (const movement of [...parsed.movements, ...parsed.payments]) {
            expect(movement.description.trim().length).toBeGreaterThan(0)
            expect(movement.amount).toBeGreaterThan(0)
            expect(movement.date).toMatch(ISO_DATE)
            expect(movement.cardLastFour).toMatch(/^\d{4}$/)
            expect(['pending', 'posted']).toContain(movement.bankStatus)
          }
        })

        it('taksitli satırlarda taksit bilgisi tutarlı', () => {
          for (const movement of parsed.movements) {
            if (!movement.isInstallment) continue
            expect(movement.installmentNo).toBeGreaterThanOrEqual(1)
            // 0 = toplam taksit sayısı PDF'te yok (kasıtlı); 1 olması çelişki.
            expect(movement.installmentCount, `taksitli satır count=1: ${movement.description}`).not.toBe(1)
            if (movement.installmentCount > 1) {
              expect(movement.installmentNo).toBeLessThanOrEqual(movement.installmentCount)
            }
          }
        })
      })
    }
  }
})
