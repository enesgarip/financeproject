import { supabase } from '../../lib/supabase'
import type { Asset, Debt, SavingsGoal } from '../../types/database'
import { appErrorFromSupabase, fail, resultFromSupabase, type Result } from '../result'

/**
 * Auto-valuation veri erişimi. Yalnızca `auto_valued=true` satırlar çekilir
 * (manuel girişler asla dokunulmaz); RLS sorguları oturum açan kullanıcıya
 * daraltır, açık user filtresi gerekmez. Saf değerleme/orkestrasyon
 * `utils/valuationSync.ts`'te kalır.
 */

export type ValuationTable = 'assets' | 'debts' | 'savings_goals'

/**
 * `rate` = hesapta kullanılan birim TL fiyatı (gram altın / döviz / hisse).
 * Değerle birlikte yazılır ki satır "ne zaman, hangi kurla" sorusunu kendi
 * başına cevaplayabilsin (Faz D3).
 */
export type EstimatedValueUpdate = { id: string; value: number; rate: number | null }

export async function fetchAutoValuedAssets(): Promise<Result<Asset[]>> {
  const { data, error } = await supabase.from('assets').select('*').eq('auto_valued', true)
  return resultFromSupabase((data ?? []) as Asset[], error, 'Otomatik değerlenen varlıklar yüklenemedi.')
}

export async function fetchAutoValuedDebts(): Promise<Result<Debt[]>> {
  const { data, error } = await supabase.from('debts').select('*').eq('auto_valued', true).eq('status', 'açık')
  return resultFromSupabase((data ?? []) as Debt[], error, 'Otomatik değerlenen borçlar yüklenemedi.')
}

export async function fetchAutoValuedGoals(): Promise<Result<SavingsGoal[]>> {
  const { data, error } = await supabase.from('savings_goals').select('*').eq('auto_valued', true).eq('status', 'active')
  return resultFromSupabase((data ?? []) as SavingsGoal[], error, 'Otomatik değerlenen hedefler yüklenemedi.')
}

/**
 * Yazma sonucu. Önceden yalnız İLK hata dönüyordu; kalanların yazılıp yazılmadığı
 * bilinmiyordu (karışık kurla değerlemede "kaç satır gerçekten güncellendi"
 * sorusu cevapsızdı). Artık düşen satırların kimliği ve gerekçesi taşınır.
 */
export type PersistEstimatedValuesSummary = {
  /** Denenen satır sayısı. */
  requested: number
  /** Başarıyla yazılan satır sayısı. */
  updated: number
  /** Yazılamayan satırlar; boş dizi = tam başarı. */
  failed: { id: string; message: string }[]
}

/**
 * Tahmini değerleri yazar. Tek `upsert` ile round-trip azaltmak KASITLI olarak
 * yapılmadı: PostgREST upsert'i `INSERT ... ON CONFLICT` üretir, o da tabloların
 * NOT NULL kolonlarını (user_id, name, amount…) istediği için kısmi payload
 * çakışma çözülmeden constraint hatası verir. Bu yüzden satır başına UPDATE
 * kalır; kazanç round-trip'te değil, KISMİ BAŞARININ raporlanmasında.
 *
 * Sözleşme: hiçbir satır yazılamadıysa `fail` (eski davranış); en az biri
 * yazıldıysa `ok` + özet — çağıran "hepsi düştü" ile "biri düştü"yü ayırt eder.
 */
export async function persistEstimatedValues(
  table: ValuationTable,
  updates: EstimatedValueUpdate[],
): Promise<Result<PersistEstimatedValuesSummary>> {
  if (updates.length === 0) return { ok: true, data: { requested: 0, updated: 0, failed: [] } }
  const now = new Date().toISOString()
  const results = await Promise.all(
    updates.map(({ id, value, rate }) =>
      supabase
        .from(table)
        .update({
          estimated_value_try: value,
          valued_at: now,
          valuation_rate: rate,
          updated_at: now,
        })
        .eq('id', id)
        .then(({ error }) => ({ id, error })),
    ),
  )

  const failed = results
    .filter((row) => row.error)
    .map((row) => ({ id: row.id, message: row.error?.message ?? 'Bilinmeyen yazma hatası.' }))

  if (failed.length === updates.length) {
    const firstError = results.find((row) => row.error)?.error
    return fail(
      firstError
        ? appErrorFromSupabase(firstError, 'Tahmini değerler kaydedilemedi.')
        : { type: 'unknown', message: 'Tahmini değerler kaydedilemedi.' },
    )
  }

  if (failed.length > 0) {
    // Kısmi başarı sessiz kalmasın: çağıran özeti kullanmasa bile iz kalsın.
    console.warn(
      `[valuationRepo] ${table}: ${failed.length}/${updates.length} satır güncellenemedi (${failed.map((row) => row.id).join(', ')})`,
    )
  }

  return {
    ok: true,
    data: { requested: updates.length, updated: updates.length - failed.length, failed },
  }
}
