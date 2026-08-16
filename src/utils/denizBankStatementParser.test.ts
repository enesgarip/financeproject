import { describe, expect, it } from 'vitest'
import { checkStatementParseTotals, parseAmount, parseDenizBankStatement } from './denizBankStatementParser'
import { checkInstallmentNotation } from './importedInstallmentPlan'

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

  it('extracts summary header fields for the parse checksum', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    expect(result.previousBalance).toBeCloseTo(65693.72)
    expect(result.payments).toBeCloseTo(65693.72)
    expect(result.periodSpending).toBeCloseTo(82182.51)
    expect(result.feesAndInterest).toBeCloseTo(471)
  })
})

// Küçük ama KENDİ İÇİNDE tutarlı ekstre (gerçek veriden kalibre edilen iki kimlik
// de sağlanır): başlık 100−100+210+20=230; satır Σ(300)−iade(70)=230=210+20.
const CONSISTENT_TEXT = `
Hesap Kesim Tarihi 04/06/2026
Son Ödeme Tarihi 15/06/2026
Dönem Borcu 230.00 TL
Önceki Hesap Bakiyeniz 100.00 TL
Ödemeler 100.00 TL
Dönem İçi Harcamanız 210.00 TL
Toplam Faiz ve Ücretler 20.00 TL
01/06/2026 MARKET A BURSA TR 200.00 TL
02/06/2026 KAHVE B BURSA TR 80.00 TL
03/06/2026 Nakit Faiz İSTANBUL MBL 20.00 TL
04/06/2026 IADE B BURSA TR 70.00+ TL
`

describe('checkStatementParseTotals', () => {
  it('reports both identities consistent on a self-consistent statement', () => {
    const result = checkStatementParseTotals(parseDenizBankStatement(CONSISTENT_TEXT))
    expect(result.header).toMatchObject({ checked: true, consistent: true })
    expect(result.lines).toMatchObject({ checked: true, consistent: true })
    expect(result.header.residualTL).toBeCloseTo(0)
    expect(result.lines.residualTL).toBeCloseTo(0)
  })

  it('header identity holds even on the (line-truncated) sample fixture', () => {
    // SAMPLE_TEXT başlık alanları gerçek ekstreden alınmış → başlık tutarlı.
    const result = checkStatementParseTotals(parseDenizBankStatement(SAMPLE_TEXT))
    expect(result.header).toMatchObject({ checked: true, consistent: true })
  })

  it('line checksum flags a statement whose transaction lines are incomplete', () => {
    // SAMPLE_TEXT yalnız işlemlerin bir alt kümesini içerir → satır toplamı
    // Dönem İçi + Faiz'i tutmaz. Parser bir satırı DÜŞÜRDÜĞÜNDE olan tam budur.
    const result = checkStatementParseTotals(parseDenizBankStatement(SAMPLE_TEXT))
    expect(result.lines.checked).toBe(true)
    expect(result.lines.consistent).toBe(false)
    expect(Math.abs(result.lines.residualTL)).toBeGreaterThan(1)
  })

  it('skips checks (checked=false) when summary fields are absent', () => {
    const result = checkStatementParseTotals({
      cardLastFour: '',
      statementDate: '',
      dueDate: '',
      totalDebt: 500,
      transactions: [],
    })
    expect(result.header.checked).toBe(false)
    expect(result.lines.checked).toBe(false)
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

  it('nakit avans bölümündeki satırları Finansman kategorisine yazar', () => {
    // Anapara + faiz/BSMV/KKDF aynı bölümden gelir ve hepsi tüketim değil
    // finansman maliyetidir; eskiden hepsi Diğer'e düşüyordu.
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const nakit = result.transactions.find((t) => t.description.toLowerCase().includes('nakit'))
    const faiz = result.transactions.find((t) => /faiz/i.test(t.description))
    expect(nakit?.category).toBe('Finansman')
    expect(faiz?.category).toBe('Finansman')
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

  it('assigns Yeme & İçme category to cafe transactions', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const cafe = result.transactions.find((t) => t.description.includes('CAFE LİFE'))
    expect(cafe?.category).toBe('Yeme & İçme')
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

  it('captures remaining debt from the notation (X in <X>/<count>-<no>)', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const beyler = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))
    expect(beyler?.remainingDebt).toBeCloseTo(43333.33)

    const neova = result.transactions.find(
      (t) => t.description.includes('NEOVA') && t.installmentCount === 9,
    )
    expect(neova?.remainingDebt).toBeCloseTo(12033.65)
  })

  it('leaves remainingDebt null when notation is absent', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const nakit = result.transactions.find((t) => t.description.toLowerCase().includes('nakit'))
    expect(nakit?.remainingDebt).toBeNull()
    const cafe = result.transactions.find((t) => t.description.includes('CAFE LİFE'))
    expect(cafe?.remainingDebt).toBeNull()
  })

  it('remaining-debt notation reconciles with monthly × remaining-count', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    // BEYLER 1.Tk: kalan (43.333,33) ≈ aylık (21.666,67) × (3 − 1)
    const beyler = result.transactions.find((t) => t.description.includes('BEYLER OPTİK'))!
    const check = checkInstallmentNotation({
      installmentAmount: beyler.amount,
      installmentNo: beyler.installmentNo,
      totalInstallments: beyler.installmentCount,
      remainingDebt: beyler.remainingDebt!,
    })
    expect(check.consistent).toBe(true)
  })

  it('falls back to "N.Tk" for installment number when notation is absent', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const nakit = result.transactions.find((t) => t.description.toLowerCase().includes('nakit'))
    expect(nakit?.isInstallment).toBe(true)
    expect(nakit?.installmentNo).toBe(3)
    expect(nakit?.installmentCount).toBe(0) // toplam bilinmiyor
  })

  it('marks regular transactions as non-installment with count 1', () => {
    const result = parseDenizBankStatement(SAMPLE_TEXT)
    const cafe = result.transactions.find((t) => t.description.includes('CAFE LİFE'))
    expect(cafe?.isInstallment).toBe(false)
    expect(cafe?.installmentCount).toBe(1)
    expect(cafe?.installmentNo).toBe(1)
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

describe('parseDenizBankStatement — bonus temizliği ve bölüm başlığı', () => {
  // Faz F: bonus kolonu binlik ayraçlı olabilir ("1,996.00"); eski regex
  // (`\d+[.,]\d{2}$`) yalnız ayraçsızını yakalıyordu → satıcı adı kirleniyordu.
  const BONUS_TEXT = `
Hesap Kesim Tarihi 04/06/2026
Son Ödeme Tarihi 15/06/2026
Dönem Borcu 201,596.00 TL
01/06/2026 BALAT GUSTO PLUS MARKET BURSA TR 1,996.00 199,600.00 TL
02/06/2026 FILE MARKET BURSA TR 19.96 1,996.00 TL
`

  it('binlik ayraçlı bonusu açıklamada bırakmaz', () => {
    const result = parseDenizBankStatement(BONUS_TEXT)
    const balat = result.transactions.find((t) => t.amount === 199600)
    expect(balat?.description).toBe('BALAT GUSTO PLUS MARKET')
  })

  it('ayraçsız bonusu da (eski davranış) temizlemeye devam eder', () => {
    const result = parseDenizBankStatement(BONUS_TEXT)
    const file = result.transactions.find((t) => t.amount === 1996)
    expect(file?.description).toBe('FILE MARKET')
  })

  // Faz F: `line.toUpperCase()` tr-TR'de "Sigorta" → "SIGORTA" üretiyor ve
  // "SİGORTA" anahtarını kaçırıyordu (CLAUDE.md I/İ tuzağı). Gözlemlenebilir
  // etki: tanınmayan başlık ÖNCEKİ bölümün kategorisini sıfırlamaz, bu yüzden
  // sigorta satırı "Sağlık" olarak damgalanır.
  const SECTION_TEXT = `
Hesap Kesim Tarihi 04/06/2026
Son Ödeme Tarihi 15/06/2026
Dönem Borcu 620.00 TL
Eczane
01/06/2026 XYZ ANONIM SATIS BURSA TR 120.00 TL
Sigorta
02/06/2026 QWE ANONIM POLICE BURSA TR 500.00 TL
`

  it('BÜYÜK harf olmayan bölüm başlığını da tanır (I/İ katlaması)', () => {
    const result = parseDenizBankStatement(SECTION_TEXT)
    expect(result.transactions.find((t) => t.amount === 120)?.category).toBe('Sağlık')
    // "Sigorta" tanınmazsa bu satır önceki bölümden 'Sağlık' devralırdı.
    expect(result.transactions.find((t) => t.amount === 500)?.category).toBe('Diğer')
  })

  it('BÜYÜK harfli başlıkta eski davranışı korur', () => {
    const result = parseDenizBankStatement(SECTION_TEXT.replace('Eczane', 'ECZANE').replace('Sigorta', 'SİGORTA'))
    expect(result.transactions.find((t) => t.amount === 120)?.category).toBe('Sağlık')
    expect(result.transactions.find((t) => t.amount === 500)?.category).toBe('Diğer')
  })
})
