import { supabase } from './supabase'
import { suggestExpenseCategory, type CategoryMemory } from '../utils/categories'
import type { ParsedStatement, ParsedTransaction } from '../utils/denizBankStatementParser'

/**
 * Banka-bağımsız ekstre çözümleme (roadmap Y3). PDF'ten çıkarılan düz metni
 * `parse-statement` edge fonksiyonuna (Gemini, server-side) gönderir ve mevcut
 * `ParsedStatement` şekline çevirir — böylece eşleştirme/inceleme/import UI'sı
 * aynen yeniden kullanılır. DenizBank için istemci yerel parser'ı kullanır;
 * bu yol DİĞER bankalar için fallback'tir.
 *
 * Kategori burada (suggestExpenseCategory) atanır, LLM'den DEĞİL — uygulamanın
 * geri kalanıyla tutarlı kalsın. Metin yalnız çözümleme için sunucuya gider,
 * saklanmaz.
 */

type RawTx = {
  date: string
  description: string
  amount: number
  installmentNo: number
  installmentCount: number
}
type RawStatement = {
  statementDate: string
  dueDate: string
  totalDebt: number
  transactions: RawTx[]
}

/** Edge fonksiyonu sonucunu (kategorisiz) uygulamanın ParsedStatement tipine çevirir.
 *  memory: kullanıcının geçmiş harcamalarından öğrenilen (açıklama → kategori) haritası;
 *  verilmezse yalnız anahtar kelime sözlüğü kullanılır. */
export function mapStatementResult(raw: RawStatement, memory?: CategoryMemory): ParsedStatement {
  const transactions: ParsedTransaction[] = raw.transactions
    .filter((tx) => Number.isFinite(tx.amount) && tx.amount > 0)
    .map((tx) => {
      const count = Number.isFinite(tx.installmentCount) ? Math.max(0, Math.trunc(tx.installmentCount)) : 0
      const no = Number.isFinite(tx.installmentNo) ? Math.max(1, Math.trunc(tx.installmentNo)) : 1
      const description = (tx.description ?? '').trim()
      return {
        date: tx.date ?? '',
        description,
        amount: tx.amount,
        category: suggestExpenseCategory(description, memory) ?? 'Diğer',
        isInstallment: count > 1,
        installmentNo: no,
        installmentCount: count,
        // Edge (LLM) yolu kalan borç döndürmez → null; notasyon tutarlılık
        // kontrolü bu yolda çalışmaz (adede eskisi gibi güvenilir).
        remainingDebt: null,
      }
    })

  return {
    cardLastFour: '',
    statementDate: raw.statementDate ?? '',
    dueDate: raw.dueDate ?? '',
    totalDebt: Number.isFinite(raw.totalDebt) ? raw.totalDebt : 0,
    transactions,
  }
}

/**
 * FunctionsHttpError.context ham `Response` nesnesidir; edge'in JSON hata
 * gövdesine (`{ error: "..." }`) ancak `await context.json()` ile ulaşılır.
 * Eski `context?.error` deseni her zaman undefined kalıp spesifik Türkçe
 * hatayı (örn. Gemini kota mesajı) yutuyordu (denetim 2026-08-12 O3).
 */
export async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown })?.context
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown }
      if (typeof body?.error === 'string' && body.error.trim()) return body.error
    } catch {
      /* gövde JSON değilse fallback'e düş */
    }
  }
  return fallback
}

/** Ekstre metnini edge fonksiyonuna gönderir ve ParsedStatement döndürür. */
export async function parseStatementText(text: string, memory?: CategoryMemory): Promise<ParsedStatement> {
  const { data, error } = await supabase.functions.invoke('parse-statement', {
    body: { text },
  })

  if (error) {
    throw new Error(await edgeErrorMessage(error, 'Ekstre okunamadı, tekrar dene.'))
  }
  const result = (data as { result?: RawStatement } | null)?.result
  if (!result) throw new Error('Ekstre çözümlenemedi.')
  return mapStatementResult(result, memory)
}
