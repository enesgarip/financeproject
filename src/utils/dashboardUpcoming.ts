/**
 * obligations.ts'in ham yükümlülük listesini dashboard'ın "yaklaşan hareketler"
 * listesine uyarlar (buildDashboardUpcomingItems → önümüzdeki N gün; çıkışlar +
 * maaş girişi). Her kalemi UI'nin beklediği şekle (formatlı tutar,
 * sadeleştirilmiş kind) çevirir.
 * Burada iş kuralı YOK; sadece obligations çıktısının sunum dönüşümü.
 */
import { formatDate } from './date'
import { sumTL } from './money'
import { formatSeritAmount } from './formatCurrency'
import {
  buildFinanceObligationsForRange,
  type FinanceObligation,
  type FinanceObligationsInput,
  type FinanceObligationSettlement,
} from './obligations'

export type DashboardUpcomingItem = {
  id: string
  title: string
  subtitle: string
  value: string
  amount: number
  cashImpactAmount: number
  settlement: FinanceObligationSettlement
  kind: 'payment' | 'card' | 'loan' | 'debt' | 'salary'
  direction: 'inflow' | 'outflow'
  date: string
  sortTime: number
  // Kaynak yükümlülük: dashboard'dan yerinde ödeme çekmecesini açmak için taşınır
  // (yalnız `action` taşıyan kalemler ödenebilir). Sunum alanları yukarıda türetilir.
  obligation: FinanceObligation
  children?: DashboardUpcomingItem[]
}

/** Only informational card installments are grouped; payment actions keep their own row. */
export function groupDashboardInstallments(items: DashboardUpcomingItem[]): DashboardUpcomingItem[] {
  const groups = new Map<string, DashboardUpcomingItem[]>()
  for (const item of items) {
    const key = item.obligation.kind === 'card_installment' && !item.obligation.action && item.obligation.relatedCardId
      ? `${item.obligation.relatedCardId}:${item.obligation.date}` : item.id
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map((rows) => rows.length === 1 ? rows[0] : {
    ...rows[0], title: `${rows.length} taksit kalemi`, subtitle: rows[0].subtitle.replace(/ - [^-]*$/, '') + ' · karta yazılacak',
    amount: sumTL(rows.map((row) => row.amount)), cashImpactAmount: sumTL(rows.map((row) => row.cashImpactAmount)), children: rows,
  })
}

function obligationKindToDashboardKind(kind: FinanceObligation['kind']): DashboardUpcomingItem['kind'] {
  if (kind === 'payment') return 'payment'
  if (kind === 'loan_installment' || kind === 'legacy_loan_installment') return 'loan'
  if (kind === 'personal_debt' || kind === 'personal_receivable') return 'debt'
  if (kind === 'salary') return 'salary'
  return 'card'
}

function obligationToDashboardUpcomingItem(item: FinanceObligation): DashboardUpcomingItem {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    value: formatSeritAmount(item.amount, { decimals: 2 }),
    amount: item.amount,
    cashImpactAmount: item.cashImpactAmount ?? item.amount,
    settlement: item.settlement ?? 'cash',
    kind: obligationKindToDashboardKind(item.kind),
    direction: item.direction ?? 'outflow',
    date: formatDate(item.date),
    sortTime: new Date(`${item.date}T00:00:00`).getTime(),
    obligation: item,
  }
}

export function buildDashboardUpcomingItems(data: FinanceObligationsInput, days = 30, from = new Date()): DashboardUpcomingItem[] {
  return buildFinanceObligationsForRange(data, { days, from })
    .filter((item) => item.direction === 'outflow' || item.kind === 'salary')
    .map(obligationToDashboardUpcomingItem)
}
