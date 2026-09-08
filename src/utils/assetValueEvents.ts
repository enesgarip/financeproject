import type { AssetValueEvent } from '../types/database'
import { toTL } from './money'

/**
 * Manuel varlık değer olaylarının (BES, Araç, Fon, Diğer) saf türetimi.
 *
 * Her olay "önceki değer → yeni değer" + o dönemde yatırılan katkıyı taşır.
 * Getiri = Δdeğer − katkı: BES'te aylık katkı payı değer artışının içinde
 * durur; onu ayırmadan "ne kazandım" söylenemez. Yüzde tabanı dönem başı
 * değer + katkı (o dönemde yatırımda duran para); taban 0 ise yüzde yok.
 *
 * Toplam getiri satırların toplamıdır (uç değer farkı değil): olay zinciri
 * kopuksa (eski kayıt, silinmiş satır) uç fark hayalet kazanç üretirdi.
 */
export type AssetValueEventLike = Pick<
  AssetValueEvent,
  'occurred_at' | 'value_before_kurus' | 'value_after_kurus' | 'contribution_kurus'
>

export type AssetValueRow<TEvent extends AssetValueEventLike = AssetValueEventLike> = {
  event: TEvent
  /** Dönem başı = bir önceki olayın tarihi; ilk olayda null. */
  periodStart: string | null
  valueBefore: number
  valueAfter: number
  delta: number
  contribution: number
  growth: number
  growthPct: number | null
}

export type AssetValueSummary = {
  count: number
  firstAt: string | null
  lastAt: string | null
  startValue: number
  endValue: number
  totalContribution: number
  totalGrowth: number
  growthPct: number | null
}

function sortAscending<TEvent extends AssetValueEventLike>(events: TEvent[]): TEvent[] {
  return [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
}

function pct(growthKurus: number, baseKurus: number): number | null {
  if (baseKurus <= 0) return null
  return Math.round((growthKurus / baseKurus) * 10000) / 100
}

/** Olayları EN YENİ ÖNCE satırlara çevirir; dönem başı bir önceki olaydan gelir. */
export function buildAssetValueRows<TEvent extends AssetValueEventLike>(events: TEvent[]): AssetValueRow<TEvent>[] {
  const ascending = sortAscending(events)
  const rows: AssetValueRow<TEvent>[] = ascending.map((event, index) => {
    const deltaKurus = event.value_after_kurus - event.value_before_kurus
    const growthKurus = deltaKurus - event.contribution_kurus
    return {
      event,
      periodStart: index > 0 ? ascending[index - 1].occurred_at : null,
      valueBefore: toTL(event.value_before_kurus),
      valueAfter: toTL(event.value_after_kurus),
      delta: toTL(deltaKurus),
      contribution: toTL(event.contribution_kurus),
      growth: toTL(growthKurus),
      growthPct: pct(growthKurus, event.value_before_kurus + event.contribution_kurus),
    }
  })
  return rows.reverse()
}

/**
 * Dönem özeti. `since` verilirse yalnız o tarihten (dahil) sonraki olaylar
 * sayılır — "son 12 ay" gibi pencereler için; başlangıç değeri penceredeki ilk
 * olayın öncesi olur.
 */
export function summarizeAssetValueEvents(events: AssetValueEventLike[], options?: { since?: string | null }): AssetValueSummary {
  const since = options?.since ?? null
  const ascending = sortAscending(events).filter((event) => (since ? event.occurred_at >= since : true))
  if (ascending.length === 0) {
    return { count: 0, firstAt: null, lastAt: null, startValue: 0, endValue: 0, totalContribution: 0, totalGrowth: 0, growthPct: null }
  }
  let contributionKurus = 0
  let growthKurus = 0
  for (const event of ascending) {
    contributionKurus += event.contribution_kurus
    growthKurus += event.value_after_kurus - event.value_before_kurus - event.contribution_kurus
  }
  const startKurus = ascending[0].value_before_kurus
  return {
    count: ascending.length,
    firstAt: ascending[0].occurred_at,
    lastAt: ascending[ascending.length - 1].occurred_at,
    startValue: toTL(startKurus),
    endValue: toTL(ascending[ascending.length - 1].value_after_kurus),
    totalContribution: toTL(contributionKurus),
    totalGrowth: toTL(growthKurus),
    growthPct: pct(growthKurus, startKurus + contributionKurus),
  }
}
