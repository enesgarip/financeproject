/**
 * YapıKredi (Worldcard) EKSTRE metnini ParsedStatement'a ayrıştırır. Aynı import
 * pipeline'ını (resolveStatementImportAction) DenizBank ile paylaşır; yalnız
 * METİN düzeni farklı.
 *
 * YapıKredi'nin DenizBank'tan farkları:
 *  - Tarih Türkçe ay-isimli: "05 Mart 2026" (DenizBank: 05/03/2026).
 *  - Sayı Türkçe: "16.333,22" (parseAmount iki locale'i de çözer).
 *  - Taksit bilgisi işlem satırının ALTINDAKİ satırda:
 *    "146.999,00 TL'lik işlemin 4 / 9 taksidi" → toplam / (kaçıncı / toplam adet).
 *    İşlem satırındaki tutar AYLIK taksit tutarıdır (DenizBank ile aynı semantik).
 *    Plan toplamı "kalan borç"a çevrilir (kalan = toplam − aylık × sıra) →
 *    DenizBank ile aynı checkInstallmentNotation tutarlılık kontrolü çalışır.
 *  - İşlemler yalnız "İşlem Tarihi İşlemler Tutar(TL)…" başlığı ile "TOPLAM" arasında;
 *    WORLDPUAN DETAYI bölümünde de tarih+tutar satırları var → bölge sınırı ŞART.
 *  - Özet alanları YOK: YK "Dönem İçi Harcamanız"/"Toplam Faiz ve Ücretler"
 *    basmaz, bu yüzden DenizBank'ın BAŞLIK kimliği burada çalıştırılamaz. Ama
 *    devir satırı (ÖNCEKİ DÖNEM … BORCU), ödeme satırları ve TOPLAM footer'ı
 *    okunabilir → SATIR kimliği türetilebilir (bkz. checkStatementParseTotals).
 *
 * Saf metin ayrıştırma; ledger'a yazma cardsRepo/StatementImportModal işi.
 */
import { suggestExpenseCategory, type CategoryMemory } from './categories'
import { parseAmount, type ParsedStatement, type ParsedStatementAdjustment, type ParsedTransaction } from './denizBankStatementParser'
import { roundTL, sumTL } from './money'

const MONTHS: Record<string, number> = {
  Ocak: 1, Şubat: 2, Mart: 3, Nisan: 4, Mayıs: 5, Haziran: 6,
  Temmuz: 7, Ağustos: 8, Eylül: 9, Ekim: 10, Kasım: 11, Aralık: 12,
}
const MONTH_ALTERNATION = Object.keys(MONTHS).join('|')

// Satır başı işlem tarihi: "05 Mart 2026". Ay adı tam eşleşir (case-sensitive;
// PDF Title-case üretir) → tr-TR lowercase tuzağına girmeyiz.
const TX_DATE_RE = new RegExp(`^(\\d{1,2})\\s+(${MONTH_ALTERNATION})\\s+(\\d{4})\\b`)
// Herhangi bir yerde Türkçe ay-isimli tarih (başlık alanları için).
const ANY_DATE_RE = new RegExp(`(\\d{1,2})\\s+(${MONTH_ALTERNATION})\\s+(\\d{4})`)
// Türkçe para: 16.333,22 / 244,67 (binlik nokta opsiyonel, virgül ondalık).
const MONEY_RE = /\d{1,3}(?:\.\d{3})*,\d{2}/
// Alt satırdaki taksit notasyonu; apostrof düz/typografik olabilir.
const INSTALLMENT_RE = /([\d.,]+)\s*TL['’ʼ]?lik\s+işlemin\s+(\d+)\s*\/\s*(\d+)\s*taksidi/i
/**
 * GERÇEK ödeme satırı: açıklaması "ÖDEME" ile BAŞLAR ("ÖDEME-İNTERNET
 * BANKACILIĞI", "ÖDEME ŞUBE"). Eskiden satırın herhangi bir yerinde "ÖDEME"
 * aranıyordu; bu "PARAM ÖDEME KURULUŞU", "FATURA ÖDEME MERKEZİ", "… ödeme"
 * gibi GERÇEK satıcı harcamalarını da sessizce düşürüyordu. Ek güvence:
 * yalnız ALACAK (+) satırları ödeme sayılır — ödeme borcu azaltır.
 */
const PAYMENT_DESC_RE = /^ÖDEME(?:[-\s]|$)/i

function parseTurkishDate(day: string, monthName: string, year: string): string {
  const month = MONTHS[monthName]
  if (!month) return ''
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`
}

function headerDate(text: string, label: string): string {
  const re = new RegExp(`${label}[^\\n]*?${ANY_DATE_RE.source}`)
  const match = text.match(re)
  return match ? parseTurkishDate(match[1], match[2], match[3]) : ''
}

function cleanDescription(value: string): string {
  return value
    // Sondaki tek kelime şehir + ülke kodu: "ISTANBUL TR", "LONDON GBR"
    .replace(/\s+[A-ZÇĞİÖŞÜ]+\s+(TR|TUR|GBR|IRL|NLD|USA|EUR)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseYapiKrediStatement(text: string, memory?: CategoryMemory): ParsedStatement {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)

  // ── Başlık alanları ────────────────────────────────────────────────────
  let cardLastFour = ''
  const cardMatch = text.match(/Kart Numarası\s*:?\s*\d{4}\s+\d{2}\*+\s+\*+\s+(\d{4})/)
  if (cardMatch) cardLastFour = cardMatch[1]

  const statementDate = headerDate(text, 'Hesap Kesim Tarihi')
  const dueDate = headerDate(text, 'Son Ödeme Tarihi')

  let totalDebt = 0
  const totalMatch = text.match(/Dönem Borcu\s*:?\s*([\d.,]+)\s*TL/)
  if (totalMatch) totalDebt = parseAmount(totalMatch[1])

  // ── İşlemler (yalnız tablo bölgesinde) ─────────────────────────────────
  const transactions: ParsedTransaction[] = []
  const adjustments: ParsedStatementAdjustment[] = []
  // Checksum girdileri: devir borcu, ödeme satırları toplamı, TOPLAM footer'ı.
  let previousBalance: number | null = null
  let footerTotal: number | null = null
  const paymentAmounts: number[] = []
  let inTable = false
  let sawTable = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/İşlem Tarihi\s+İşlemler\s+Tutar/i.test(line)) {
      inTable = true
      sawTable = true
      continue
    }
    if (!inTable) continue
    if (/^TOPLAM\b/i.test(line)) {
      // Footer dönem borcunu işlem satırlarından BAĞIMSIZ basar → checksum
      // girdisi (ve "Dönem Borcu" başlığı okunamadıysa yedek kaynak).
      const footerMoney = line.match(MONEY_RE)
      if (footerMoney) footerTotal = parseAmount(footerMoney[0])
      inTable = false
      continue
    }

    // Devir satırı TARİH TAŞIMAZ ("ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU 0,00"), o
    // yüzden tarih kontrolünden önce ele alınır; harcama değil, checksum girdisi.
    if (/ÖNCEKİ DÖNEM/i.test(line)) {
      const prevMoney = line.match(MONEY_RE)
      if (prevMoney) previousBalance = parseAmount(prevMoney[0])
      continue
    }

    const dateMatch = line.match(TX_DATE_RE)
    if (!dateMatch) continue

    const rest = line.slice(dateMatch[0].length).trim()
    const moneyMatch = rest.match(MONEY_RE)
    if (!moneyMatch || moneyMatch.index === undefined) continue

    const amount = parseAmount(moneyMatch[0])
    if (amount <= 0) continue

    const descRaw = rest.slice(0, moneyMatch.index).trim()
    // Tutardan hemen önce '+' varsa alacak/iade (ödeme değil).
    const isCredit = descRaw.endsWith('+')
    const description = cleanDescription(descRaw.replace(/\+\s*$/, ''))
    if (!description) continue

    // Ödeme satırı harcama DEĞİL; borcu azalttığı için checksum'da ayrı durur.
    if (isCredit && PAYMENT_DESC_RE.test(description)) {
      paymentAmounts.push(amount)
      continue
    }

    const date = parseTurkishDate(dateMatch[1], dateMatch[2], dateMatch[3])
    const category = suggestExpenseCategory(description, memory) ?? 'Diğer'

    // Taksit bilgisi bir SONRAKİ satırdadır.
    let isInstallment = false
    let installmentNo = 1
    let installmentCount = 1
    let remainingDebt: number | null = null
    const instMatch = lines[i + 1]?.match(INSTALLMENT_RE)
    if (instMatch) {
      isInstallment = true
      installmentNo = Number(instMatch[2])
      installmentCount = Number(instMatch[3])
      // Alt satır gerçek PLAN TOPLAMINI basar ("146.999,00 TL'lik işlemin
      // 4/9 taksidi"). DenizBank'ın "kalan borç" semantiğine çevrilir
      // (kalan = toplam − aylık × sıra) ki aynı tutarlılık kontrolünden
      // (checkInstallmentNotation) geçsin: eşit bölünmeyen plan veya yanlış
      // okunan adet needs-review'a düşer, körlemesine aylık × adet kurulmaz.
      const planTotal = parseAmount(instMatch[1])
      if (planTotal > 0) remainingDebt = roundTL(planTotal - amount * installmentNo)
      i++ // taksit satırını tükettik
    }

    if (isCredit) {
      adjustments.push({ date, description, amount, category })
      continue
    }

    transactions.push({ date, description, amount, category, isInstallment, installmentNo, installmentCount, remainingDebt })
  }

  return {
    cardLastFour,
    statementDate,
    dueDate,
    // "Dönem Borcu" başlığı okunamadıysa TOPLAM footer'ı yedek kaynaktır.
    totalDebt: totalMatch ? totalDebt : (footerTotal ?? 0),
    transactions,
    adjustments,
    // Devir okunabildiyse SATIR kimliği çalışır:
    //   Dönem Borcu = Önceki − Ödemeler + (Σ harcama − Σ iade)
    // periodSpending/feesAndInterest YK ekstresinde YOK → null bırakılır
    // (başlık kimliği körlemesine "tutarlı" görünmesin).
    previousBalance,
    // Tablo bölgesi hiç bulunamadıysa "ödeme yok" DEMEK DEĞİL → null.
    payments: sawTable ? sumTL(paymentAmounts) : null,
    periodSpending: null,
    feesAndInterest: null,
  }
}
