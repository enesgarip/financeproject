/**
 * "Hangi kartla alayım?" — kartlar arası kesim kıyası (saf).
 *
 * `buildPurchaseTimingHint` tek kart için "bugün alırsan N gün sonra ödersin"i
 * zaten biliyor; burada aynı hesap TÜM kredi kartlarına uygulanıp kıyasa
 * çevrilir. Kullanılabilir limit kartın kendi limitinden DEĞİL, ortak-limit
 * grubunun available'ından okunur (buildCreditLimitGroups — ortak limitte max
 * alınır, toplam değil); kartın kendi limitiyle kıyas ortak limitli ikinci
 * kartı yanlış yeşil/soluk gösterirdi.
 *
 * Tek kredi kartında kıyas anlamsız → boş dizi (şerit susar). Kesim/vade günü
 * eksik kart kıyasa giremez ama listede kalır (hasSchedule=false, soluk) —
 * QuickExpensePanel'in mevcut "Gün eksik" diliyle tutarlı.
 */
import type { Card } from '../types/database'
import { buildCreditLimitGroups, creditLimitGroupKey } from './financeSummary'
import { diffTL } from './money'
import { buildPurchaseTimingHint } from './purchaseTiming'

export type CardTimingChoice = {
  cardId: string
  label: string
  /** Bugün alırsan ilk ödemeye kalan gün; gün bilgisi eksik kartta null. */
  daysUntilDue: number | null
  dueDate: string | null
  /** Ortak-limit grubunun kullanılabilir limiti tutarı karşılıyor mu (tutar ≤ 0 ise hep true). */
  fitsLimit: boolean
  /** Geçerli (günü tanımlı + limiti yeten) kartlar içinde ödemeyi en geç yaptıran. */
  isBest: boolean
  hasSchedule: boolean
}

export function buildCardTimingChoices(cards: Card[], amount: number, today: Date = new Date()): CardTimingChoice[] {
  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')
  if (creditCards.length < 2) return []

  const groups = buildCreditLimitGroups(cards)
  const rows = creditCards.map((card) => {
    const hint = buildPurchaseTimingHint(card, today)
    const group = groups.find((item) => item.key === creditLimitGroupKey(card))
    const available = group ? group.available : Math.max(0, diffTL(card.credit_limit, card.debt_amount))
    const choice: CardTimingChoice = {
      cardId: card.id,
      label: `${card.bank_name} ${card.card_name}`.trim(),
      daysUntilDue: hint?.daysUntilDue ?? null,
      dueDate: hint?.dueDate ?? null,
      fitsLimit: amount <= 0 || available >= amount,
      isBest: false,
      hasSchedule: hint !== null,
    }
    return { choice, available }
  })

  // En geç ödeten: yalnız günü tanımlı + limiti yeten kartlar yarışır;
  // eşitlikte kullanılabilir limiti büyük olan kazanır.
  const eligible = rows.filter((row) => row.choice.hasSchedule && row.choice.fitsLimit)
  if (eligible.length > 0) {
    const best = eligible.reduce((a, b) => {
      const aDays = a.choice.daysUntilDue ?? -1
      const bDays = b.choice.daysUntilDue ?? -1
      if (bDays !== aDays) return bDays > aDays ? b : a
      return b.available > a.available ? b : a
    })
    best.choice.isBest = true
  }

  // Sıralama: günü tanımlılar kalan güne göre çoktan aza, günü eksikler sonda.
  return rows
    .sort((a, b) => {
      if (a.choice.hasSchedule !== b.choice.hasSchedule) return a.choice.hasSchedule ? -1 : 1
      return (b.choice.daysUntilDue ?? 0) - (a.choice.daysUntilDue ?? 0)
    })
    .map((row) => row.choice)
}
