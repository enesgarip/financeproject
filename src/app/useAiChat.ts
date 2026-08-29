// AI asistan sohbet akışı (/analiz/asistan): geçmiş sorgusu + gönderim
// mutation'ı + temizleme. Kalıcılık aiChatRepo (RLS), yanıt aiChatClient (edge).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '../auth/useAuth'
import { clearAiChatMessages, fetchAiChatMessages, insertAiChatMessage } from '../data/repositories/aiChatRepo'
import { sendAiChat, type ChatTurn } from '../lib/aiChatClient'
import type { AiChatMessage } from '../types/database'

export const aiChatKey = (userId?: string) => ['ai-chat', userId ?? 'anon'] as const

/** Edge'e giden pencere; sunucu da aynı sınırı uygular (çift emniyet). */
const CHAT_WINDOW = 30

export function useAiChatMessages() {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: aiChatKey(userId),
    enabled: Boolean(user),
    queryFn: async (): Promise<AiChatMessage[]> => {
      const result = await fetchAiChatMessages()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })
}

export type SendAiChatInput = {
  /**
   * Yeni kullanıcı mesajı. BOŞ bırakılırsa "tekrar dene" yolu: son mesaj zaten
   * 'user' rolünde DB'de durur, insert atlanıp yalnız yanıt istenir — çifte
   * kullanıcı mesajı riski böylece sıfır.
   */
  text?: string
  history: AiChatMessage[]
  context: string
  /** Akış sırasında büyüyen TAM metinle çağrılır (canlı gösterim için). */
  onChunk?: (partial: string) => void
}

export function useSendAiChatMessage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useMutation({
    mutationFn: async ({ text, history, context, onChunk }: SendAiChatInput) => {
      let turns: ChatTurn[] = history.map((message) => ({ role: message.role, content: message.content }))

      const trimmed = text?.trim()
      if (trimmed) {
        const inserted = await insertAiChatMessage('user', trimmed)
        if (!inserted.ok) throw new Error(inserted.error.message)
        // Kullanıcı mesajı Gemini yanıtı beklenirken listede görünsün.
        void queryClient.invalidateQueries({ queryKey: aiChatKey(userId) })
        turns = [...turns, { role: 'user', content: trimmed }]
      }

      // Yanıt gelmeden düşersek kullanıcı mesajı DB'de KALIR (bilinçli sözleşme):
      // geçmiş kaybolmaz, UI "Tekrar dene" ile text'siz yeniden çağırır.
      const reply = await sendAiChat(turns.slice(-CHAT_WINDOW), context, onChunk)

      const saved = await insertAiChatMessage('assistant', reply)
      if (!saved.ok) throw new Error(saved.error.message)
      return saved.data
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiChatKey(userId) }),
  })
}

export function useClearAiChat() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useMutation({
    mutationFn: async () => {
      const result = await clearAiChatMessages()
      if (!result.ok) throw new Error(result.error.message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiChatKey(userId) }),
  })
}

/** Sohbete dışarıdan yazan olursa cache'i tazelemek için (şimdilik sayfa içi kullanım). */
export function useInvalidateAiChat() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id

  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: aiChatKey(userId) }),
    [queryClient, userId],
  )
}
