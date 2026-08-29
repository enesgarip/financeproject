// ai-chat edge function istemcisi (AI asistan). Sohbet penceresi + finansal
// özet gönderilir, sade metin yanıt döner. Anahtar/secret istemcide YOK;
// yetki kullanıcı JWT'siyle (verify_jwt) sağlanır.
import { supabase } from './supabase'
import { edgeErrorMessage } from './statementParseClient'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function sendAiChat(messages: ChatTurn[], context: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { messages, context },
  })

  if (error) {
    throw new Error(await edgeErrorMessage(error, 'Yanıt alınamadı, tekrar dene.'))
  }

  const reply = (data as { reply?: unknown } | null)?.reply
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error('Yanıt çözümlenemedi, tekrar dene.')
  }
  return reply
}
