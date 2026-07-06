import { describe, expect, it } from 'vitest'
import { expenseTotalAmount, matchTransactions, parseAmount, parseDenizBankStatement } from './denizBankStatementParser'

describe('parseAmount (locale-robust)', () => {
  it('parses English-formatted statement amounts', () => {
    expect(parseAmount('43,333.33')).toBeCloseTo(43333.33)
    expect(parseAmount('100.00')).toBeCloseTo(100)
    expect(parseAmount('484,000.00')).toBeCloseTo(484000)
  })

  it('does not silently corrupt a Turkish-formatted amount', () => {
    // old code: "1.234,56".replace(/,/g,'') → "1.234.56" → parseFloat → 1.234
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56)
    expect(parseAmount('100,00')).toBeCloseTo(100)
  })

  it('returns 0 for unparseable input', () => {
    expect(parseAmount('abc')).toBe(0)
  })
})

// Realistic Denizbank PDF text fixture (based on actual statement format)
const SAMPLE_TEXT = `
Sayfa Numarası 1 / 4
Sayın TEST KULLANICI
HESAP / KART BİLGİLERİ
Müşteri Numarası 4230-13300128
Kart Numarası 5555 74** **** 0189
Kart Limiti 484,000.00
Hesap Kesim Tarihi 04/06/2026
Ekstre Dönemi 04/05/2026-04/06/2026
Son Ödeme Tarihi 15/06/2026
Dönem Borcu 82,653.51 TL
Önceki Hesap Bakiyeniz 65,693.72 TL
Toplam Faiz ve Ücretler 471.00 TL
Dönem İçi Harcamanız 82,182.51 TL
Ödemeler 65,693.72 TL

İşlem Tarihi Dönemiçi İşlemler Kalan Borç / Taksit Bonus(TL) İşlem Tutarı
 ÖNCEKİ DÖNEM EKSTRE BORCU 65,693.72 TL
05/05/2026 Hesaptan Ödeme 65,693.72+ TL
BONUS PROGRAM ORTAKLARINDA YAPTIĞINIZ HARCAMALAR
14/05/2026 BALAT GUSTO PLUS MARKET BURSA TR 19.96 1,996.00 TL
19/05/2026 BEYLER OPTİK Peş. Taksit 1.Tk Anapara 43,333.33/3-1 195.00 21,666.67 TL
26/03/2026 NEOVA SİGORTA Peş. Taksit 3.Tk Anapara 12,033.65/9-3 2,005.61 TL
26/03/2026 NEOVA SİGORTA Peş. Taksit 3.Tk Anapara 4,542.76 TL
16/05/2026 FİLE MARKET MAĞAZACILIK A BURSA TR 356.47 TL
03/06/2026 KAHVE DÜNYASI KENT MEYDAN Bursa TR 400.64 TL
02/06/2026 TURKCELL 5437616572 ödeme İSTANBUL TR 526.90 TL
01/06/2026 Kaptanın Görevi Bonus 15.00 0.00 TL
BONUS PROGRAM ORTAKLARI DIŞINDA YAPTIĞINIZ HARCAMALAR
AKARYAKIT
31/05/2026 BUPET BURSA OPET BURSA TR 2,000.71 TL
05/05/2026 YILMAR PETROL OPET BURSA TR 900.00 TL
CAFE & RESTAURANT
03/06/2026 CAFE LİFE BURSA TR 170.00 TL
27/05/2026 PETROV CAFE BURSA TR 1,485.00 TL
MARKET & SUPERMARKET
03/06/2026 AQUA ENDÜSTRIYEL TEMIZLIK BURSA TR 260.00 TL
ECZANE
01/06/2026 DEFNE ECZANESİ BURSA TR 245.74 TL
DİĞER İŞLEM VE HARCAMALARINIZ
03/06/2026 ÖDEAL//PETPAL BURSA TR 2,481.00 TL
15/06/2026 IYZICO/ATOLYE.BURSA.COM BURSA TR 2,500.00+ TL
NAKİT AVANS BİLGİLERİ
01/04/2026 Taksit. Nakit İSTANBUL MBL 3.Tk Anapara 8,524.62 TL
01/04/2026 Taksit. Nakit İSTANBUL MBL 3.Tk Faiz 362.30 TL
01/04/2026 Taksit. Nakit İSTANBUL MBL 3.Tk BSMV 54.35 TL
01/04/2026 Taksit. Nakit İSTANBUL MBL 3.Tk KKDF 54.35 TL
Ara Toplam 78,193.06 TL

Sayfa Numarası 3 / 4
İşlem Tarihi Dönemiçi İşlemler Kalan Borç / Taksit Bonus(TL) İşlem Tutarı
 EK KART NO :5203 03** **** 9032
BONUS PROGRAM ORTAKLARINDA YAPTIĞINIZ HARCAMALAR
03/06/2026 HEPSİPAY-HEP/HEPSİBURADA İSTANBUL TR 228.90 0.00 TL
DİĞER İŞLEM VE HARCAMALARINIZ
03/06/2026 APPLE.COM/BILL CORK IRL 799.99 TL
17/05/2026 GOOGLE *YouTube LONDON GBR 159.99 TL
Toplam 82,653.51 TL
`

describe('parseDenizBankStatement — header', () => {
  it('extracts card last four digits', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    expect(result.cardLastFour).toBe('0189')
  })

  it('extracts statement date', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    expect(result.statementDate).toBe('2026-06-04')
  })

  it('extracts due date', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    expect(result.dueDate).toBe('2026-06-15')
  })

  it('extracts total debt', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    expect(result.totalDebt).toBeCloseTo(82653.51)
  })
})

describe('parseDenizBankStatement — transaction filtering', () => {
  it('skips payment lines (Hesaptan Ödeme)', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const hasPayment = result.transactions.some((t) => t.description.includes('Hesaptan Ödeme'))
    expect(hasPayment).toBe(false)
  })

  it('captures non-payment plus rows as statement adjustments', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)

    expect(result.adjustments).toEqual([
      expect.objectContaining({
        date: '2026-06-15',
        description: 'IYZICO/ATOLYE.BURSA.COM',
        amount: 2500,
      }),
    ])
    expect(result.transactions.some((t) => t.description.includes('ATOLYE'))).toBe(false)
  })

  it('skips zero-amount bonus entries', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const hasZero = result.transactions.some((t) => t.amount === 0)
    expect(hasZero).toBe(false)
  })

  it('includes nakit avans faiz/BSMV/KKDF lines (Dönem Borcu kapsamında)', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const faiz = result.transactions.find((t) => /faiz/i.test(t.description))
    const bsmv = result.transactions.find((t) => /bsmv/i.test(t.description))
    const kkdf = result.transactions.find((t) => /kkdf/i.test(t.description))
    expect(faiz?.amount).toBeCloseTo(362.30)
    expect(bsmv?.amount).toBeCloseTo(54.35)
    expect(kkdf?.amount).toBeCloseTo(54.35)
  })

  it('includes nakit avans anapara as a transaction', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const nakit = result.transactions.find((t) => t.description.toLowerCase().includes('nakit'))
    expect(nakit).toBeDefined()
    expect(nakit?.amount).toBeCloseTo(8524.62)
  })
})

describe('parseDenizBankStatement — regular transactions', () => {
  it('parses date correctly (DD/MM/YYYY → YYYY-MM-DD)', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const market = result.transactions.find((t) => t.description.includes('BALAT GUSTO'))
    expect(market?.date).toBe('2026-05-14')
  })

  it('parses amount correctly', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const market = result.transactions.find((t) => t.description.includes('BALAT GUSTO'))
    expect(market?.amount).toBeCloseTo(1996.00)
  })

  it('removes trailing city/country from description', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const market = result.transactions.find((t) => t.description.includes('BALAT GUSTO'))
    expect(market?.description).not.toMatch(/\bBURSA\b/)
    expect(market?.description).not.toMatch(/\bTR\b/)
  })

  it('assigns Ulaşım category to petrol stations', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const petrol = result.transactions.find((t) => t.description.includes('BUPET'))
    expect(petrol?.category).toBe('Ulaşım')
  })

  it('assigns Yemek category to cafe transactions', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const cafe = result.transactions.find((t) => t.description.includes('CAFE LİFE'))
    expect(cafe?.category).toBe('Yemek')
  })

  it('assigns Sağlık category to eczane', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const eczane = result.transactions.find((t) => t.description.includes('DEFNE'))
    expect(eczane?.category).toBe('Sağlık')
  })
})

describe('parseDenizBankStatement — installments', () => {
  it('marks installment transactions', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const taksit = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))
    expect(taksit?.isInstallment).toBe(true)
  })

  it('does not mis-categorise instalment rows as Ulaşım ("taksit" must not match "taksi")', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    for (const tx of result.transactions.filter((t) => t.isInstallment)) {
      expect(tx.category, `${tx.description} should not be Ulaşım`).not.toBe('Ulaşım')
    }
  })

  it('extracts correct installment amount (not total)', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const taksit = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))
    expect(taksit?.amount).toBeCloseTo(21666.67)
  })

  it('extracts installment count and number from "/count-no" notation', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const beyler = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))
    expect(beyler?.installmentCount).toBe(3)
    expect(beyler?.installmentNo).toBe(1)

    const neova = result.transactions.find(
      (t) => t.description.includes('NEOVA') && t.installmentCount === 9,
    )
    expect(neova?.installmentCount).toBe(9)
    expect(neova?.installmentNo).toBe(3)
  })

  it('falls back to "N.Tk" for installment number when notation is absent', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const nakit = result.transactions.find((t) => t.description.toLowerCase().includes('nakit'))
    expect(nakit?.isInstallment).toBe(true)
    expect(nakit?.installmentNo).toBe(3)
    expect(nakit?.installmentCount).toBe(0) // toplam bilinmiyor
  })

  it('reconstructs total amount from monthly installment × count', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const beyler = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))!
    expect(expenseTotalAmount(beyler)).toBeCloseTo(65000.01)
  })

  it('marks regular transactions as non-installment with count 1', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const cafe = result.transactions.find((t) => t.description.includes('CAFE LİFE'))
    expect(cafe?.isInstallment).toBe(false)
    expect(cafe?.installmentCount).toBe(1)
    expect(cafe?.installmentNo).toBe(1)
    expect(expenseTotalAmount(cafe!)).toBeCloseTo(170)
  })
})

describe('parseDenizBankStatement — additional card', () => {
  it('includes additional card transactions', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const apple = result.transactions.find((t) => t.description.includes('APPLE'))
    expect(apple).toBeDefined()
    expect(apple?.amount).toBeCloseTo(799.99)
  })

  it('skips zero-amount hepsiburada bonus on additional card', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const hepsi = result.transactions.find((t) => t.description.includes('HEPSİPAY'))
    expect(hepsi).toBeUndefined()
  })
})

describe('matchTransactions', () => {
  const tx = (date: string, amount: number) => ({
    date,
    description: 'Test',
    amount,
    category: 'Diğer',
    isInstallment: false,
    installmentNo: 1,
    installmentCount: 1,
  })

  const installmentTx = (date: string, monthly: number, count: number, no: number) => ({
    date,
    description: 'Taksit',
    amount: monthly,
    category: 'Diğer',
    isInstallment: true,
    installmentNo: no,
    installmentCount: count,
  })

  const exp = (spent_at: string, amount: number, status = 'posted', description = 'App kaydı') => ({
    spent_at,
    amount,
    status,
    description,
  })

  it('matches by same date and amount', () => {
    const result = matchTransactions([tx('2026-06-03', 170)], [exp('2026-06-03', 170)])
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('reports unmatched when no existing expense', () => {
    const result = matchTransactions([tx('2026-06-03', 170)], [])
    expect(result.unmatched).toHaveLength(1)
  })

  it('does not double-match the same expense', () => {
    const result = matchTransactions(
      [tx('2026-06-03', 170), tx('2026-06-03', 170)],
      [exp('2026-06-03', 170)],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(1)
  })

  it('ignores cancelled expenses when matching', () => {
    const result = matchTransactions([tx('2026-06-03', 170)], [exp('2026-06-03', 170, 'cancelled')])
    expect(result.unmatched).toHaveLength(1)
  })

  it('tolerates a 1 TL amount difference', () => {
    const result = matchTransactions([tx('2026-06-03', 170.00)], [exp('2026-06-03', 170.95)])
    expect(result.matched).toHaveLength(1)
    expect(result.matches[0]?.expense.description).toBe('App kaydı')
  })

  it('does not match amount differences above 1 TL', () => {
    const result = matchTransactions([tx('2026-06-03', 170.00)], [exp('2026-06-03', 171.01)])
    expect(result.unmatched).toHaveLength(1)
  })

  it('matches the same amount inside a short date window', () => {
    const result = matchTransactions([tx('2026-06-03', 170)], [exp('2026-06-04', 170)])
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('matches payment-created expenses by the due date stored in note', () => {
    const result = matchTransactions(
      [tx('2026-06-03', 170)],
      [{
        spent_at: '2026-06-20',
        amount: 170,
        status: 'posted',
        description: 'Internet faturasi',
        note: 'Odeme kaydindan olusturuldu. Vade: 2026-06-03',
      }],
    )

    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not match dates outside the import date window', () => {
    const result = matchTransactions([tx('2026-06-03', 170)], [exp('2026-06-10', 170)])
    expect(result.unmatched).toHaveLength(1)
  })

  it('matches an installment line against the expense stored at its TOTAL amount', () => {
    // Ekstrede aylık 21.666,67 görünür; app harcamayı toplam 65.000 ile saklar.
    const result = matchTransactions(
      [installmentTx('2026-05-19', 21666.67, 3, 1)],
      [exp('2026-05-19', 65000)],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('matches an installment total inside the short date window', () => {
    const result = matchTransactions(
      [installmentTx('2026-05-19', 21666.67, 3, 1)],
      [exp('2026-05-21', 65000)],
    )
    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('reports an unrecorded installment as unmatched', () => {
    const result = matchTransactions([installmentTx('2026-05-19', 21666.67, 3, 1)], [])
    expect(result.unmatched).toHaveLength(1)
  })

  it('does not match an installment against its monthly amount alone', () => {
    // Aylık tutar (21.666,67) tek başına harcama olarak kayıtlıysa eşleşmemeli.
    const result = matchTransactions(
      [installmentTx('2026-05-19', 21666.67, 3, 1)],
      [exp('2026-05-19', 21666.67)],
    )
    expect(result.unmatched).toHaveLength(1)
  })
})
