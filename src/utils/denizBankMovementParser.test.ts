import { describe, expect, it } from 'vitest'
import { matchDenizBankMovementPayments, matchDenizBankMovements, parseDenizBankMovementPdf } from './denizBankMovementParser'

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

  it('does not match amount differences above 1 TL', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-19', amount: 536.01, status: 'provision', description: 'UNDEM PETROL' }],
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

  it('matches same amount within a short date window when bank posting date differs', () => {
    const result = matchDenizBankMovements(
      [petrol],
      [{ spent_at: '2026-06-17', amount: 535, status: 'posted', description: 'Araba yakıt' }],
    )

    expect(result.matched).toEqual([petrol])
    expect(result.unmatched).toHaveLength(0)
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
