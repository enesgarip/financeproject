// ai-chat edge function istemcisi (AI asistan). Sohbet penceresi + finansal
// özet gönderilir, yanıt SSE olarak chunk chunk gelir (onChunk büyüyen tam
// metni alır). supabase.functions.invoke akışı desteklemediği için aynı
// origin'e ham fetch kullanılır — CSP connect-src zaten bu origin'e izinli.
// Anahtar/secret istemcide YOK; yetki kullanıcı JWT'siyle (verify_jwt) sağlanır.
//
// Sunucu sözleşmesi (supabase/functions/ai-chat):
//   data: {"text":"..."}  sıralı parça  ·  data: {"done":true}  tam bitiş
//   data: {"error":"..."} akış içi hata — done gelmeden biten akış HATADIR
//   (kısmi metin çağırana dönmez; "Tekrar dene" sözleşmesi bozulmaz).
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const FALLBACK_ERROR = 'Yanıt alınamadı, tekrar dene.'

/**
 * Boşta-kalma sınırı: sunucunun 45 sn'lik zaman aşımı yalnız BAĞLANTI kurulumunu
 * kapsar; akış ortasında ağ askıda kalırsa read() süresiz bekler ve arayüz
 * "Asistan yazıyor…"da kilitlenirdi. Chunk'lar arası bu kadar sessizlik = iptal
 * ("Tekrar dene" sözleşmesine düşer). Normal üretimde chunk aralığı ~saniyedir.
 */
const STREAM_IDLE_TIMEOUT_MS = 30_000

export async function sendAiChat(
  messages: ChatTurn[],
  context: string,
  onChunk?: (partial: string) => void,
): Promise<string> {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase yapılandırması eksik.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Oturum bulunamadı, yeniden giriş yap.')

  const controller = new AbortController()
  let idleTimer = 0
  const resetIdleTimer = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS)
  }
  resetIdleTimer()

  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ messages, context }),
      signal: controller.signal,
    })
  } catch (error) {
    window.clearTimeout(idleTimer)
    throw error instanceof DOMException && error.name === 'AbortError' ? new Error(FALLBACK_ERROR) : error
  }

  if (!res.ok) {
    // Akış başlamadan düşen istek JSON hata gövdesi taşır (Türkçe sözlük).
    let message = FALLBACK_ERROR
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error.trim()) message = body.error
    } catch {
      /* gövde JSON değilse fallback */
    } finally {
      window.clearTimeout(idleTimer)
    }
    throw new Error(message)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    window.clearTimeout(idleTimer)
    throw new Error(FALLBACK_ERROR)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finished = false
  let streamError: string | null = null

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.slice(5).trim()
    if (!raw) return
    let event: unknown
    try {
      event = JSON.parse(raw)
    } catch {
      return
    }
    const e = event as { text?: unknown; done?: unknown; error?: unknown }
    if (typeof e.error === 'string' && e.error.trim()) {
      streamError = e.error
    } else if (e.done === true) {
      finished = true
    } else if (typeof e.text === 'string' && e.text) {
      full += e.text
      onChunk?.(full)
    }
  }

  try {
    while (!finished && !streamError) {
      const { value, done } = await reader.read()
      if (done) break
      resetIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline).trim())
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
  } catch {
    throw new Error(FALLBACK_ERROR)
  } finally {
    window.clearTimeout(idleTimer)
    reader.cancel().catch(() => {})
  }

  if (streamError) throw new Error(streamError)
  // done sinyalsiz biten akış = sunucu/ağ yarıda kesti; kısmi metin KAYDEDİLMEZ.
  if (!finished || !full.trim()) throw new Error(FALLBACK_ERROR)
  return full.trim()
}
