import { addMonths, dateInputValue } from './date'
import type { CarReminder } from '../types/database'

/** Sonraki bakım aralığı gerçekleşen tarih/kilometreden başlar. */
export function suggestNextCarService(reminder: Pick<CarReminder, 'repeat_months' | 'repeat_km'>, completedOn: string, odometerKm: number | null) {
  return {
    nextDate: reminder.repeat_months ? dateInputValue(addMonths(new Date(`${completedOn}T12:00:00`), reminder.repeat_months)) : null,
    nextKm: reminder.repeat_km && odometerKm !== null ? odometerKm + reminder.repeat_km : null,
  }
}
