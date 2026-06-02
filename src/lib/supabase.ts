import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if ((!supabaseUrl || !supabaseAnonKey) && import.meta.env.DEV) {
  // Kept visible in development so setup problems are obvious before deploy.
  console.warn('VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlı değil.')
}

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://example.supabase.co',
  supabaseAnonKey ?? 'missing-supabase-key',
)
