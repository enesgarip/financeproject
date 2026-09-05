/**
 * Web Push tür tercihleri + sessiz saat mantığı (saf).
 *
 * Edge fonksiyonu (push-notify) gönderim öncesi bunun ikizini uygular: kapalı
 * türü ve sessiz saat penceresindeki kullanıcıyı atlar. Buradaki fonksiyonlar
 * client tarafında da (UI önizleme, "şu an sessiz saatte") kullanılır ve test edilir.
 */
import type { NotificationPreferences } from '../types/database'

export type NotificationTypeKey =
  | 'payments_enabled'
  | 'loans_enabled'
  | 'statements_enabled'
  | 'weekly_enabled'
  | 'cars_enabled'
  | 'provisions_enabled'
  | 'goals_enabled'
  | 'sms_alerts_enabled'

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  payments_enabled: true,
  loans_enabled: true,
  statements_enabled: true,
  weekly_enabled: true,
  cars_enabled: true,
  provisions_enabled: true,
  goals_enabled: true,
  sms_alerts_enabled: true,
  quiet_hours_start: null as number | null,
  quiet_hours_end: null as number | null,
}

/** Edge fonksiyonunun ürettiği notificationType → tercih kolonu. */
export function notificationTypeToPrefKey(notificationType: string): NotificationTypeKey | null {
  switch (notificationType) {
    case 'payment_due_tomorrow':
      return 'payments_enabled'
    case 'loan_installment_due_tomorrow':
      return 'loans_enabled'
    case 'card_statement_cut_3d':
    case 'card_statement_cut_receipt':
      return 'statements_enabled'
    case 'weekly_summary':
    case 'reconciliation_stale_weekly':
      return 'weekly_enabled'
    case 'car_reminder_due_7d':
      return 'cars_enabled'
    case 'provision_installment_pending':
    case 'provision_statement_cut_risk':
      return 'provisions_enabled'
    case 'goal_contribution_due':
      return 'goals_enabled'
    case 'sms_failure_daily':
      return 'sms_alerts_enabled'
    default:
      return null // bilinmeyen/test türü kapıya takılmaz
  }
}

type PrefFlags = Pick<NotificationPreferences, NotificationTypeKey>

export function isNotificationTypeEnabled(prefs: PrefFlags, notificationType: string): boolean {
  const key = notificationTypeToPrefKey(notificationType)
  if (!key) return true
  return prefs[key] !== false
}

/**
 * Verilen saat (0-23) sessiz pencere içinde mi? start/end null ise veya eşitse
 * pencere yok (yanlışlıkla 24 saat susturmayı önler). start<end normal aralık,
 * start>end gece devri (ör. 22→7).
 */
export function isWithinQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

/**
 * Günlük gönderim penceresi TEK saattir (push-notify cron'u 07:00 Europe/Istanbul).
 * Sessiz saat o tek saati kapsıyorsa "sessiz" demek pratikte "kapalı" demektir —
 * kullanıcı bunu bilmeden tüm bildirimleri susturabiliyor, o yüzden UI uyarır.
 */
export const DAILY_PUSH_HOUR = 7

export function quietHoursMuteDailyPush(start: number | null, end: number | null): boolean {
  return isWithinQuietHours(DAILY_PUSH_HOUR, start, end)
}
