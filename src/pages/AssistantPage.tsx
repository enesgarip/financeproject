import { useQuery } from '@tanstack/react-query'
import { Send, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useAiChatMessages, useClearAiChat, useSendAiChatMessage } from '../app/useAiChat'
import { useCars } from '../app/useCars'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { useAuth } from '../auth/useAuth'
import { fetchNetWorthSnapshots, fetchSavingsGoalSnapshots } from '../data/repositories/analysisRepo'
import { fetchContextExpenses, fetchExpenseContexts } from '../data/repositories/expenseContextsRepo'
import { fetchWishlistItems } from '../data/repositories/wishlistRepo'
import { useMarketRates } from '../hooks/useMarketRates'
import { readSafeToSpendBuffer, useKasaBuckets } from '../hooks/useSafeToSpend'
import type { Result } from '../data/result'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { QueryError } from '../components/ui/query-error'
import { Divider, ScreenHeader } from '../components/serit'
import type { AiChatMessage } from '../types/database'
import { buildAiFinanceContext } from '../utils/aiContext'
import { formatDate } from '../utils/date'

/**
 * AI asistan (/analiz/asistan): kullanıcının güncel finansal özetiyle Gemini'ye
 * soru sorduğu tek sürekli sohbet akışı. Şerit diline uygun balonsuz transkript:
 * konuşmacıyı hizalama değil eyebrow etiketi ayırır, mesajlar çizgiyle bölünür.
 * Yanıt sade düz metindir (markdown yok) — whitespace-pre-wrap yeterli.
 */

const SUGGESTIONS = [
  'Bu ayı değerlendir',
  'En çok nereye harcıyorum?',
  'Önümüzdeki ay beni ne bekliyor?',
  'Taksitlerim ne zaman bitiyor?',
  'Aboneliklerime ne kadar gidiyor?',
  'Borçlarımı kapatmak için nasıl bir sıra izlemeliyim?',
]

/** Best-effort ek veri: düşen sorgu bölümünü düşürür, sohbeti asla kilitlemez. */
function dataOrNull<T>(result: PromiseSettledResult<Result<T | null>>): T | null {
  if (result.status !== 'fulfilled' || !result.value.ok) return null
  return result.value.data
}

/**
 * Bağlamın snapshot dışı kaynakları tek sorguda (5 paralel istek): gider
 * bağlamları, alsam-mı listesi, net değer + hedef fotoğrafları. Kur ve kasa
 * kovaları kendi hook'larından gelir (başka ekranlarla paylaşılan cache).
 */
function useAssistantExtras() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['ai-assistant-extras', user?.id],
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [contexts, contextExpenses, wishlist, netWorth, goalSnapshots] = await Promise.allSettled([
        fetchExpenseContexts(),
        fetchContextExpenses(),
        fetchWishlistItems(),
        fetchNetWorthSnapshots(),
        fetchSavingsGoalSnapshots(),
      ])
      return {
        expenseContexts: dataOrNull(contexts),
        contextExpenses: dataOrNull(contextExpenses),
        wishlistItems: dataOrNull(wishlist),
        netWorthSnapshots: dataOrNull(netWorth),
        goalSnapshots: dataOrNull(goalSnapshots),
      }
    },
  })
}

/** Bugünkü mesajda yalnız saat; eski mesajda gün + saat. */
function chatStamp(createdAt: string, now = new Date()) {
  const date = new Date(createdAt)
  const time = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === now.toDateString() ? time : `${formatDate(createdAt.slice(0, 10))} ${time}`
}

function MessageBlock({ message }: { message: AiChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`serit-eyebrow ${isUser ? '' : 'text-primary'}`}>{isUser ? 'Sen' : 'Asistan'}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">{chatStamp(message.created_at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{message.content}</p>
    </div>
  )
}

export function AssistantPage() {
  const snapshotQuery = useFinanceSnapshot()
  const messagesQuery = useAiChatMessages()
  // Bağlam zenginleştiricileri (aiContext): hepsi opsiyoneldir, yüklenmemiş
  // olan yalnız kendi bölümünü düşürür — gönderim hiçbirini beklemez.
  const { snapshot: ratesSnapshot } = useMarketRates()
  const bucketsQuery = useKasaBuckets()
  const carsQuery = useCars()
  const extrasQuery = useAssistantExtras()
  // Güvenlik tamponu cihaz tercihidir (Dashboard'daki kahraman rakamla aynı kaynak).
  const [safeToSpendBuffer] = useState(readSafeToSpendBuffer)
  const send = useSendAiChatMessage()
  const clear = useClearAiChat()

  const [input, setInput] = useState('')
  // Akış sırasında büyüyen yanıt; tamamlanınca DB'ye yazılır ve sıfırlanır.
  // Kopan akışın kısmi metni KAYDEDİLMEZ — "Tekrar dene" sözleşmesi bozulmaz.
  const [streamingText, setStreamingText] = useState('')
  // Gönderim düşerse metin burada tutulur: insert bile başarısızsa retry aynı
  // metinle, insert olduysa metinsiz (çift mesaj olmasın) yeniden dener.
  const [failedText, setFailedText] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  // Mobil klavyede Enter satır eklemeli (gönderme butonla); fiziksel klavyede Enter gönderir.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches),
  )

  const messages = messagesQuery.data ?? []
  const context = useMemo(
    () =>
      snapshotQuery.data
        ? buildAiFinanceContext(snapshotQuery.data, {
            ratesSnapshot,
            kasaBuckets: bucketsQuery.data ?? null,
            safeToSpendBuffer,
            carSummaries: carsQuery.data?.summaries ?? null,
            expenseContexts: extrasQuery.data?.expenseContexts ?? null,
            contextExpenses: extrasQuery.data?.contextExpenses ?? null,
            wishlistItems: extrasQuery.data?.wishlistItems ?? null,
            netWorthSnapshots: extrasQuery.data?.netWorthSnapshots ?? null,
            goalSnapshots: extrasQuery.data?.goalSnapshots ?? null,
          })
        : '',
    [snapshotQuery.data, ratesSnapshot, bucketsQuery.data, safeToSpendBuffer, carsQuery.data, extrasQuery.data],
  )
  const canSend = Boolean(snapshotQuery.data) && !send.isPending

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    endRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' })
  }, [messages.length, send.isPending, streamingText])

  function handleSend(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !canSend) return
    setInput('')
    send.mutate(
      { text: trimmed, history: messages, context, onChunk: setStreamingText },
      {
        onSuccess: () => setFailedText(null),
        onError: () => setFailedText(trimmed),
        onSettled: () => setStreamingText(''),
      },
    )
  }

  function handleRetry() {
    if (!canSend) return
    const lastRole = messages[messages.length - 1]?.role
    if (lastRole === 'user') {
      // Kullanıcı mesajı DB'ye yazılmış: insert atlanır, yalnız yanıt istenir.
      send.mutate(
        { history: messages, context, onChunk: setStreamingText },
        { onSuccess: () => setFailedText(null), onSettled: () => setStreamingText('') },
      )
    } else if (failedText) {
      send.mutate(
        { text: failedText, history: messages, context, onChunk: setStreamingText },
        { onSuccess: () => setFailedText(null), onSettled: () => setStreamingText('') },
      )
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !coarsePointer) {
      event.preventDefault()
      handleSend(input)
    }
  }

  const textareaRows = Math.min(5, Math.max(1, input.split('\n').length))
  const showEmptyState = messagesQuery.isSuccess && messages.length === 0 && !send.isPending

  return (
    <div className="space-y-4">
      <ScreenHeader
        eyebrow="Asistan"
        context={
          messages.length > 0 ? (
            <Button variant="ghost" size="xs" onClick={() => setConfirmClear(true)} disabled={clear.isPending}>
              <Trash2 aria-hidden="true" />
              Geçmişi temizle
            </Button>
          ) : (
            'Gemini · özet veriyle'
          )
        }
      />

      {snapshotQuery.isError ? (
        <QueryError
          title="Finansal özet yüklenemedi"
          message="Asistan verilerine ulaşılamadı; soru gönderme kapalı."
          onRetry={() => snapshotQuery.refetch()}
          retrying={snapshotQuery.isRefetching}
        />
      ) : null}

      {messagesQuery.isError ? (
        <QueryError
          title="Sohbet geçmişi yüklenemedi"
          onRetry={() => messagesQuery.refetch()}
          retrying={messagesQuery.isRefetching}
        />
      ) : null}

      {messagesQuery.isPending && !messagesQuery.isError ? (
        <p className="animate-pulse py-6 text-sm text-ink-muted">Sohbet yükleniyor…</p>
      ) : null}

      {showEmptyState ? (
        <div className="space-y-4 py-4">
          <p className="text-sm leading-6 text-ink-muted">
            Finansal verilerinle konuş: net değer, borç sırası, bu ayın gidişatı… Soruların, uygulamadaki
            güncel özetinle birlikte yanıtlanır.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSend(suggestion)}
                disabled={!canSend}
                className="rounded-full border border-line-strong bg-raised px-3 py-2 text-xs font-semibold text-ink-muted transition hover:bg-black/[.03] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.04]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="space-y-3">
          {messages.map((message, index) => (
            <Fragment key={message.id}>
              {index > 0 ? <Divider space="none" /> : null}
              <MessageBlock message={message} />
            </Fragment>
          ))}
        </div>
      ) : null}

      {send.isPending && streamingText ? (
        <div className="space-y-1">
          {messages.length > 0 ? <Divider space="sm" /> : null}
          <span className="serit-eyebrow text-primary">Asistan</span>
          <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
            {streamingText}
            <span className="ml-0.5 inline-block w-2 animate-pulse text-primary" aria-hidden="true">▍</span>
          </p>
        </div>
      ) : null}

      {send.isPending && !streamingText ? (
        <p className="animate-pulse text-sm text-ink-muted">Asistan yazıyor…</p>
      ) : null}

      {send.isError && !send.isPending ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2">
          <p className="text-sm text-destructive">{send.error.message}</p>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Tekrar dene
          </Button>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          handleSend(input)
        }}
        className="space-y-2"
      >
        <Divider tone="strong" space="sm" />
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={textareaRows}
            maxLength={2000}
            placeholder={snapshotQuery.data ? 'Finansal durumun hakkında soru sor…' : 'Finansal özet yükleniyor…'}
            disabled={send.isPending || !snapshotQuery.data}
            aria-label="Asistana mesaj"
            className="min-h-11 w-full resize-none rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-sm leading-6 text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
          <Button type="submit" size="icon" disabled={!canSend || !input.trim()} aria-label="Gönder">
            <Send aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs leading-5 text-ink-faint">
          Soruların ve finansal özetin yanıt üretmek için Google Gemini'ye gönderilir.
        </p>
      </form>
      <div ref={endRef} aria-hidden="true" />

      <ConfirmDialog
        open={confirmClear}
        title="Sohbet geçmişi silinsin mi?"
        description="Tüm konuşma kalıcı olarak silinir; finansal verilerine dokunulmaz."
        confirmLabel="Geçmişi sil"
        variant="destructive"
        loading={clear.isPending}
        onConfirm={() =>
          clear.mutate(undefined, {
            onSettled: () => setConfirmClear(false),
          })
        }
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
