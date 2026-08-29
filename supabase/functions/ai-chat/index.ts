// Supabase Edge Function: ai-chat
// AI finans asistanı (/analiz/asistan): istemci sohbet geçmişini (≤30 tur) ve
// finansal özet metnini gönderir; bu fonksiyon Gemini Flash'ı STREAMING
// (streamGenerateContent, SSE) çağırıp yanıtı chunk chunk iletir. Anahtar
// istemciye ASLA inmez. DB'ye DOKUNMAZ — kalıcılık istemcide (aiChatRepo, RLS).
// verify_jwt varsayılan true kalır (config.toml'a blok YOK): kullanıcı JWT'siz çağrılamaz.
//
// Yanıt sözleşmesi (istemci: lib/aiChatClient.ts):
//   Akış başlamadan hata  -> mevcut JSON sözlüğü (400/413/422/429/500/502)
//   Akış (200, text/event-stream):
//     data: {"text":"..."}   0..n kez, sıralı parça
//     data: {"done":true}    tam bitiş — bunsuz biten akış İSTEMCİDE hatadır
//     data: {"error":"..."}  akış içi hata (SAFETY, kaynak kopması)
//
// Deploy:  supabase functions deploy ai-chat
// Secret:  GEMINI_API_KEY (parse-receipt / parse-statement ile aynı anahtar)

import { CORS_HEADERS, fetchWithTimeout, handlePreflight, jsonResponse, rateLimit } from '../_shared/edge.ts'

const MODEL = 'gemini-2.5-flash'
// Sohbet yanıtı parse işlerinden (25/30 sn) uzun sürebilir; maxOutputTokens
// freniyle pratik yanıt 5-15 sn, 45 sn güvenli üst sınır.
const GEMINI_TIMEOUT_MS = 45_000
const MAX_MESSAGES = 30
const MAX_MESSAGE_CHARS = 8_000
const MAX_CONTEXT_CHARS = 24_000
// DB check'i 16384; kırpma insert'i asla patlatmasın diye altında kalır.
const MAX_REPLY_CHARS = 16_000

const SYSTEM_PROMPT = `Sen "Denge" adlı kişisel finans uygulamasının içinde çalışan Türkçe finans asistanısın. Kullanıcı tek kişidir; tüm tutarlar Türk Lirası (TL) cinsindendir. Aşağıda kullanıcının uygulamadaki verilerinden üretilmiş güncel finansal özet var.
Kurallar:
1) SADECE sade düz metin yaz. Markdown kullanma: başlık işareti (#), yıldız (*), tire ile liste, tablo, kod bloğu YASAK. Paragrafları boş satırla ayır; sıralama gerekirse "1)" "2)" biçiminde yaz.
2) Kısa ve net ol: basit soruya 1-3 cümle, değerlendirme sorusuna en fazla birkaç kısa paragraf. Tutarları "12.480 TL" biçiminde yaz.
3) Yalnızca verilen özetteki verilere dayan. Özette olmayan bilgiyi uydurma; göremediğin veri için "bu veriyi göremiyorum" de.
4) Lisanslı bir finansal danışman değilsin; belirli bir hisse/döviz/altın al-sat tavsiyesi veremezsin. Böyle bir soru gelirse genel çerçeve sun ve kararın kullanıcıya ait olduğunu tek cümleyle hatırlat — bu uyarıyı her mesajda tekrarlama.
5) Bütçe, borç kapatma önceliği, nakit akışı ve tasarruf planlaması gibi konularda kullanıcının KENDİ rakamlarına dayalı pratik değerlendirme yapabilirsin.`

type ChatTurn = { role: 'user' | 'assistant'; content: string }

/** Gövdeyi doğrulayıp normalize eder; hata durumunda Türkçe mesajlı Response döner. */
function parseBody(raw: unknown): { turns: ChatTurn[]; context: string } | Response {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'Geçersiz mesaj listesi.' }, 400)
  }

  const turns: ChatTurn[] = []
  for (const item of body.messages) {
    const m = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const role = m.role === 'user' || m.role === 'assistant' ? m.role : null
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    if (!role || !content) return jsonResponse({ error: 'Geçersiz mesaj listesi.' }, 400)
    if (content.length > MAX_MESSAGE_CHARS) return jsonResponse({ error: 'Mesaj çok uzun.' }, 413)
    turns.push({ role, content })
  }
  // Pencereyi sunucu da uygular (istemci sözleşmesine güvenme): son 30 tur.
  const windowed = turns.slice(-MAX_MESSAGES)
  if (windowed[windowed.length - 1].role !== 'user') {
    return jsonResponse({ error: 'Son mesaj kullanıcıya ait olmalı.' }, 400)
  }

  const context = typeof body.context === 'string' ? body.context : ''
  if (context.length > MAX_CONTEXT_CHARS) return jsonResponse({ error: 'Finansal özet çok büyük.' }, 413)

  return { turns: windowed, context }
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  // Gemini'yi çağıran pahalı uç — ücretsiz katman ~10 RPM; Google 429'undan
  // önce kendi Türkçe frenimiz düşsün.
  const limited = rateLimit(req, { bucket: 'ai-chat', max: 8, windowMs: 60_000 })
  if (limited) return limited
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY tanımlı değil.' }, 500)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonResponse({ error: 'Geçersiz istek gövdesi.' }, 400)
  }

  const parsed = parseBody(raw)
  if (parsed instanceof Response) return parsed
  const { turns, context } = parsed

  const today = new Date().toISOString().slice(0, 10)
  const systemText = [
    SYSTEM_PROMPT,
    `Bugünün tarihi: ${today}.`,
    '--- KULLANICININ FİNANSAL ÖZETİ ---',
    context || '(özet gönderilmedi)',
  ].join('\n\n')

  // API anahtarı query-string'de DEĞİL header'da: URL'ler proxy/erişim
  // loglarında görünür, anahtar oraya sızmasın (denetim 2026-08-12 §8).
  // ?alt=sse anahtar değil format seçicidir, logda görünmesi zararsız.
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`
  const payload = {
    systemInstruction: { parts: [{ text: systemText }] },
    // Gemini 'assistant' rolünü tanımaz: model/user ikilisine eşlenir.
    contents: turns.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    // thinkingBudget 0: 2.5-flash'ın varsayılan "düşünme" adımı sohbette
    // gecikme + token yakar; kapatınca yanıt hızlanır (üretimde teyitli).
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  }

  // fetchWithTimeout yalnız BAĞLANTI kurulumunu sınırlar (finally clearTimeout):
  // gövde akışı serbest kalır, üst sınırı platformun function timeout'u koyar.
  let res: Response
  try {
    res = await fetchWithTimeout(
      endpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(payload) },
      GEMINI_TIMEOUT_MS,
    )
  } catch {
    return jsonResponse({ error: 'Yanıt alınamadı, tekrar dene.' }, 502)
  }
  if (res.status === 429) {
    // Ücretsiz katman kotası — en olası üretim hatası; mesaj istemciye aynen ulaşır.
    return jsonResponse({ error: 'Yapay zekâ kotası doldu. Bir dakika sonra ya da yarın tekrar dene.' }, 429)
  }
  if (!res.ok || !res.body) return jsonResponse({ error: `Gemini hatası (${res.status}).` }, 502)
  const source = res.body

  // Gemini SSE'si satır satır ayrıştırılıp kendi küçük event sözleşmemize
  // çevrilir; Gemini'nin ham şeması istemciye sızmaz.
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      let buffer = ''
      let sentChars = 0
      let blocked = false

      const handleLine = (line: string) => {
        if (!line.startsWith('data:')) return
        const raw = line.slice(5).trim()
        if (!raw) return
        let chunk: unknown
        try {
          chunk = JSON.parse(raw)
        } catch {
          return
        }
        const obj = (chunk && typeof chunk === 'object' ? chunk : {}) as {
          promptFeedback?: { blockReason?: unknown }
          candidates?: { finishReason?: unknown; content?: { parts?: unknown } }[]
        }
        const candidate = obj.candidates?.[0]
        if (obj.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') {
          blocked = true
          return
        }
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
        const text = parts
          .map((part) => {
            const t = (part as { text?: unknown })?.text
            return typeof t === 'string' ? t : ''
          })
          .join('')
        if (!text || sentChars >= MAX_REPLY_CHARS) return
        // DB check'i (16384) akışta da aşılmasın: tavana ulaşınca kalan kırpılır.
        const clipped = text.slice(0, MAX_REPLY_CHARS - sentChars)
        sentChars += clipped.length
        send({ text: clipped })
      }

      try {
        const reader = source.getReader()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline = buffer.indexOf('\n')
          while (newline >= 0) {
            handleLine(buffer.slice(0, newline).trim())
            buffer = buffer.slice(newline + 1)
            newline = buffer.indexOf('\n')
          }
          if (blocked) break
        }
        if (!blocked) handleLine(buffer.trim())

        if (blocked) send({ error: 'Bu soruya yanıt üretilemedi, farklı biçimde sormayı dene.' })
        else if (sentChars > 0) send({ done: true })
        else send({ error: 'Yanıt çözümlenemedi, tekrar dene.' })
      } catch {
        // Kaynak koptu; done GİTMEZ — istemci bunu hata sayar. enqueue de
        // istemci kopmuşsa fırlatabilir, sessiz yutulur.
        try {
          send({ error: 'Yanıt alınamadı, tekrar dene.' })
        } catch {
          /* istemci de koptu */
        }
      } finally {
        try {
          controller.close()
        } catch {
          /* zaten kapalı */
        }
      }
    },
    cancel() {
      source.cancel().catch(() => {})
    },
  })

  return new Response(out, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
})
