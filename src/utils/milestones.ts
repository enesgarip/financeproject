/**
 * Finansal "başarım" (milestone) tespiti — kullanıcıyı motive eden rozetler:
 * birikim eşikleri, sıfır kart borcu, tüm kredilerin kapanması, tamamlanan
 * hedefler, net değer rekoru, 3 ay üst üste harcama düşüşü, sağlıklı limit
 * kullanımı. Hepsi eldeki snapshot'tan türetilir; yazma yok.
 *
 * Not: nakit = Nakit varlıklar + banka kartı bakiyeleri (totalCashAssets ile
 * aynı tanım) — sadece "Nakit" kategorisine bakmak gerçek birikimi eksik sayardı.
 */
import type {
  Asset,
  Card,
  CardExpense,
  Loan,
  NetWorthSnapshot,
  SavingsGoal,
} from '../types/database'
import { sumTL } from './money'
import { buildCreditLimitGroups } from './financeSummary'
import { aggregateNetWorthByMonth } from './netWorthSeries'

export type Milestone = {
  id: string
  icon: 'trophy' | 'target' | 'shield' | 'trending-up' | 'zap' | 'star'
  title: string
  description: string
  tone: 'emerald' | 'amber' | 'indigo' | 'rose'
  achievedAt?: string
}

export type MilestoneInput = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  cardExpenses: CardExpense[]
  savingsGoals: SavingsGoal[]
  netWorthSnapshots: NetWorthSnapshot[]
}

function monthKey(date: string): string {
  return date.slice(0, 7)
}

function offsetMonthKey(from: Date, offset: number): string {
  const date = new Date(from.getFullYear(), from.getMonth() + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function detectMilestones(data: MilestoneInput, now: Date = new Date()): Milestone[] {
  const milestones: Milestone[] = []

  // Cash = Nakit assets + bank-card balances, matching totalCashAssets elsewhere
  // (the threshold ignored bank balances before, under-counting real savings).
  const cashFromAssets = sumTL(data.assets.filter((a) => a.category === 'Nakit').map((a) => a.estimated_value_try))
  const bankBalance = sumTL(data.cards.filter((c) => c.card_type === 'banka_karti').map((c) => c.current_balance ?? 0))
  const totalCash = sumTL([cashFromAssets, bankBalance])

  const cashThresholds = [100_000, 50_000, 25_000, 10_000]
  for (const threshold of cashThresholds) {
    if (totalCash >= threshold) {
      const label = threshold >= 1000 ? `${threshold / 1000}K` : String(threshold)
      milestones.push({
        id: `cash-${threshold}`,
        icon: 'trophy',
        title: `${label} ₺ birikim`,
        description: `Nakit varlıkların ${label} ₺ seviyesine ulaştı.`,
        tone: 'emerald',
      })
      break
    }
  }

  const creditCards = data.cards.filter((c) => c.card_type === 'kredi_karti')
  const totalCardDebt = sumTL(creditCards.map((c) => c.debt_amount ?? 0))
  if (creditCards.length > 0 && totalCardDebt === 0) {
    milestones.push({
      id: 'zero-card-debt',
      icon: 'star',
      title: 'Kart borcu sıfır',
      description: 'Tüm kredi kartı borçların sıfırda — harika!',
      tone: 'emerald',
    })
  }

  const activeLoans = data.loans.filter((l) => l.status === 'active')
  const closedLoans = data.loans.filter((l) => l.status === 'closed')
  if (data.loans.length > 0 && activeLoans.length === 0 && closedLoans.length > 0) {
    milestones.push({
      id: 'all-loans-closed',
      icon: 'shield',
      title: 'Tüm krediler kapatıldı',
      description: `${closedLoans.length} krediyi başarıyla kapattın.`,
      tone: 'emerald',
    })
  }

  const completedGoals = data.savingsGoals.filter((g) => g.status === 'completed')
  if (completedGoals.length > 0) {
    milestones.push({
      id: 'goals-completed',
      icon: 'target',
      title: `${completedGoals.length} birikim hedefi tamamlandı`,
      description: completedGoals.length === 1
        ? `"${completedGoals[0].name}" hedefine ulaştın!`
        : `${completedGoals.length} hedefi başarıyla tamamladın.`,
      tone: 'indigo',
    })
  }

  const sortedMonthlySnapshots = aggregateNetWorthByMonth(data.netWorthSnapshots)
  if (sortedMonthlySnapshots.length >= 2) {
    const sorted = sortedMonthlySnapshots
    const latest = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    const previousCalendarMonth = offsetMonthKey(new Date(`${latest.snapshot_date}T00:00:00`), -1)
    if (previous.snapshot_date.slice(0, 7) === previousCalendarMonth && latest.net_worth > previous.net_worth) {
      milestones.push({
        id: 'net-worth-up',
        icon: 'trending-up',
        title: 'Net değer yükselişte',
        description: 'Son ölçümde net değerin bir önceki aya göre arttı.',
        tone: 'emerald',
      })
    }

    const allTimeHigh = data.netWorthSnapshots.every((snapshot) => snapshot.snapshot_date === latest.snapshot_date || snapshot.net_worth <= latest.net_worth)
    if (allTimeHigh && data.netWorthSnapshots.length >= 3) {
      milestones.push({
        id: 'net-worth-ath',
        icon: 'zap',
        title: 'Net değer rekor seviyede',
        description: 'Tüm zamanların en yüksek net değerine ulaştın!',
        tone: 'indigo',
      })
    }
  }

  const posted = data.cardExpenses.filter((e) => e.status === 'posted')
  const monthTotals = new Map<string, number>()
  for (const e of posted) {
    const m = monthKey(e.spent_at)
    monthTotals.set(m, sumTL([monthTotals.get(m), e.amount]))
  }
  const completedMonthKeys = [-3, -2, -1].map((offset) => offsetMonthKey(now, offset))
  if (completedMonthKeys.every((key) => monthTotals.has(key))) {
    const last3 = completedMonthKeys.map((key) => [key, monthTotals.get(key)!] as const)
    const isDecreasing = last3.every((entry, i) => i === 0 || entry[1] < last3[i - 1][1])
    if (isDecreasing) {
      milestones.push({
        id: 'spending-decrease-streak',
        icon: 'star',
        title: '3 ay üst üste harcama düşüşü',
        description: 'Son 3 aydır harcamalarını azaltıyorsun — harika disiplin!',
        tone: 'emerald',
      })
    }
  }

  const totalLimit = sumTL(buildCreditLimitGroups(creditCards).map((group) => group.limit))
  if (totalLimit > 0) {
    const usage = (totalCardDebt / totalLimit) * 100
    if (usage <= 30) {
      milestones.push({
        id: 'credit-usage-healthy',
        icon: 'shield',
        title: 'Sağlıklı kredi kullanımı',
        description: `Kredi kartı limit kullanımın %${Math.round(usage)} — %30 altında tutuyorsun.`,
        tone: 'emerald',
      })
    }
  }

  return milestones
}
