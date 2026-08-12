import { describe, expect, it } from 'vitest'
import { expenseCategories } from './categories'
import { parseDenizBankMovementPdf } from './denizBankMovementParser'
import { checkStatementParseTotals, parseDenizBankStatement, type ParsedStatement } from './denizBankStatementParser'
import { parseYapiKrediStatement } from './yapiKrediStatementParser'

/**
 * Golden-file parser koruması. `__fixtures__/parsers/` altındaki her metin
 * örneği için yapısal invariantlar doğrulanır — tek tek satır beklentisi değil,
 * "çıktı anlamlı mı" kuralları. Banka formatı kayarsa veya parser'a dokunulursa
 * sessiz yanlış okuma burada patlar.
 *
 * Yeni format eklemek = dizine dosya bırakmak (bkz. __fixtures__/parsers/README.md).
 * Dosyalar Vite'ın `?raw` glob'u ile okunur; node:fs kullanılmaz (tsconfig.app
 * node tiplerini içermiyor — bkz. encoding.guard.test.ts).
 *
 * Banka seçimi DOSYA ADI ÖNEKİNDEN yapılır (`statement.<banka>-…`): eskiden her
 * `statement.*` sabit DenizBank parser'ına gidiyordu, bu yüzden bir YapıKredi
 * fixture'ı eklenirse sessizce yanlış parser'la okunurdu.
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

type StatementFixtureBank = {
  /** Dosya adı öneki: `statement.<id>-<dönem>.txt`. */
  id: string
  parse: (text: string) => ParsedStatement
  /**
   * Dönem borcu 0 olabilir mi? YapıKredi tamamı ödenmiş dönemde "TOPLAM 0,00"
   * basar; DenizBank fixture'larında 0 borç parse hatası demektir.
   */
  allowZeroTotalDebt: boolean
}

const STATEMENT_BANKS: StatementFixtureBank[] = [
  { id: 'denizbank', parse: parseDenizBankStatement, allowZeroTotalDebt: false },
  { id: 'yapikredi', parse: parseYapiKrediStatement, allowZeroTotalDebt: true },
]

const MOVEMENT_BANKS = ['denizbank']

/** `statement.yapikredi-2026-07.txt` → yapikredi girdisi (yoksa null). */
function statementBank(name: string): StatementFixtureBank | null {
  return STATEMENT_BANKS.find((bank) => name.startsWith(`statement.${bank.id}-`)) ?? null
}

function movementBank(name: string): string | null {
  return MOVEMENT_BANKS.find((bank) => name.startsWith(`movement.${bank}-`)) ?? null
}

const entries = Object.entries(FIXTURES)

describe('parser golden fixtures', () => {
  it('en az bir fixture bulunur (glob yolu bozulmadı)', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('her fixture tanınan bir banka öneki taşır', () => {
    // Yalnız `statement.`/`movement.` değil, BANKA da tanınmalı: tanınmayan
    // banka sessizce yanlış parser'a düşmesin (ör. YK metni DenizBank'a).
    for (const [path] of entries) {
      const name = fixtureName(path)
      const known = statementBank(name) !== null || movementBank(name) !== null
      expect(known, `${name} bilinmeyen önek/banka — bkz. __fixtures__/parsers/README.md`).toBe(true)
    }
  })

  for (const [path, text] of entries) {
    const name = fixtureName(path)
    const bank = statementBank(name)

    if (bank) {
      describe(name, () => {
        const parsed = bank.parse(text)

        it('ekstre başlığını okur', () => {
          if (bank.allowZeroTotalDebt) expect(parsed.totalDebt).toBeGreaterThanOrEqual(0)
          else expect(parsed.totalDebt).toBeGreaterThan(0)
          expect(parsed.statementDate).toMatch(ISO_DATE)
          expect(parsed.dueDate).toMatch(ISO_DATE)
          expect(parsed.dueDate >= parsed.statementDate).toBe(true)
        })

        it('özet alanı taşıyan fixture için checksum kimliği ÇALIŞIR', () => {
          // Denetim bulgusu: YK yolunda her iki kimlik de checked=false dönüyordu
          // (parser özet alanlarını doldurmuyordu) → düşen satır sessiz kalıyordu.
          // Burada TUTARLILIK iddia EDİLMEZ: fixture'lar elle maskelenir ve sayfa
          // atlanabilir (mevcut DenizBank örneğinde 2. sayfa yok), residual ≠ 0
          // olması fixture eksikliğidir, parser hatası değil.
          if (!/Dönem İçi Harcamanız|ÖNCEKİ DÖNEM/i.test(text)) return
          const totals = checkStatementParseTotals(parsed)
          expect(totals.lines.checked || totals.header.checked).toBe(true)
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
          // bunun üstüne çıkıyorsa bir satır iki kez okunmuş demektir. Dönem
          // borcu 0 olan (tamamı ödenmiş) ekstrede oran anlamsız → checksum
          // kimliği o dosyada koruma görevini üstlenir.
          if (parsed.totalDebt === 0) return
          const total = parsed.transactions.reduce((sum, tx) => sum + tx.amount, 0)
          expect(total).toBeLessThanOrEqual(parsed.totalDebt * 1.5)
        })
      })
    }

    if (movementBank(name)) {
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
