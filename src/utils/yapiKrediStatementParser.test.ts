import { describe, expect, it } from 'vitest'
import { parseYapiKrediStatement } from './yapiKrediStatementParser'
import { checkStatementParseTotals } from './denizBankStatementParser'
import { checkInstallmentNotation } from './importedInstallmentPlan'
import { roundTL } from './money'

// Gerçek YapıKredi ekstresinden türetilmiş, kişisel alanları (isim/adres)
// çıkarılmış temsili metin. Kart numarası zaten maskeli. WORLDPUAN DETAYI bölümü
// bilerek dahil: tarih+tutar taşıyan puan satırlarının bölge sınırıyla elendiğini
// doğrular.
const YK_STATEMENT = `HESAP BİLGİLERİ
Hesap Kesim Tarihi : 13 Temmuz 2026
Son Ödeme Tarihi : 23 Temmuz 2026
Dönem Borcu : 0,00 TL
Kart Numarası : 4506 34** **** 7735
İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan
ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU 0,00
01 Temmuz 2026 ÖDEME-İNTERNET BANKACILIĞI +20.413,19
05 Mart 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR 16.333,22 65.332,88 / 4
146.999,00 TL'lik işlemin 5 / 9 taksidi
23 Mart 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR 3.537,11 17.685,55 / 5
31.834,00 TL'lik işlemin 4 / 9 taksidi
01 Mayıs 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR 244,67
734,00 TL'lik işlemin 3 / 3 taksidi
27 Haziran 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR 298,19 596,40 / 2 18
894,59 TL'lik işlemin 1 / 3 taksidi
TOPLAM 0,00 18
WORLDPUAN DETAYI
İşlem Tarihi İşlem Türü Worldpuan TL Karşılığı Son Kullanım Tarihi
27 Haziran 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR -3.624 -18,12 TL`

describe('parseYapiKrediStatement', () => {
  const parsed = parseYapiKrediStatement(YK_STATEMENT)

  it('başlık alanlarını (Türkçe ay-isimli tarih dahil) okur', () => {
    expect(parsed.statementDate).toBe('2026-07-13')
    expect(parsed.dueDate).toBe('2026-07-23')
    expect(parsed.totalDebt).toBe(0)
    expect(parsed.cardLastFour).toBe('7735')
  })

  it('yalnız gerçek harcamaları çıkarır; ödeme/önceki-dönem/puan satırlarını eler', () => {
    // 4 taksitli harcama; ÖDEME, ÖNCEKİ DÖNEM ve TOPLAM sonrası WORLDPUAN satırı HARİÇ.
    expect(parsed.transactions).toHaveLength(4)
    expect(parsed.adjustments ?? []).toHaveLength(0)
  })

  it('WORLDPUAN bölgesindeki tarih+tutar satırını harcama sanmaz', () => {
    // Bölge sınırı olmasa 27 Haziran -18,12 satırı sahte harcama olurdu.
    expect(parsed.transactions.some((t) => Math.abs(t.amount - 18.12) < 0.001)).toBe(false)
  })

  it('taksit bilgisini ALT satırdan doğru okur (aylık tutar + kaçıncı/toplam)', () => {
    const first = parsed.transactions[0]
    expect(first.date).toBe('2026-03-05')
    expect(first.description).toContain('HEPSIBURADA')
    expect(first.amount).toBe(16333.22)
    expect(first.isInstallment).toBe(true)
    expect(first.installmentNo).toBe(5)
    expect(first.installmentCount).toBe(9)
    // amount AYLIK taksit tutarıdır (DenizBank ile aynı semantik). Aylık × adet
    // ekstredeki toplama (146.999,00) ~0,02 kuruş yuvarlamayla yaklaşır
    // (16333,22 × 9 = 146998,98); bu fark mutabakat kilidinde kapanır.
    expect(roundTL(first.amount * first.installmentCount)).toBe(146998.98)
  })

  it('son taksit satırını (3/3) doğru işaretler', () => {
    const last3 = parsed.transactions.find((t) => t.amount === 244.67)
    expect(last3?.installmentNo).toBe(3)
    expect(last3?.installmentCount).toBe(3)
  })

  it('açıklamadan şehir+ülke kodunu temizler', () => {
    expect(parsed.transactions.every((t) => !/ISTANBUL TR$/.test(t.description))).toBe(true)
  })

  // O2: alt satırdaki gerçek plan toplamı "kalan borç"a çevrilir
  // (kalan = toplam − aylık × sıra) → DenizBank'la aynı tutarlılık kontrolü.
  it('plan toplamını kalan borca çevirir ve gerçek ekstrede tutarlılık kontrolü geçer', () => {
    const first = parsed.transactions[0]
    // 146.999,00 − 16.333,22 × 5 = 65.332,90 (banka satırı 65.332,88 basar;
    // 2 kuruş yuvarlama farkı toleransın çok içindedir).
    expect(first.remainingDebt).toBe(65332.9)

    const check = checkInstallmentNotation({
      installmentAmount: first.amount,
      installmentNo: first.installmentNo,
      totalInstallments: first.installmentCount,
      remainingDebt: first.remainingDebt ?? 0,
    })
    expect(check.consistent).toBe(true)
  })

  it('yanlış okunan taksit adedi tutarlılık kontrolünde yakalanır', () => {
    const first = parsed.transactions[0]
    // Adet 9 yerine 12 okunsaydı fark bir aylık tutarın katları olurdu → tutarsız.
    const check = checkInstallmentNotation({
      installmentAmount: first.amount,
      installmentNo: first.installmentNo,
      totalInstallments: 12,
      remainingDebt: first.remainingDebt ?? 0,
    })
    expect(check.consistent).toBe(false)
  })
})

describe('parseYapiKrediStatement — tek çekim, iade ve dolu dönem borcu', () => {
  const text = `Hesap Kesim Tarihi : 14 Haziran 2026
Son Ödeme Tarihi : 24 Haziran 2026
Dönem Borcu : 1.234,56 TL
Kart Numarası : 4506 34** **** 7735
İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan
10 Nisan 2026 MIGROS BURSA TR 150,00
12 Nisan 2026 IADE MAGAZASI +50,00
TOPLAM 1.234,56 0`

  const parsed = parseYapiKrediStatement(text)

  it('dolu dönem borcunu Türkçe sayı formatından çözer', () => {
    expect(parsed.totalDebt).toBe(1234.56)
  })

  it('tek çekim harcamayı taksitsiz kaydeder', () => {
    const migros = parsed.transactions.find((t) => t.description === 'MIGROS')
    expect(migros).toBeDefined()
    expect(migros?.isInstallment).toBe(false)
    expect(migros?.installmentCount).toBe(1)
    expect(migros?.amount).toBe(150)
  })

  it('+ tutarlı satırı iade/alacak olarak ayırır', () => {
    expect(parsed.transactions.some((t) => t.description === 'IADE MAGAZASI')).toBe(false)
    expect(parsed.adjustments).toHaveLength(1)
    expect(parsed.adjustments?.[0]).toMatchObject({ description: 'IADE MAGAZASI', amount: 50 })
  })
})

describe('parseYapiKrediStatement — ödeme filtresi (Faz F)', () => {
  // Eski filtre satırın HERHANGİ bir yerinde "ÖDEME" arıyordu: "PARAM ÖDEME
  // KURULUŞU" gibi gerçek satıcılar sessizce düşüyordu. Yeni kural: açıklama
  // "ÖDEME" ile BAŞLAYACAK ve satır ALACAK (+) olacak.
  const text = `Hesap Kesim Tarihi : 13 Temmuz 2026
Son Ödeme Tarihi : 23 Temmuz 2026
Dönem Borcu : 1.500,00 TL
Kart Numarası : 4506 34** **** 7735
İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan
ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU 0,00
01 Temmuz 2026 ÖDEME-İNTERNET BANKACILIĞI +2.000,00
02 Temmuz 2026 PARAM ÖDEME KURULUŞU ISTANBUL TR 900,00
03 Temmuz 2026 FATURA ÖDEME MERKEZİ ISTANBUL TR 600,00
04 Temmuz 2026 TURKCELL 5437616572 ödeme ISTANBUL TR 2.000,00
TOPLAM 1.500,00 0`

  const parsed = parseYapiKrediStatement(text)

  it('içinde "ÖDEME" geçen gerçek satıcı harcamalarını İÇERİDE tutar', () => {
    const descriptions = parsed.transactions.map((t) => t.description)
    expect(descriptions).toContain('PARAM ÖDEME KURULUŞU')
    expect(descriptions).toContain('FATURA ÖDEME MERKEZİ')
    expect(descriptions.some((d) => d.startsWith('TURKCELL'))).toBe(true)
    expect(parsed.transactions).toHaveLength(3)
  })

  it('gerçek ödeme satırını DIŞARIDA bırakır ve ödemeler toplamına yazar', () => {
    expect(parsed.transactions.some((t) => t.description.startsWith('ÖDEME'))).toBe(false)
    expect(parsed.adjustments ?? []).toHaveLength(0)
    expect(parsed.payments).toBe(2000)
    expect(parsed.previousBalance).toBe(0)
  })
})

describe('parseYapiKrediStatement — satır toplamı checksum kimliği (Faz F)', () => {
  // Kimlik: Dönem Borcu = Önceki − Ödemeler + (Σ harcama − Σ iade).
  // YK "Dönem İçi Harcamanız" basmadığı için BAŞLIK kimliği çalışmaz; satır
  // kimliği devir + ödeme satırları + TOPLAM footer'ından türetilir.
  const header = `Hesap Kesim Tarihi : 13 Temmuz 2026
Son Ödeme Tarihi : 23 Temmuz 2026
Dönem Borcu : 1.000,00 TL
Kart Numarası : 4506 34** **** 7735
İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan
ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU 500,00`

  const consistent = `${header}
01 Temmuz 2026 ÖDEME-İNTERNET BANKACILIĞI +500,00
02 Temmuz 2026 MIGROS BURSA TR 1.100,00
03 Temmuz 2026 IADE MAGAZASI BURSA TR +100,00
TOPLAM 1.000,00 0`

  it('tutarlı ekstrede satır kimliği çalışır ve residual 0 olur', () => {
    const totals = checkStatementParseTotals(parseYapiKrediStatement(consistent))
    expect(totals.lines.checked).toBe(true)
    expect(totals.lines.consistent).toBe(true)
    expect(totals.lines.residualTL).toBeCloseTo(0)
  })

  it('YK ekstresinde başlık kimliği körlemesine "tutarlı" demez', () => {
    // periodSpending/feesAndInterest YK'da YOK → checked=false (uydurma yeşil yok).
    const totals = checkStatementParseTotals(parseYapiKrediStatement(consistent))
    expect(totals.header.checked).toBe(false)
  })

  it('düşen bir işlem satırı ≫1 TL residual üretir', () => {
    // MIGROS satırı hiç okunmamış gibi: TOPLAM footer'ı hâlâ 1.000,00 basıyor.
    const dropped = `${header}
01 Temmuz 2026 ÖDEME-İNTERNET BANKACILIĞI +500,00
03 Temmuz 2026 IADE MAGAZASI BURSA TR +100,00
TOPLAM 1.000,00 0`
    const totals = checkStatementParseTotals(parseYapiKrediStatement(dropped))
    expect(totals.lines.checked).toBe(true)
    expect(totals.lines.consistent).toBe(false)
    expect(Math.abs(totals.lines.residualTL)).toBeGreaterThan(1)
  })

  it('gerçek ekstreden türetilmiş örnekte de kimlik tutar', () => {
    // YK_STATEMENT: devir 0, ödeme 20.413,19, 4 taksit satırı toplamı 20.413,19,
    // dönem borcu 0 → residual 0. Satırlardan biri düşse residual patlar.
    const totals = checkStatementParseTotals(parseYapiKrediStatement(YK_STATEMENT))
    expect(totals.lines.checked).toBe(true)
    expect(totals.lines.consistent).toBe(true)
  })

  it('devir satırı okunamazsa checksum körlemesine geçmez', () => {
    const noOpening = `Hesap Kesim Tarihi : 13 Temmuz 2026
Son Ödeme Tarihi : 23 Temmuz 2026
Dönem Borcu : 150,00 TL
İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan
10 Nisan 2026 MIGROS BURSA TR 150,00
TOPLAM 150,00 0`
    const totals = checkStatementParseTotals(parseYapiKrediStatement(noOpening))
    expect(totals.lines.checked).toBe(false)
    expect(totals.header.checked).toBe(false)
  })
})
