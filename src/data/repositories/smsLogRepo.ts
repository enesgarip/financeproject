import { supabase } from '../../lib/supabase'
import type { SmsLog } from '../../types/database'
import { resultFromSupabase, type Result } from '../result'

export async function fetchSmsLog(limit = 20): Promise<Result<SmsLog[]>> {
  const { data, error } = await supabase
    .from('sms_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as SmsLog[], error, 'SMS geçmişi yüklenemedi.')
}

/** Tanınamayan SMS'ler: hangi formatların kaçtığını çıkarmak için ham metinler. */
export async function fetchUnrecognizedSmsLog(limit = 50): Promise<Result<SmsLog[]>> {
  const { data, error } = await supabase
    .from('sms_log')
    .select('*')
    .eq('sms_type', 'unrecognized')
    .order('created_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as SmsLog[], error, 'Tanınamayan SMS listesi yüklenemedi.')
}
