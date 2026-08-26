// İstemci hata kayıtları (client_errors — Sentry'siz izleme). Yazan taraf
// lib/errorReport (lib katmanı, doğrudan supabase); burası yalnız DataHealth
// yüzeyinin OKUMA + temizleme yolu.
import { supabase } from '../../lib/supabase'
import type { ClientError } from '../../types/database'
import { resultFromSupabase, type Result } from '../result'

export async function fetchRecentClientErrors(days = 7, limit = 50): Promise<Result<ClientError[]>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('client_errors')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as ClientError[], error, 'İstemci hata kayıtları yüklenemedi.')
}

export async function clearClientErrors(): Promise<Result<null>> {
  // RLS zaten kendi satırlarına daraltır; tarih filtresi "tümü" için alt sınır.
  const { error } = await supabase.from('client_errors').delete().gte('created_at', '1970-01-01')
  return resultFromSupabase(null, error, 'İstemci hata kayıtları temizlenemedi.')
}
