export type SupabaseLikeError = {
  code?: string
  message?: string
  type?: string
}

export function isMissingSupabaseCapabilityError(error: SupabaseLikeError | null | undefined) {
  if (!error) return false
  const message = error.message ?? ''

  return (
    error.type === 'missing-capability' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('Could not find the table') ||
    message.includes('Could not find the function')
  )
}

export function missingSupabaseCapabilityMessage(featureLabel: string, error?: SupabaseLikeError | null) {
  const code = error?.code ? ` Supabase kodu: ${error.code}.` : ''
  return `${featureLabel} canlı veritabanında henüz görünmüyor. Beklenen migration/RPC deploy edilince bu işlem açılacak.${code}`
}
