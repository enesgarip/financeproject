import { supabase } from '../../lib/supabase'
import type { Car, CarExpense, CardExpense, CarReminder, InsertFor, UpdateFor } from '../../types/database'
import {
  appErrorFromSupabase,
  fail,
  ok,
  resultFromSupabase,
  voidResultFromSupabase,
  type Result,
} from '../result'

// Arabalarım veri erişimi. İki kaynak: (1) araç listesi + kart-dışı manuel
// giderler (car_expenses), (2) bir araca etiketlenmiş kart giderleri
// (card_expenses.car_id). Etiketleme borç RPC'sine dokunmaz — kategori
// güncellemesiyle aynı desende doğrudan tablo UPDATE'i (RLS own-row korur).

export async function fetchCars(): Promise<Result<Car[]>> {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return fail(appErrorFromSupabase(error, 'Araçlar yüklenemedi.'))
  return ok((data ?? []) as Car[])
}

export async function insertCar(
  item: Omit<InsertFor<'cars'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<Car>> {
  const { data, error } = await supabase.from('cars').insert(item as InsertFor<'cars'>).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Araç eklenemedi.'))
  return ok(data as Car)
}

export async function updateCar(id: string, fields: UpdateFor<'cars'>): Promise<Result<Car>> {
  const { data, error } = await supabase.from('cars').update(fields).eq('id', id).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Araç güncellenemedi.'))
  return ok(data as Car)
}

export async function deleteCar(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('cars').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Araç silinemedi.')
}

export async function fetchCarExpenses(): Promise<Result<CarExpense[]>> {
  const { data, error } = await supabase
    .from('car_expenses')
    .select('*')
    .order('spent_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return fail(appErrorFromSupabase(error, 'Araç giderleri yüklenemedi.'))
  return ok((data ?? []) as CarExpense[])
}

export async function insertCarExpense(
  item: Omit<InsertFor<'car_expenses'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<CarExpense>> {
  const { data, error } = await supabase
    .from('car_expenses')
    .insert(item as InsertFor<'car_expenses'>)
    .select()
    .single()
  if (error) return fail(appErrorFromSupabase(error, 'Araç gideri eklenemedi.'))
  return ok(data as CarExpense)
}

export async function updateCarExpense(
  id: string,
  fields: UpdateFor<'car_expenses'>,
): Promise<Result<CarExpense>> {
  const { data, error } = await supabase
    .from('car_expenses')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) return fail(appErrorFromSupabase(error, 'Araç gideri güncellenemedi.'))
  return ok(data as CarExpense)
}

export async function deleteCarExpense(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('car_expenses').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Araç gideri silinemedi.')
}

/** Bir araca etiketlenmiş (car_id dolu) kesinleşmiş kart harcamaları. */
export async function fetchCarReminders(): Promise<Result<CarReminder[]>> {
  const { data, error } = await supabase
    .from('car_reminders')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('due_odometer_km', { ascending: true, nullsFirst: false })
  return resultFromSupabase((data ?? []) as CarReminder[], error, 'Araç hatırlatıcıları yüklenemedi.')
}

export async function insertCarReminder(
  item: Omit<InsertFor<'car_reminders'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<CarReminder>> {
  const { data, error } = await supabase.from('car_reminders').insert(item).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Hatırlatıcı eklenemedi.'))
  return ok(data as CarReminder)
}

export async function updateCarReminder(
  id: string,
  fields: UpdateFor<'car_reminders'>,
): Promise<Result<CarReminder>> {
  const { data, error } = await supabase.from('car_reminders').update(fields).eq('id', id).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Hatırlatıcı güncellenemedi.'))
  return ok(data as CarReminder)
}

export async function deleteCarReminder(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('car_reminders').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Hatırlatıcı silinemedi.')
}

export async function fetchTaggedCardExpenses(): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .not('car_id', 'is', null)
    .eq('status', 'posted')
    .order('spent_at', { ascending: false })

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Araç kart harcamaları yüklenemedi.')
}

/**
 * Kart harcamasını bir araca etiketler (carId=null → etiketi kaldırır). Saf
 * annotation; borç/ekstre/ledger'a dokunmaz. updateCardExpenseCategory ile aynı
 * doğrudan-UPDATE deseni — arşiv koruması RPC içinde olduğu için burayı engellemez.
 */
export async function setCardExpenseCar(
  expenseId: string,
  carId: string | null,
  fuel?: { liters: number | null; odometerKm: number | null },
): Promise<Result<void>> {
  const fields: UpdateFor<'card_expenses'> = { car_id: carId }
  if (fuel) {
    fields.fuel_liters = fuel.liters
    fields.odometer_km = fuel.odometerKm
  }
  const { error } = await supabase.from('card_expenses').update(fields).eq('id', expenseId)
  return voidResultFromSupabase(error, 'Kart harcaması araca atanamadı.')
}
