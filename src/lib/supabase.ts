import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Env eksikse client bir PLACEHOLDER projeye bağlanır: uygulama açılır ama her
 * istek anlamsız bir ağ/auth hatasıyla düşer.
 *
 * Bulgu (Faz F): uyarı `import.meta.env.DEV` ile korunuyordu, yani env'i eksik
 * bir PRODUCTION build tamamen sessiz kalıyordu — "giriş yapılamıyor" şikâyeti
 * konfigürasyon hatasına değil, koda bakılarak aranıyordu. Uyarı artık üretimde
 * de basılır (console.error, gerçek bir arıza) ve `supabaseConfigured` ile
 * programatik olarak sorulabilir.
 */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!supabaseConfigured) {
  const missing = [
    supabaseUrl ? null : 'VITE_SUPABASE_URL',
    supabaseAnonKey ? null : 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ')
  console.error(
    `[supabase] ${missing} tanımlı değil — veri katmanı çalışmayacak (placeholder client). ` +
    'Vercel/`.env.local` ortam değişkenlerini kontrol et.',
  )
}

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://example.supabase.co',
  supabaseAnonKey ?? 'missing-supabase-key',
)
