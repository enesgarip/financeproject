import { isMissingSupabaseCapabilityError, type SupabaseLikeError } from '../utils/supabaseErrors'

export type AppErrorType = 'supabase' | 'missing-capability' | 'unknown'

export type AppError = {
  type: AppErrorType
  message: string
  code?: string
  cause?: unknown
}

export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: AppError): Result<T> {
  return { ok: false, error }
}

export function appErrorFromSupabase(error: SupabaseLikeError, fallbackMessage = 'Islem tamamlanamadi.'): AppError {
  const missingCapability = isMissingSupabaseCapabilityError(error)
  return {
    type: missingCapability ? 'missing-capability' : 'supabase',
    message: error.message ?? fallbackMessage,
    code: error.code,
    cause: error,
  }
}

export function resultFromSupabase<T>(
  data: T,
  error: SupabaseLikeError | null | undefined,
  fallbackMessage?: string,
): Result<T> {
  return error ? fail(appErrorFromSupabase(error, fallbackMessage)) : ok(data)
}

export function voidResultFromSupabase(
  error: SupabaseLikeError | null | undefined,
  fallbackMessage?: string,
): Result<void> {
  return resultFromSupabase(undefined, error, fallbackMessage)
}

