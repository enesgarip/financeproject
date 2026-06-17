import type {
  Asset,
  Card,
  CardExpense,
  Loan,
  NetWorthSnapshot,
  SavingsGoal,
} from '../types/database'
import { sumTL } from './money'

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

export function detectMilestones(data: MilestoneInput): Milestone[] {
  const milestones: Milestone[] = []

  const cashAssets = data.assets.filter((a) => a.category === 'Nakit')
  const totalCash = sumTL(cashAssets.map((a) => a.estimated_value_try))

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

  if (data.netWorthSnapshots.length >= 2) {
    const sorted = [...data.netWorthSnapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    const latest = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    if (latest.net_worth > previous.net_worth) {
      milestones.push({
        id: 'net-worth-up',
        icon: 'trending-up',
        title: 'Net değer yükselişte',
        description: 'Son ölçümde net değerin bir önceki aya göre arttı.',
        tone: 'emerald',
      })
    }

    const allTimeHigh = sorted.every((s, i) => i === sorted.length - 1 || s.net_worth <= latest.net_worth)
    if (allTimeHigh && sorted.length >= 3) {
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
  const sortedMonths = [...monthTotals.entries()].sort(([a], [b]) => a.localeCompare(b))
  if (sortedMonths.length >= 3) {
    const last3 = sortedMonths.slice(-3)
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

  const totalLimit = sumTL(creditCards.map((c) => c.credit_limit ?? 0))
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
