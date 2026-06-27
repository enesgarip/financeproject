import { describe, expect, it } from 'vitest'
import {
  inferCategory,
  normalizeSmsWhitespace,
  parseDenizbankAccountSms,
  parseDenizbankCardSms,
  parseSms,
  parseYapikrediCardSms,
} from './smsParser'

// -- Whitespace normalization -------------------------------------------------

describe('normalizeSmsWhitespace', () => {
  it('satır sonlarını tek boşluğa çevirir', () => {
    expect(normalizeSmsWhitespace('satir1\nsatir2\r\nsatir3')).toBe('satir1 satir2 satir3')
  })

  it('çoklu boşlukları tek boşluğa indirger', () => {
    expect(normalizeSmsWhitespace('a   b  c')).toBe('a b c')
  })

  it('baş/son boşlukları temizler', () => {
    expect(normalizeSmsWhitespace('  merhaba  ')).toBe('merhaba')
  })
})

// -- DenizBank kart SMS'leri --------------------------------------------------

describe('parseDenizbankCardSms', () => {
  const SAMPLE = 'Degerli Musterimiz, 23.06.2026 15:18:21 tarihinde 9032 ile biten kartinizla, FINDEKS FINANSAL YONETI firmasindan, 200 TL islem yapilmistir.'

  it('standart DenizBank kart SMS parse eder', () => {
    const result = parseDenizbankCardSms(SAMPLE)
    expect(result).toEqual({
      type: 'card',
      spentAt: '2026-06-23T15:18:21',
      lastFour: '9032',
      merchant: 'FINDEKS FINANSAL YONETI',
      amount: 200,
    })
  })

  it('satır sonu içeren SMS parse eder', () => {
    const withNewlines = 'Degerli Musterimiz,\n23.06.2026 15:18:21 tarihinde\n9032 ile biten kartinizla,\nFINDEKS FINANSAL YONETI firmasindan,\n200 TL islem yapilmistir.'
    const result = parseDenizbankCardSms(withNewlines)
    expect(result).not.toBeNull()
    expect(result!.lastFour).toBe('9032')
    expect(result!.amount).toBe(200)
  })

  it('\\r\\n satır sonlarını da işler', () => {
    const withCrLf = 'Degerli Musterimiz,\r\n23.06.2026 15:18:21 tarihinde 9032 ile biten kartinizla, MIGROS firmasindan, 1.234,56 TL islem yapilmistir.'
    const result = parseDenizbankCardSms(withCrLf)
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(1234.56)
    expect(result!.merchant).toBe('MIGROS')
  })

  it('binlik ayırıcılı tutarı doğru parse eder (1.234,56)', () => {
    const sms = 'Degerli Musterimiz, 01.01.2026 10:00:00 tarihinde 1234 ile biten kartinizla, TRENDYOL firmasindan, 1.234,56 TL islem yapilmistir.'
    const result = parseDenizbankCardSms(sms)
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(1234.56)
  })

  it('ondalıksız tam sayı tutarı parse eder', () => {
    const sms = 'Degerli Musterimiz, 01.01.2026 10:00:00 tarihinde 1234 ile biten kartinizla, BIM firmasindan, 50 TL islem yapilmistir.'
    const result = parseDenizbankCardSms(sms)
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(50)
  })

  it('eşleşmeyen metin için null döner', () => {
    expect(parseDenizbankCardSms('rastgele metin')).toBeNull()
  })

  it('sıfır tutar için null döner', () => {
    const sms = 'Degerli Musterimiz, 01.01.2026 10:00:00 tarihinde 1234 ile biten kartinizla, TEST firmasindan, 0 TL islem yapilmistir.'
    expect(parseDenizbankCardSms(sms)).toBeNull()
  })
})

// -- Yapı Kredi kart SMS'leri -------------------------------------------------

describe('parseYapikrediCardSms', () => {
  const SAMPLE = 'Sayin ENES GARIP, 7735 ile biten Hepsiburada Worldcard kartinizla 23.03.2026 saat 10:30\'de,HEPSIPAY *HEPSIBURADA is yerinden 31.834,00 TL islem yapilmistir.'

  it('standart Yapı Kredi kart SMS parse eder', () => {
    const result = parseYapikrediCardSms(SAMPLE)
    expect(result).toEqual({
      type: 'card',
      spentAt: '2026-03-23T10:30',
      lastFour: '7735',
      merchant: 'HEPSIPAY *HEPSIBURADA',
      amount: 31834,
    })
  })

  it('satır sonu içeren SMS parse eder', () => {
    const withNewlines = 'Sayin ENES GARIP,\n7735 ile biten Hepsiburada Worldcard kartinizla\n23.03.2026 saat 10:30\'de,\nHEPSIPAY *HEPSIBURADA is yerinden\n31.834,00 TL islem yapilmistir.'
    const result = parseYapikrediCardSms(withNewlines)
    expect(result).not.toBeNull()
    expect(result!.lastFour).toBe('7735')
    expect(result!.amount).toBe(31834)
  })

  it('küçük tutarlı Yapı Kredi SMS parse eder', () => {
    const sms = 'Sayin ENES GARIP, 4455 ile biten World kartinizla 15.06.2026 saat 14:22\'de, STARBUCKS is yerinden 89,50 TL islem yapilmistir.'
    const result = parseYapikrediCardSms(sms)
    expect(result).not.toBeNull()
    expect(result!.lastFour).toBe('4455')
    expect(result!.merchant).toBe('STARBUCKS')
    expect(result!.amount).toBe(89.5)
  })

  it('eşleşmeyen metin için null döner', () => {
    expect(parseYapikrediCardSms('farkli banka SMS\'i')).toBeNull()
  })
})

// -- DenizBank hesap hareketi SMS'leri ----------------------------------------

describe('parseDenizbankAccountSms', () => {
  const OUTGOING = 'Degerli Musterimiz, 24.06.2026 21:40:15\'da Ipek Bayram alicisina 4230-13300128-351 numarali hesabinizdan 600,00 TL tutarinda FAST islemi gerceklesmistir.'
  const INCOMING = 'Degerli Musterimiz, 24.06.2026 21:40:15\'da Ipek Bayram gondericisinden 4230-13300128-351 numarali hesabiniza 600,00 TL tutarinda FAST islemi gerceklesmistir.'

  it('giden havale parse eder (direction=out)', () => {
    const result = parseDenizbankAccountSms(OUTGOING)
    expect(result).toEqual({
      type: 'account',
      occurredAt: '2026-06-24T21:40:15',
      accountNumber: '4230-13300128-351',
      counterparty: 'Ipek Bayram',
      amount: 600,
      direction: 'out',
      transactionType: 'FAST',
    })
  })

  it('gelen havale parse eder (direction=in)', () => {
    const result = parseDenizbankAccountSms(INCOMING)
    expect(result).not.toBeNull()
    expect(result!.direction).toBe('in')
    expect(result!.counterparty).toBe('Ipek Bayram')
  })

  it('satır sonu içeren hesap SMS parse eder', () => {
    const withNewlines = 'Degerli Musterimiz,\n24.06.2026 21:40:15\'da\nIpek Bayram alicisina\n4230-13300128-351 numarali hesabinizdan\n600,00 TL tutarinda FAST islemi gerceklesmistir.'
    const result = parseDenizbankAccountSms(withNewlines)
    expect(result).not.toBeNull()
    expect(result!.direction).toBe('out')
    expect(result!.amount).toBe(600)
  })

  it('eşleşmeyen metin için null döner', () => {
    expect(parseDenizbankAccountSms('kart harcamasi mesaji')).toBeNull()
  })
})

// -- parseSms (tüm bankalar) --------------------------------------------------

describe('parseSms', () => {
  it('DenizBank kart SMS tanır', () => {
    const sms = 'Degerli Musterimiz, 23.06.2026 15:18:21 tarihinde 9032 ile biten kartinizla, MIGROS firmasindan, 150,75 TL islem yapilmistir.'
    const result = parseSms(sms)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('card')
  })

  it('Yapı Kredi kart SMS tanır', () => {
    const sms = 'Sayin ENES GARIP, 7735 ile biten Worldcard kartinizla 10.06.2026 saat 09:15\'de, NETFLIX is yerinden 99,99 TL islem yapilmistir.'
    const result = parseSms(sms)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('card')
  })

  it('DenizBank hesap hareketi SMS tanır', () => {
    const sms = 'Degerli Musterimiz, 24.06.2026 21:40:15\'da Ali Veli alicisina 1234567890 numarali hesabinizdan 100 TL tutarinda EFT islemi gerceklesmistir.'
    const result = parseSms(sms)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('account')
  })

  it('tanınmayan SMS formatı için null döner', () => {
    expect(parseSms('Hesabiniza 500 TL yatirilmistir.')).toBeNull()
    expect(parseSms('')).toBeNull()
    expect(parseSms('Kredi karti borcunuz 1.500 TL.')).toBeNull()
  })
})

// -- inferCategory ------------------------------------------------------------

describe('inferCategory', () => {
  it('BÜYÜK HARF merchant eşleştirir (Turkish I normalization)', () => {
    expect(inferCategory('MIGROS')).toBe('Market')
    expect(inferCategory('BIM BIRLESIK MAGAZALAR')).toBe('Market')
    expect(inferCategory('NETFLIX')).toBe('Eğlence')
  })

  it('küçük harf merchant eşleştirir', () => {
    expect(inferCategory('migros')).toBe('Market')
    expect(inferCategory('starbucks')).toBe('Yemek')
  })

  it('karışık harf merchant eşleştirir', () => {
    expect(inferCategory('Trendyol')).toBe('Alışveriş')
    expect(inferCategory('Shell Petrol')).toBe('Ulaşım')
  })

  it('bilinmeyen merchant Diğer döner', () => {
    expect(inferCategory('BILINMEYEN FIRMA')).toBe('Diğer')
    expect(inferCategory('XYZ LTD STI')).toBe('Diğer')
  })

  it('FINDEKS fatura kategorisine düşer', () => {
    expect(inferCategory('FINDEKS FINANSAL YONETI')).toBe('Fatura')
  })

  it('HEPSIPAY alışveriş kategorisine düşer', () => {
    expect(inferCategory('HEPSIPAY *HEPSIBURADA')).toBe('Alışveriş')
  })
})
