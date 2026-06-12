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
