// AI asistan sohbet geçmişi (ai_chat_messages). Tek sürekli akış; thread yok.
// Edge function (ai-chat) DB'ye dokunmaz — kalıcılık tamamen bu repo üzerinden,
// RLS altında (user_id default auth.uid(), istemci kolonu göndermez).
import { supabase } from '../../lib/supabase'
import type { AiChatMessage, AiChatRole } from '../../types/database'
import { resultFromSupabase, type Result } from '../result'

export async function fetchAiChatMessages(limit = 100): Promise<Result<AiChatMessage[]>> {
  // Son N mesajı çekip kronolojiye çeviririz; id ikincil sırası aynı-an
  // insert'lerinde (soru + yanıt) kararlılık sağlar.
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  const rows = ((data ?? []) as AiChatMessage[]).slice().reverse()
  return resultFromSupabase(rows, error, 'Sohbet geçmişi yüklenemedi.')
}

export async function insertAiChatMessage(role: AiChatRole, content: string): Promise<Result<AiChatMessage>> {
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .insert({ role, content })
    .select()
    .single()

  return resultFromSupabase(data as AiChatMessage, error, 'Mesaj kaydedilemedi.')
}

export async function clearAiChatMessages(): Promise<Result<null>> {
  // RLS zaten kendi satırlarına daraltır; tarih filtresi "tümü" için alt sınır.
  const { error } = await supabase.from('ai_chat_messages').delete().gte('created_at', '1970-01-01')
  return resultFromSupabase(null, error, 'Sohbet geçmişi temizlenemedi.')
}
