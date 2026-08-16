import { describe, expect, it } from 'vitest'
import {
  findExistingInstallmentPlan,
  matchDenizBankInstallmentMovements,
  matchDenizBankMovementPayments,
  matchDenizBankMovements,
  parseDenizBankMovementPdf,
} from './denizBankMovementParser'

const SAMPLE_TEXT = `
6/19/26, 10:32 PM DenizBank İnternet Bankacılığı
DENİZBANK A.Ş Genel Müdürlük: Büyükdere Cad. No: 141 34394 Esentepe/İstanbul
İşlem Türü İşlem Tarihi İşlem İşlem Detayı Kart No Kart Tipi İşlem Tutarı Bonus
Bekleyen İşlem 19.06.2026 UNDEM PETROL 5555 74** **** 0189 Asıl Kart 535,00 TL 0,00 TL
Dönem İçi 18.06.2026 FLEX STORE BURSA TR Peşin Satış 5555 74** **** 0189 Asıl Kart 460,00 TL 0,00 TL
Dönem İçi 18.06.2026 PETROV KAFE BURSA TR Peşin Satış 5555 74** **** 0189 Asıl Kart 310,00 TL 0,00 TL
Dönem İçi 17.06.2026 İYZİCO/UDEMY.COM İSTANBUL TR Peşin Satış 5203 03** **** 9032 Sanal 349,99 TL 0,00 TL
Dönem İçi 16.06.2026 MEDIA MARKT -MEDİA Peş. Taksit 1.Tk Anapara Taksitli Satış 5203 03** **** 9032 Sanal 2.749,50 TL 2,75 TL
Dönem İçi 15.06.2026 TÜRK TELEKOM İNTERNET 704 İSTANBUL TR Otomatik Kredi Kartı Fatura Ödemesi 5555 74** **** 0189 Asıl Kart 685,00 TL 0,00 TL
Dönem İçi 09.06.2026 Hesaptan Ödeme Hesaptan Ödeme 5555 74** **** 0189 Asıl Kart 82.653,51 TL 0,00 TL
Dönem İçi 19.05.2026 BEYLER OPTİK Peş. Taksit 2.Tk Anapara Taksitli Satış 5555 74** **** 0189 Asıl Kart 21.666,67 TL 0,00 TL
`

/** Tek kartlı ürün: DenizBank Kart No / Kart Tipi kolonlarını hiç basmaz. */
const SINGLE_CARD_TEXT = `
8/16/26, 5:39 PM DenizBank İnternet Bankacılığı
İşlem Türü İşlem Tarihi İşlem İşlem Detayı İşlem Tutarı Bonus
Bekleyen İşlem 15.08.2026 GEMLİK TERMAL BURSA TR 120,00 TL 0,00 TL
Dönem İçi 14.08.2026 GREEN SALATA BURSA TR Peşin Satış 1.075,00 TL 0,00 TL
Dönem İçi 09.08.2026 Hesaptan Ödeme Hesaptan Ödeme 22.759,20 TL 0,00 TL
Dönem İçi 08.08.2026 SEYHAN MARKET BURSA TR Peşin Satış 208,40 TL 0,10 TL
`

describe('parseDenizBankMovementPdf', () => {
  it('parses current movement rows from DenizBank internet banking PDF text', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)

    expect(result.ignoredRows).toHaveLength(0)
    expect(result.movements).toHaveLength(7)
    expect(result.payments).toHaveLength(1)
  })

  it('maps pending rows to provisions and posted rows to posted expenses', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)
    const pending = result.movements.find((movement) => movement.description === 'UNDEM PETROL')
    const posted = result.movements.find((movement) => movement.description === 'FLEX STORE')

    expect(pending).toMatchObject({
      bankStatus: 'pending',
      appStatus: 'provision',
      date: '2026-06-19',
      amount: 535,
      category: 'Ulaşım',
      cardLastFour: '0189',
    })
    expect(posted).toMatchObject({
      bankStatus: 'posted',
      appStatus: 'posted',
      date: '2026-06-18',
      amount: 460,
    })
  })

  it('records Hesaptan Ödeme separately instead of importing it as spending', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)

    expect(result.payments[0]).toMatchObject({
      date: '2026-06-09',
      description: 'Hesaptan Ödeme',
      amount: 82653.51,
    })
    expect(result.movements.some((movement) => movement.description === 'Hesaptan Ödeme')).toBe(false)
  })

  it('detects installment rows for manual review', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)
    const installments = result.movements.filter((movement) => movement.isInstallment)

    expect(installments.map((movement) => movement.description)).toEqual([
      'MEDIA MARKT -MEDİA Peş. Taksit 1.Tk Anapara',
      'BEYLER OPTİK Peş. Taksit 2.Tk Anapara',
    ])
  })

  it('parses installment number from "Peş. Taksit N.Tk" format', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)
    const mediaMarkt = result.movements.find((m) => m.description.includes('MEDIA MARKT'))
    const beyler = result.movements.find((m) => m.description.includes('BEYLER OPTİK'))

    expect(mediaMarkt).toMatchObject({ installmentNo: 1, installmentCount: 0 })
    expect(beyler).toMatchObject({ installmentNo: 2, installmentCount: 0 })
  })

  it('sets installmentNo=1 and installmentCount=1 for non-installment rows', () => {
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)
    const flexStore = result.movements.find((m) => m.description.includes('FLEX STORE'))

    expect(flexStore).toMatchObject({ installmentNo: 1, installmentCount: 1, isInstallment: false })
  })

  it('reads rows from single-card exports that omit the Kart No / Kart Tipi columns', () => {
    // Tek kartlı üründe DenizBank kart kolonlarını hiç basmaz. Kolon zorunlu
    // tutulduğu sürece TÜM satırlar ignoredRows'a düşüyordu (ekran boş geliyordu).
    const result = parseDenizBankMovementPdf(SINGLE_CARD_TEXT)

    expect(result.ignoredRows).toHaveLength(0)
    expect(result.movements).toHaveLength(3)
    expect(result.payments).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      bankStatus: 'pending',
      appStatus: 'provision',
      date: '2026-08-15',
      description: 'GEMLİK TERMAL',
      amount: 120,
      cardNo: '',
      cardType: '',
      cardLastFour: '',
    })
    expect(result.movements[1]).toMatchObject({
      date: '2026-08-14',
      description: 'GREEN SALATA',
      detail: 'Peşin Satış',
      amount: 1075,
    })
    expect(result.payments[0]).toMatchObject({ date: '2026-08-09', amount: 22759.2, cardLastFour: '' })
  })

  it('keeps the card columns when the export does include them', () => {
    // Kolon opsiyonel olduktan sonra da açıklama kart numarasını YUTMAMALI.
    const result = parseDenizBankMovementPdf(SAMPLE_TEXT)
    const petrol = result.movements.find((m) => m.description === 'UNDEM PETROL')

    expect(petrol).toMatchObject({ cardNo: '5555 74** **** 0189', cardType: 'Asıl Kart', cardLastFour: '0189' })
  })

  it('splits OGS-HGS and Talimatlı Taksitli detail labels out of the description', () => {
    const result = parseDenizBankMovementPdf(`
İşlem Türü İşlem Tarihi İşlem İşlem Detayı Kart No Kart Tipi İşlem Tutarı Bonus
Dönem İçi 12.08.2026 34ABC12 HGS yükl. bedeli İSTANBUL TR OGS-HGS Yükleme İşlemi 5555 74** **** 0189 Asıl Kart 250,00 TL 0,00 TL
Dönem İçi 08.07.2026 BEYLER OPTİK Bursa Peş. Taksit 2.Tk Anapara Talimatlı Taksitli Satış 5555 74** **** 0189 Asıl Kart 1.750,00 TL 0,00 TL
`)

    expect(result.ignoredRows).toHaveLength(0)
    expect(result.movements[0]).toMatchObject({
      description: '34ABC12 HGS yükl. bedeli',
      detail: 'OGS-HGS Yükleme İşlemi',
    })
    // "Talimatlı" kısa varyanta düşerse açıklamada sarkar; uzun etiket önce gelmeli.
    expect(result.movements[1]).toMatchObject({
      description: 'BEYLER OPTİK Bursa Peş. Taksit 2.Tk Anapara',
      detail: 'Talimatlı Taksitli Satış',
    })
  })
})

describe('matchDenizBankMovements', () => {
  const [petrol, flex, cafe] = parseDenizBankMovementPdf(SAMPLE_TEXT).movements

  it('matches by date and amount without reusing the same existing expense', () => {
    const result = matchDenizBankMovements(
      [petrol, flex, cafe],
      [
        { spent_at: '2026-06-19', amount: 535, status: 'provision', description: 'UNDEM PETROL' },
        { spent_at: '2026-06-18', amount: 460, status: 'posted', description: 'FLEX STORE' },
      ],
    )

    expect(result.matched).toEqual([petrol, flex])
    expect(result.unmatched).toEqual([cafe])
  })

  it('ignores cancelled expenses when matching', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 535, status: 'cancelled', description: 'UNDEM PETROL' }],
    )

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toEqual([petrol])
  })

  it('tolerates a 1 TL amount difference from bank exports', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 535.9, status: 'provision', description: 'UNDEM PETROL' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
    expect(result.matches[0]).toMatchObject({
      movement: petrol,
      expense: { description: 'UNDEM PETROL' },
    })
  })

  it('tolerates a relative 1% amount drift on the transaction size', () => {
    // 535 TL'nin %1'i = 5,35 TL → 5,01 TL sapma artık eşleşir (döviz/bahşiş sapması).
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 540.01, status: 'provision', description: 'UNDEM PETROL' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not match amount differences beyond the tolerance', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 542, status: 'provision', description: 'UNDEM PETROL' }],
    )

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toEqual([petrol])
  })

  it('matches user-written descriptions when date and amount are the same', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 535, status: 'provision', description: 'Benzin aldım' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not arbitrarily match when two same-day, same-amount expenses are ambiguous', () => {
    const result = matchDenizBankMovements(
      [petrol], // 535 TL on 2026-06-19
      [
        { spent_at: '2026-06-19', amount: 535, status: 'provision', description: 'Market alışverişi' },
        { spent_at: '2026-06-19', amount: 535, status: 'provision', description: 'Eczane' },
      ],
    )
    // neither description is compatible and the date/amount alone is ambiguous → leave unmatched
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  it('matches same amount within a short date window when bank posting date differs', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-17', amount: 535, status: 'posted', description: 'Araba yakıt' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
  })

  it('matches within the widened window (up to 7 days) when descriptions overlap', () => {
    // Provizyon tarihi ile banka post tarihi 6 gün farklı, açıklama uyumlu → tek kayıt.
    const result = matchDenizBankMovements(
      [petrol], // 2026-06-19, UNDEM PETROL
      [{ spent_at: '2026-06-13', amount: 535, status: 'provision', description: 'UNDEM PETROL BURSA' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not blindly match in the widened window without description overlap', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-13', amount: 535, status: 'provision', description: 'Eczane' }],
    )

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toEqual([petrol])
  })

  it('does not match beyond the loose window even with compatible descriptions', () => {
    const result = matchDenizBankMovements(
      [petrol], // 2026-06-19
      [{ spent_at: '2026-06-10', amount: 535, status: 'provision', description: 'UNDEM PETROL' }],
    )

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toEqual([petrol])
  })

  it('returns appOnly expenses from the period that did not match any bank movement', () => {
    const periodExpenses = [
      { id: 'e1', spent_at: '2026-06-19', amount: 535, status: 'provision', description: 'UNDEM PETROL' },
      { id: 'e2', spent_at: '2026-06-18', amount: 460, status: 'posted', description: 'FLEX STORE' },
      { id: 'e3', spent_at: '2026-06-15', amount: 685, status: 'posted', description: 'İnternet faturası' },
    ]
    const result = matchDenizBankMovements(
      [petrol, flex],
      periodExpenses,
      periodExpenses,
    )

    expect(result.matched).toEqual([petrol, flex])
    expect(result.appOnly).toHaveLength(1)
    expect(result.appOnly[0]).toMatchObject({ id: 'e3', description: 'İnternet faturası' })
  })

  it('excludes cancelled expenses from appOnly', () => {
    const periodExpenses = [
      { id: 'e1', spent_at: '2026-06-15', amount: 100, status: 'cancelled', description: 'Cancelled item' },
    ]
    const result = matchDenizBankMovements([], [], periodExpenses)

    expect(result.appOnly).toHaveLength(0)
  })

  it('returns empty appOnly when periodExpenses is omitted', () => {
    const result = matchDenizBankMovements([petrol], [])

    expect(result.appOnly).toHaveLength(0)
  })
})

describe('matchDenizBankInstallmentMovements', () => {
  it('matches the bank original date and installment number to the exact derived installment date', () => {
    const movement = parseDenizBankMovementPdf(SAMPLE_TEXT).movements.find((item) => item.description.includes('BEYLER'))!
    const result = matchDenizBankInstallmentMovements([movement], [{
      id: 'i-2',
      due_month: '2026-06-19',
      amount: 21_666.67,
      status: 'posted',
      description: 'Beyler Optik',
      installment_no: 2,
      installment_count: 3,
    }])

    expect(result.matches).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not match an old first-of-month installment date', () => {
    const movement = parseDenizBankMovementPdf(SAMPLE_TEXT).movements.find((item) => item.description.includes('BEYLER'))!
    const result = matchDenizBankInstallmentMovements([movement], [{
      id: 'i-2',
      due_month: '2026-06-01',
      amount: 21_666.67,
      status: 'posted',
      description: 'Beyler Optik',
      installment_no: 2,
      installment_count: 3,
    }])

    expect(result.matches).toHaveLength(0)
    expect(result.unmatched).toHaveLength(1)
  })

  // KÖK SEBEP REGRESYONU (2026-08-16): `scheduled` satırlar aday listesinden
  // eleniyordu. Bankanın bu ay bastığı taksit uygulamada tam olarak `scheduled`
  // beklediği için eşleşme sistematik olarak kaçıyor, satır manuel incelemeye
  // düşüyor ve kullanıcı aynı alışverişe İKİNCİ bir plan kuruyordu. Üretimde
  // 4 çift kayıt bu yoldan doğdu.
  it.each(['scheduled', 'posted', 'paid'])('matches an existing plan row with status "%s"', (status) => {
    const movement = parseDenizBankMovementPdf(SAMPLE_TEXT).movements.find((item) => item.description.includes('BEYLER'))!
    const result = matchDenizBankInstallmentMovements([movement], [{
      id: 'i-2',
      due_month: '2026-06-19',
      amount: 21_666.67,
      status,
      description: 'Beyler Optik',
      installment_no: 2,
      installment_count: 3,
    }])

    expect(result.matches, `status=${status} eşleşmeliydi`).toHaveLength(1)
    expect(result.unmatched).toHaveLength(0)
  })

  it('tolerates the month-end shift in the derived installment date', () => {
    // 31 Oca + 1 ay = 28 Şub: türetilen vade ile plandaki vade birkaç gün kayar.
    const [movement] = parseDenizBankMovementPdf(`
İşlem Türü İşlem Tarihi İşlem İşlem Detayı Kart No Kart Tipi İşlem Tutarı Bonus
Dönem İçi 31.01.2026 TEST MAĞAZA Peş. Taksit 2.Tk Anapara Taksitli Satış 5555 74** **** 0189 Asıl Kart 1.000,00 TL 0,00 TL
`).movements

    const result = matchDenizBankInstallmentMovements([movement], [{
      id: 'i-2',
      due_month: '2026-02-28',
      amount: 1000,
      status: 'scheduled',
      description: 'TEST MAĞAZA',
      installment_no: 2,
      installment_count: 4,
    }])

    expect(result.matches).toHaveLength(1)
  })
})

describe('findExistingInstallmentPlan', () => {
  const movement = parseDenizBankMovementPdf(SAMPLE_TEXT).movements.find((item) => item.description.includes('BEYLER'))!

  it('finds the existing plan by monthly amount and description', () => {
    const hint = findExistingInstallmentPlan(movement, [
      { id: 'i-3', due_month: '2026-07-19', amount: 21_666.67, status: 'scheduled', description: 'BEYLER OPTİK Peş. Taksit 3.Tk Anapara', installment_no: 3, installment_count: 3 },
    ])

    expect(hint).toMatchObject({ installmentCount: 3, knownInstallmentNo: 3 })
  })

  it('suggests the highest count when the same merchant already carries conflicting plans', () => {
    // Bozuk veri hâli: aynı satıcı için 2 ve 3 taksitlik iki plan var. Eksik plan
    // kurmak fazladan plan kurmaktan az zararlı olduğu için yüksek adet önerilir.
    const hint = findExistingInstallmentPlan(movement, [
      { id: 'a', due_month: '2026-06-19', amount: 21_666.67, status: 'paid', description: 'BEYLER OPTİK', installment_no: 1, installment_count: 2 },
      { id: 'b', due_month: '2026-07-19', amount: 21_666.66, status: 'scheduled', description: 'BEYLER OPTİK', installment_no: 3, installment_count: 3 },
    ])

    expect(hint?.installmentCount).toBe(3)
  })

  it('does not suggest a plan from an unrelated merchant with a similar amount', () => {
    const hint = findExistingInstallmentPlan(movement, [
      { id: 'x', due_month: '2026-07-19', amount: 21_666.67, status: 'scheduled', description: 'BAŞKA MAĞAZA', installment_no: 2, installment_count: 6 },
    ])

    expect(hint).toBeNull()
  })

  it('returns null when no installment plan resembles the row', () => {
    expect(findExistingInstallmentPlan(movement, [])).toBeNull()
  })
})

describe('DenizBank movement planned payment reconciliation', () => {
  const invoice = parseDenizBankMovementPdf(SAMPLE_TEXT).movements.find((movement) => movement.amount === 685)!

  it('matches payment-created card expenses by the due date stored in note', () => {
    const result = matchDenizBankMovements(
      [invoice],
      [
        {
          spent_at: '2026-06-20',
          amount: 685,
          status: 'posted',
          description: invoice.description,
          note: 'Odeme kaydindan olusturuldu. Vade: 2026-06-15',
        },
      ],
    )

    expect(result.matched).toEqual([invoice])
    expect(result.unmatched).toHaveLength(0)
  })

  it('matches still-open planned payments by amount, due date, and title', () => {
    const result = matchDenizBankMovementPayments(
      [invoice],
      [
        {
          id: 'payment-1',
          title: invoice.description,
          amount: 685,
          amount_status: 'exact',
          due_date: '2026-06-15',
          status: 'bekliyor',
          payment_method: 'manual',
          auto_source_card_id: null,
        },
      ],
      'card-1',
    )

    expect(result.matched).toEqual([invoice])
    expect(result.unmatched).toHaveLength(0)
    expect(result.matches[0]?.payment.id).toBe('payment-1')
  })

  it('matches planned payments even when the user wrote a custom title', () => {
    const result = matchDenizBankMovementPayments(
      [invoice],
      [
        {
          id: 'payment-custom-title',
          title: 'internet faturasi',
          amount: 685,
          amount_status: 'exact',
          due_date: '2026-06-15',
          status: 'bekliyor',
          payment_method: 'manual',
          auto_source_card_id: null,
        },
      ],
      'card-1',
    )

    expect(result.matched).toEqual([invoice])
    expect(result.unmatched).toHaveLength(0)
  })

  it('does not match planned payments tied to another card', () => {
    const result = matchDenizBankMovementPayments(
      [invoice],
      [
        {
          id: 'payment-2',
          title: invoice.description,
          amount: 685,
          amount_status: 'exact',
          due_date: '2026-06-15',
          status: 'bekliyor',
          payment_method: 'manual',
          auto_source_card_id: 'other-card',
        },
      ],
      'card-1',
    )

    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toEqual([invoice])
  })
})

describe('parseDenizBankMovementPdf — iade/ters kayıt satırı (Faz F)', () => {
  // Banka iadeyi EKSİ tutarla basar. Eski desen işareti tanımıyordu: satır
  // ROW_PATTERN'e uymayıp ignoredRows'a düşüyordu (ya da işaretsiz basılırsa
  // harcama sayılıyordu). Artık ayrı `refunds` listesine düşer.
  const REFUND_TEXT = `
İşlem Türü İşlem Tarihi İşlem İşlem Detayı Kart No Kart Tipi İşlem Tutarı Bonus
Dönem İçi 18.06.2026 FLEX STORE BURSA TR Peşin Satış 5555 74** **** 0189 Asıl Kart 460,00 TL 0,00 TL
Dönem İçi 19.06.2026 FLEX STORE IADE BURSA TR Peşin Satış 5555 74** **** 0189 Asıl Kart -460,00 TL -4,60 TL
Dönem İçi 20.06.2026 SONDA ISARET IADE BURSA TR Peşin Satış 5555 74** **** 0189 Asıl Kart 120,50- TL 0,00 TL
`

  it('eksi tutarlı satırı harcama olarak İÇERİ ALMAZ', () => {
    const result = parseDenizBankMovementPdf(REFUND_TEXT)
    expect(result.movements).toHaveLength(1)
    expect(result.movements[0].amount).toBe(460)
    expect(result.movements.some((m) => m.description.includes('IADE'))).toBe(false)
  })

  it('iadeyi ayrı `refunds` listesinde mutlak tutarla döndürür', () => {
    const result = parseDenizBankMovementPdf(REFUND_TEXT)
    expect(result.refunds).toHaveLength(2)
    expect(result.refunds[0].amount).toBe(460)
    expect(result.refunds[0].bonus).toBe(-4.6)
    // Sonda işaret taşıyan format da yakalanır.
    expect(result.refunds[1].amount).toBe(120.5)
  })

  it('iade satırını kullanıcıya görünür kılar (ignoredRows uyarı yolu)', () => {
    const result = parseDenizBankMovementPdf(REFUND_TEXT)
    expect(result.ignoredRows).toHaveLength(2)
  })

  it('eksi tutarlı ödeme satırını da tahsilat saymaz', () => {
    const result = parseDenizBankMovementPdf(`
Dönem İçi 09.06.2026 Hesaptan Ödeme Hesaptan Ödeme 5555 74** **** 0189 Asıl Kart -1.000,00 TL 0,00 TL
`)
    expect(result.payments).toHaveLength(0)
    expect(result.movements).toHaveLength(0)
    expect(result.refunds).toHaveLength(1)
  })
})
