import { describe, expect, it } from 'vitest'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from './supabaseErrors'

describe('supabaseErrors', () => {
  it('detects missing schema/RPC capability errors', () => {
    expect(isMissingSupabaseCapabilityError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingSupabaseCapabilityError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingSupabaseCapabilityError({ message: 'Could not find the function public.pay_card_statement in the schema cache' })).toBe(true)
    expect(isMissingSupabaseCapabilityError({ message: 'permission denied for table cards' })).toBe(false)
    expect(isMissingSupabaseCapabilityError(null)).toBe(false)
  })

  it('formats a deployment-mismatch message with the Supabase code when available', () => {
    expect(missingSupabaseCapabilityMessage('Ekstre ödeme altyapısı', { code: 'PGRST202' })).toBe(
      'Ekstre ödeme altyapısı canlı veritabanında henüz görünmüyor. Beklenen migration/RPC deploy edilince bu işlem açılacak. Supabase kodu: PGRST202.',
    )
  })

  it('omits the code suffix when Supabase does not provide one', () => {
    expect(missingSupabaseCapabilityMessage('Transfer altyapısı')).toBe(
      'Transfer altyapısı canlı veritabanında henüz görünmüyor. Beklenen migration/RPC deploy edilince bu işlem açılacak.',
    )
  })
})
