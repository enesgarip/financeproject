/**
 * DenizBank EKSTRE metnini yapısal işlemlere ayrıştırır (kopyala-yapıştır PDF/
 * metin → ParsedTransaction[]). Taksit notasyonunu (X/Y) yakalar ve kategoriyi
 * categories.ts ile tahmin eder.
 *
 * Bu yalnız metin AYRIŞTIRMA; ledger'a yazma cardsRepo/StatementImportModal işi.
 * Karşılaştırma money.ts ile (tutar eşleşmesinde float toleransı yaratma).
 */
import { suggestExpenseCategory, type CategoryMemory } from './categories'
import { diffTL, roundTL, sumTL } from './money'
import { normalizeSearchText } from './searchText'

export type ParsedTransaction = {
  date: string
  description: string
  amount: number
  category: string
  isInstallment: boolean
  /** Bu satırın kaçıncı taksit olduğu (peşin/tek çekimde 1). */
  installmentNo: number
  /** Toplam taksit sayısı; ekstrede notasyon yoksa 0 (bilinmiyor). */
  installmentCount: number
  /**
   * Notasyondaki kalan borç (`<kalan>/<toplam>-<sıra>` içindeki <kalan>); bu
   * taksit ödendikten SONRAKİ plan bakiyesi. Notasyon yoksa null. `aylık × adet`
   * yeniden kurulumunu bağımsız doğrulamak için tutulur (bkz. checkInstallmentNotation).
   */
  remainingDebt: number | null
}

export type ParsedStatementAdjustment = {
  date: string
  description: string
  amount: number
  category: string
}

export type ParsedStatement = {
  cardLastFour: string
  statementDate: string
  dueDate: string
  totalDebt: number
  transactions: ParsedTransaction[]
  adjustments?: ParsedStatementAdjustment[]
  /**
   * Başlık özet alanları (parse doğrulama checksum'ı için; bkz.
   * checkStatementParseTotals). Ekstrede yoksa null. Gerçek DenizBank
   * ekstrelerinde bu alanlar iki bağımsız kimliği KESİN sağlar:
   *  - Başlık: Dönem Borcu = Önceki − Ödemeler + Dönem İçi + Faiz
   *  - Satır:  Σ(işlem) − Σ(iade) = Dönem İçi + Faiz
   */
  previousBalance?: number | null
  payments?: number | null
  periodSpending?: number | null
  feesAndInterest?: number | null
}

// ── PDF section headers → app categories ──────────────────────────────────

const SECTION_CATEGORY: Record<string, string> = {
  'AKARYAKIT': 'Ulaşım',
  'SEYAHAT & ULAŞIM': 'Ulaşım',
  'CAFE & RESTAURANT': 'Yeme & İçme',
  'MARKET & SUPERMARKET': 'Market',
  'FAST-FOOD': 'Yeme & İçme',
  'SİGORTA': 'Diğer',
  'PASTANE': 'Yeme & İçme',
  'ECZANE': 'Sağlık',
  'OTOMOTİV': 'Diğer',
  'DİĞER İŞLEM VE HARCAMALARINIZ': 'Diğer',
  'NAKİT AVANS BİLGİLERİ': 'Diğer',
  'BONUS PROGRAM ORTAKLARINDA YAPTIĞINIZ HARCAMALAR': 'Diğer',
  'BONUS PROGRAM ORTAKLARI DIŞINDA YAPTIĞINIZ HARCAMALAR': 'Diğer',
}

/**
 * Bölüm başlığı eşleştirmesi için metni I-duyarsız hale getirir.
 *
 * Neden: eski kod çıplak `toUpperCase()` kullanıyordu; "Sigorta" → "SIGORTA"
 * olup "SİGORTA" anahtarını tutmuyordu (CLAUDE.md tr-TR I/İ tuzağı). Projenin
 * `normalizeSearchText` deseni büyük I/İ'yi 'i'ye katlar; başlık eşleşmesinde
 * yönü tamamlamak için noktasız 'ı' da 'i'ye katlanır — böylece PDF başlığı
 * BÜYÜK, Başlık ya da küçük harfle gelse de aynı anahtara düşer.
 */
function normalizeSection(value: string): string {
  return normalizeSearchText(value).replace(/ı/g, 'i')
}

const SECTION_KEYS = Object.keys(SECTION_CATEGORY).map((key) => ({
  key,
  normalized: normalizeSection(key),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a money string robustly for BOTH locales. The decimal separator is
 * whichever of '.' / ',' appears LAST; the other is the thousands separator.
 * Statement PDFs use English "1,234.56", but this guards against silent
 * corruption if a Turkish-formatted "1.234,56" ever slips in (the old
 * comma-strip + parseFloat turned "1.234,56" → "1.234.56" → 1.234).
 */
export function parseAmount(s: string): number {
  const trimmed = s.trim()
  const lastComma = trimmed.lastIndexOf(',')
  const lastDot = trimmed.lastIndexOf('.')
  const normalized =
    lastComma > lastDot
      ? trimmed.replace(/\./g, '').replace(',', '.') // Turkish: '.' thousands, ',' decimal
      : trimmed.replace(/,/g, '') // English: ',' thousands, '.' decimal
  const parsed = parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDate(s: string): string {
  // DD/MM/YYYY → YYYY-MM-DD
  const [d, m, y] = s.split('/')
  return `${y}-${m}-${d}`
}

function cleanDescription(s: string): string {
  // Remove trailing single-word city + country code, e.g. "BURSA TR", "LONDON GBR"
  return s
    .replace(/\s+[A-ZÇĞİÖŞÜ]+\s+(TR|TUR|GBR|IRL|NLD|USA|EUR)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function sectionCategoryFor(line: string): string | null {
  const normalized = normalizeSection(line)
  const found = SECTION_KEYS.find((entry) => normalized.includes(entry.normalized))
  return found ? (SECTION_CATEGORY[found.key] ?? null) : null
}

// ── Main parser ────────────────────────────────────────────────────────────

export function parseDenizBankStatement(text: string, memory?: CategoryMemory): ParsedStatement {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  // Header fields
  let cardLastFour = ''
  let statementDate = ''
  let dueDate = ''
  let totalDebt = 0
  let previousBalance: number | null = null
  let payments: number | null = null
  let periodSpending: number | null = null
  let feesAndInterest: number | null = null

  const cardMatch = text.match(/Kart Numarası\s+\d{4}\s+\d{2}\*{2}\s+\*{4}\s+(\d{4})/)
  if (cardMatch) cardLastFour = cardMatch[1]

  const stmtMatch = text.match(/Hesap Kesim Tarihi\s+(\d{2}\/\d{2}\/\d{4})/)
  if (stmtMatch) statementDate = parseDate(stmtMatch[1])

  const dueMatch = text.match(/Son Ödeme Tarihi\s+(\d{2}\/\d{2}\/\d{4})/)
  if (dueMatch) dueDate = parseDate(dueMatch[1])

  const totalMatch = text.match(/Dönem Borcu\s+([\d.,]+)\s+TL/)
  if (totalMatch) totalDebt = parseAmount(totalMatch[1])

  // Özet başlık alanları (parse doğrulama checksum'ı için — 8 gerçek ekstrede
  // kalibre edildi, bkz. checkStatementParseTotals).
  const prevMatch = text.match(/Önceki Hesap Bakiyeniz\s+([\d.,]+)\s+TL/)
  if (prevMatch) previousBalance = parseAmount(prevMatch[1])
  const payMatch = text.match(/Ödemeler\s+([\d.,]+)\s+TL/)
  if (payMatch) payments = parseAmount(payMatch[1])
  const spendMatch = text.match(/Dönem İçi Harcamanız\s+([\d.,]+)\s+TL/)
  if (spendMatch) periodSpending = parseAmount(spendMatch[1])
  const feeMatch = text.match(/Toplam Faiz ve Ücretler\s+([\d.,]+)\s+TL/)
  if (feeMatch) feesAndInterest = parseAmount(feeMatch[1])

  // Transaction parsing
  const transactions: ParsedTransaction[] = []
  const adjustments: ParsedStatementAdjustment[] = []
  let sectionCategory = 'Diğer'

  const DATE_PREFIX = /^\d{2}\/\d{2}\/\d{4}/
  const AMOUNT_SUFFIX = /([\d.,]+)(\+?)\s+TL$/

  for (const line of lines) {
    // Non-date lines: check for section header, then skip
    if (!DATE_PREFIX.test(line)) {
      const secCat = sectionCategoryFor(line)
      if (secCat !== null) sectionCategory = secCat
      continue
    }

    // Nakit avansın faiz/BSMV/KKDF satırları Dönem Borcu'na dahildir; bunlar
    // peşin masraf olarak içeri alınır (atlanırsa toplam eksik kalır).

    // Skip Hesaptan Ödeme
    if (line.includes('Hesaptan Ödeme')) continue

    // Skip previous period header
    if (line.includes('ÖNCEKİ DÖNEM')) continue

    // Skip zero-amount entries (bonus only)
    if (/\b0[.,]00\s+TL$/.test(line)) continue

    // Extract amount from end of line
    const amountMatch = line.match(AMOUNT_SUFFIX)
    if (!amountMatch) continue
    const amount = parseAmount(amountMatch[1])
    if (amount <= 0) continue
    const isCredit = amountMatch[2] === '+'

    // Extract date
    const date = parseDate(line.substring(0, 10))

    // Everything between date and amount TL is the description region
    let descRegion = line.substring(11, line.length - amountMatch[0].length).trim()

    const isInstallment = /taksit/i.test(descRegion)

    // "Kalan Borç / Taksit" notation e.g. "43,333.33/3-1" → <kalan>/<toplam>-<kaçıncı>
    const installmentNotation = descRegion.match(/([\d.,]+)\/(\d+)-(\d+)/)
    let installmentCount = isInstallment ? 0 : 1
    let installmentNo = 1
    let remainingDebt: number | null = null
    if (installmentNotation) {
      remainingDebt = parseAmount(installmentNotation[1])
      installmentCount = Number(installmentNotation[2])
      installmentNo = Number(installmentNotation[3])
    } else if (isInstallment) {
      // Fallback: açıklamadaki "3.Tk" gibi ifadeden sıra no'su (toplam bilinmez)
      const tkMatch = descRegion.match(/(\d+)\s*\.?\s*Tk\b/i)
      if (tkMatch) installmentNo = Number(tkMatch[1])
    }

    // Strip "Kalan Borç/Taksit" notation e.g. "43,333.33/3-1"
    descRegion = descRegion.replace(/\s+[\d.,]+\/\d+-\d+\s*/g, ' ')

    // Sondaki tek başına duran bonus tutarını at: "195.00", "19.96" ve binlik
    // ayraçlı "1,996.00" / "1.996,00". Ayraç grubu olmadan (`\d+[.,]\d{2}`)
    // binlik ayraçlı bonus açıklamada kalıp satıcı adını kirletiyordu.
    descRegion = descRegion.replace(/\s+\d+(?:[.,]\d{3})*[.,]\d{2}\s*$/, '')

    const description = cleanDescription(descRegion)
    if (!description) continue

    // Category: prefer suggestExpenseCategory (learns from history), fall back to section
    const category = suggestExpenseCategory(description, memory) ?? sectionCategory

    if (isCredit) {
      adjustments.push({ date, description, amount, category })
      continue
    }

    transactions.push({ date, description, amount, category, isInstallment, installmentNo, installmentCount, remainingDebt })
  }

  return {
    cardLastFour, statementDate, dueDate, totalDebt, transactions, adjustments,
    previousBalance, payments, periodSpending, feesAndInterest,
  }
}

// ── Parse doğrulama checksum'ı ───────────────────────────────────────────────

export type StatementParseCheck = {
  /** Karşılaştırma yapılabildi mi (gerekli başlık alanları mevcut). */
  checked: boolean
  /** Beklenen − gerçek fark (TL, işaretli); 0 = tutarlı. */
  residualTL: number
  /** Tolerans içinde mi. */
  consistent: boolean
}

export type StatementParseTotals = {
  /** Başlık öz-tutarlılığı: Dönem Borcu ≈ Önceki − Ödemeler + Dönem İçi + Faiz. */
  header: StatementParseCheck
  /**
   * Satır toplamı: Σ(işlem) − Σ(iade) ≈ Dönem İçi + Faiz. Tutmuyorsa parser bir
   * satırı DÜŞÜRMÜŞ ya da yanlış okumuş olabilir (kategori/taksit/geçmiş sessizce
   * bozulur — app-vs-banka kilidi bunu maskeler, o yüzden ayrı kontrol).
   */
  lines: StatementParseCheck
}

/** Fark bu eşiğin altındaysa tutarlı say. 8 gerçek ekstrede residual tam 0; eşik
 *  yalnız tek-kuruş gürültüsüne karşı, düşen satır (≫ 1 TL) yakalanır. */
export const STATEMENT_TOTAL_TOLERANCE_TL = 1

/**
 * Satır kimliğinin sağ tarafı: dönem içi NET hareket beklentisi.
 *
 * İki kaynak, öncelik sırasıyla:
 *  1. DenizBank ekstresi "Dönem İçi Harcamanız" + "Toplam Faiz ve Ücretler"i
 *     doğrudan basar → doğrudan onu kullan.
 *  2. YapıKredi bu iki alanı basmaz; devir satırı (ÖNCEKİ DÖNEM … BORCU),
 *     ödeme satırları ve dönem borcu (TOPLAM footer'ı) vardır → kimlik
 *     `Dönem Borcu = Önceki − Ödemeler + net hareket` üzerinden TÜRETİLİR.
 *
 * Türetme dairesel DEĞİL: dönem borcu ve devir, işlem satırlarından bağımsız
 * basılır. Bu yüzden düşen bir satır residual üretir (kimliğin varlık sebebi).
 * Alanlar yoksa null → `checked=false` (körlemesine geçme).
 */
function expectedPeriodMovement(statement: ParsedStatement): number | null {
  const { totalDebt, previousBalance, payments, periodSpending, feesAndInterest } = statement
  if (periodSpending != null && feesAndInterest != null) return roundTL(periodSpending + feesAndInterest)
  if (previousBalance != null && payments != null) return roundTL(totalDebt - previousBalance + payments)
  return null
}

/**
 * Ekstre parse'ının kendi içinde tutarlı olup olmadığını iki bağımsız kimlikle
 * doğrular (8 gerçek DenizBank ekstresinde kalibre edildi — her ikisi de residual 0).
 * app-vs-banka mutabakatından FARKLIDIR: o app kaydını bankaya çeker; bu, PDF'ten
 * OKUNAN verinin PDF'in kendi özetiyle tutup tutmadığını sorar. Gerekli alan
 * yoksa `checked=false` (körlemesine geçme).
 */
export function checkStatementParseTotals(statement: ParsedStatement): StatementParseTotals {
  const { totalDebt, previousBalance, payments, periodSpending, feesAndInterest } = statement

  const headerChecked =
    previousBalance != null && payments != null && periodSpending != null && feesAndInterest != null
  const headerExpected = headerChecked
    ? roundTL(previousBalance - payments + periodSpending + feesAndInterest)
    : 0
  const headerResidual = headerChecked ? diffTL(headerExpected, totalDebt) : 0

  const txSum = sumTL(statement.transactions.map((t) => t.amount))
  const adjSum = sumTL((statement.adjustments ?? []).map((a) => a.amount))
  const periodMovement = expectedPeriodMovement(statement)
  const linesChecked = periodMovement != null
  const linesResidual = periodMovement != null ? diffTL(periodMovement, roundTL(txSum - adjSum)) : 0

  return {
    header: {
      checked: headerChecked,
      residualTL: headerResidual,
      consistent: Math.abs(headerResidual) <= STATEMENT_TOTAL_TOLERANCE_TL,
    },
    lines: {
      checked: linesChecked,
      residualTL: linesResidual,
      consistent: Math.abs(linesResidual) <= STATEMENT_TOTAL_TOLERANCE_TL,
    },
  }
}
