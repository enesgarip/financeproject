import { describe, expect, it } from 'vitest'
import {
  isNotificationTypeEnabled,
  isWithinQuietHours,
  notificationTypeToPrefKey,
  quietHoursMuteDailyPush,
} from './notificationPreferences'

const allOn = {
  payments_enabled: true,
  loans_enabled: true,
  statements_enabled: true,
  weekly_enabled: true,
  cars_enabled: true,
  provisions_enabled: true,
}

describe('notificationTypeToPrefKey', () => {
  it('tipleri doğru kolona eşler', () => {
    expect(notificationTypeToPrefKey('payment_due_tomorrow')).toBe('payments_enabled')
    expect(notificationTypeToPrefKey('loan_installment_due_tomorrow')).toBe('loans_enabled')
    expect(notificationTypeToPrefKey('card_statement_cut_3d')).toBe('statements_enabled')
    expect(notificationTypeToPrefKey('weekly_summary')).toBe('weekly_enabled')
    expect(notificationTypeToPrefKey('reconciliation_stale_weekly')).toBe('weekly_enabled')
    expect(notificationTypeToPrefKey('test')).toBeNull()
  })
})

describe('isNotificationTypeEnabled', () => {
  it('kapalı tür engellenir, açık tür geçer', () => {
    expect(isNotificationTypeEnabled({ ...allOn, payments_enabled: false }, 'payment_due_tomorrow')).toBe(false)
    expect(isNotificationTypeEnabled(allOn, 'payment_due_tomorrow')).toBe(true)
  })

  it('bilinmeyen tür (test) kapıya takılmaz', () => {
    expect(isNotificationTypeEnabled({ ...allOn, weekly_enabled: false }, 'test')).toBe(true)
  })
})

describe('isWithinQuietHours', () => {
  it('null veya eşit sınır = pencere yok', () => {
    expect(isWithinQuietHours(3, null, 7)).toBe(false)
    expect(isWithinQuietHours(3, 22, null)).toBe(false)
    expect(isWithinQuietHours(3, 8, 8)).toBe(false)
  })

  it('normal aralık [start, end)', () => {
    expect(isWithinQuietHours(9, 8, 17)).toBe(true)
    expect(isWithinQuietHours(17, 8, 17)).toBe(false)
    expect(isWithinQuietHours(7, 8, 17)).toBe(false)
  })

  it('gece devri (22→7)', () => {
    expect(isWithinQuietHours(23, 22, 7)).toBe(true)
    expect(isWithinQuietHours(3, 22, 7)).toBe(true)
    expect(isWithinQuietHours(7, 22, 7)).toBe(false)
    expect(isWithinQuietHours(12, 22, 7)).toBe(false)
  })
})

describe('quietHoursMuteDailyPush', () => {
  it('UI varsayilani 22-08 gunluk 07:00 gonderimini tamamen susturur', () => {
    // Sessiz saat anahtarinin varsayilani 22-08; cron 07:00'de kostugu icin bu
    // secim "sessiz" degil "kapali" demek olur, kullanici da bunu bilmez.
    expect(quietHoursMuteDailyPush(22, 8)).toBe(true)
  })

  it('07:00 disinda kalan pencere gonderime dokunmaz', () => {
    expect(quietHoursMuteDailyPush(22, 7)).toBe(false)
    expect(quietHoursMuteDailyPush(23, 6)).toBe(false)
    expect(quietHoursMuteDailyPush(null, null)).toBe(false)
  })
})
