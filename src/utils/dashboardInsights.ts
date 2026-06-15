import type { FocusAction, SmartInsight } from '../components/dashboard/DashboardPanels'
import type {
  AccountReconciliation,
  Card as FinanceCard,
  CardInstallment,
  CardStatementArchive,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
} from '../types/database'
import { daysUntil } from './date'
import { moneyDiffers } from './money'
import type { DashboardUpcomingItem } from './dashboardUpcoming'
import {
  cardDebtBreakdown,
  cardProvisionAmount,
  scheduledCardInstallmentTotalsByCard,
  sum,
  type CashFlowSummary,
} from './financeSummary'
import { formatCurrency } from './formatCurrency'
import { buildReconciliationItems, latestReconciliationByCard, STALE_AFTER_DAYS } from './reconciliation'
import { canCutCurrentStatement } from './statementCycle'

/**
 * Pure dashboard insight/action builders, extracted from DashboardPage so the
 * page stays presentational and this logic is unit-testable (roadmap Faz 4).
 * Behaviour is unchanged from the in-page versions.
 */

type UpcomingItem = DashboardUpcomingItem

/** The exact slice of dashboard data the focus-action builder reads. */
export type FocusActionsInput = {
  cards: FinanceCard[]
  payments: Payment[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  cardInstallments: CardInstallment[]
  cardStatements: CardStatementArchive[]
  salaryHistory: SalaryHistory[]
  accountReconciliations: AccountReconciliation[]
}

export function reconciliationDriftCount(cards: FinanceCard[], reconciliations: AccountReconciliation[]): number {
  const reconcilable = cards.filter((c) => c.card_type === 'banka_karti' || c.card_type === 'kredi_karti')
  const items = buildReconciliationItems(reconcilable, latestReconciliationByCard(reconciliations))
  return items.filter((i) => i.status === 'drift').length
}

export function buildSmartInsights(
  cashFlow: CashFlowSummary,
  creditUsageRate: number,
  totalDebts: number,
  totalReceivables: number,
  upcomingItems: UpcomingItem[],
  reconDriftCount = 0,
): SmartInsight[] {
  const insights: SmartInsight[] = []
  const urgentCount = upcomingItems.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining <= 7
  }).length

  if (cashFlow.projectedCash < 0) {
    insights.push({
      title: 'Ay sonu nakit açığı görünüyor',
      description: `${cashFlow.monthLabel} projeksiyonu ${formatCurrency(cashFlow.projectedCash)}. Büyük ödemeleri veya tahsilatı öne almak iyi olur.`,
      tone: 'rose',
    })
  } else if (cashFlow.netFlow < 0) {
    insights.push({
      title: 'Bu ay nakit azalıyor',
      description: `Net akış ${formatCurrency(cashFlow.netFlow)}. Ay sonu pozitif kalsa da çıkış temposu gelirden yüksek.`,
      tone: 'amber',
    })
  } else {
    insights.push({
      title: 'Bu ay nakit akışı rahat',
      description: `Tahmini net akış +${formatCurrency(cashFlow.netFlow)}. Fazlayı kart borcu, hedef veya yatırım tarafına ayırabilirsin.`,
      tone: 'emerald',
    })
  }

  if (urgentCount > 0) {
    insights.push({
      title: `${urgentCount} yakın vade var`,
      description: 'Önümüzdeki 7 gün içinde ödeme takibi gerekiyor. En yakın kalemleri ödeme alarmında öne aldım.',
      tone: urgentCount >= 3 ? 'rose' : 'amber',
    })
  }

  if (creditUsageRate >= 80) {
    insights.push({
      title: 'Kart limit kullanımı yüksek',
      description: `Toplam limitin yaklaşık %${Math.round(creditUsageRate)} kullanılıyor. Yeni harcamalarda taksit ve limit grubuna dikkat.`,
      tone: 'rose',
    })
  } else if (creditUsageRate >= 55) {
    insights.push({
      title: 'Kart kullanımı izlenmeli',
      description: `Limit kullanımın %${Math.round(creditUsageRate)} seviyesinde. Ekstre kesilmeden önce dönem içi harcamayı kontrol etmek iyi olur.`,
      tone: 'amber',
    })
  }

  if (totalReceivables > 0 && totalDebts > 0) {
    insights.push({
      title: 'Alacaklar borcu dengeleyebilir',
      description: `${formatCurrency(totalReceivables)} açık alacak var. Tahsilat tarihleri nakit açığını yumuşatabilir.`,
      tone: 'stone',
    })
  }

  if (reconDriftCount > 0) {
    insights.push({
      title: 'Bakiye mutabakatında fark var',
      description: `${reconDriftCount} hesapta app ile banka rakamı uyuşmuyor. Veri Sağlığı'ndan detay görebilirsin.`,
      tone: 'amber',
    })
  }

  return insights.slice(0, 4)
}

export function buildFocusActions(
  data: FocusActionsInput,
  cashFlow: CashFlowSummary,
  creditUsageRate: number,
  upcomingItems: UpcomingItem[],
): FocusAction[] {
  const actions: FocusAction[] = []
  const bankAccounts = data.cards.filter((card) => card.card_type === 'banka_karti')
  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const overduePayments = data.payments.filter((payment) => {
    const remaining = daysUntil(payment.due_date)
    return payment.status === 'bekliyor' && remaining !== null && remaining < 0
  })
  const overdueLoanInstallments = data.loanInstallments.filter((installment) => {
    const remaining = daysUntil(installment.due_date)
    return installment.status === 'bekliyor' && remaining !== null && remaining < 0
  })
  const urgentCount = upcomingItems.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining >= 0 && remaining <= 3
  }).length
  const scheduledInstallmentsByCard = scheduledCardInstallmentTotalsByCard(data.cardInstallments)
  const cardDebtBreakdowns = creditCards.map((card) => cardDebtBreakdown(card, scheduledInstallmentsByCard.get(card.id) ?? 0))
  const cardSplitIssues = cardDebtBreakdowns.filter((breakdown) => breakdown.hasSplitOverflow)
  const cardScheduledDebtIssues = cardDebtBreakdowns.filter((breakdown) => breakdown.hasScheduledDebtGap)
  const unclassifiedCardDebts = cardDebtBreakdowns.filter((breakdown) => breakdown.hasUnexplainedDebt)
  const cardsWithProvisions = creditCards.filter((card) => cardProvisionAmount(card) > 0)
  const totalProvision = sum(cardsWithProvisions, cardProvisionAmount)
  const statementReadyCards = creditCards.filter((card) => canCutCurrentStatement(card, data.cardStatements))
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const loansWithoutPlan = data.loans.filter((loan) => loan.status === 'active' && loan.remaining_installments > 0 && !plannedLoanIds.has(loan.id))
  const loanInstallmentsByLoan = new Map<string, LoanInstallment[]>()

  for (const item of data.loanInstallments) {
    loanInstallmentsByLoan.set(item.loan_id, [...(loanInstallmentsByLoan.get(item.loan_id) ?? []), item])
  }

  const loanSummaryDrifts = data.loans.filter((loan) => {
    const rows = loanInstallmentsByLoan.get(loan.id) ?? []
    if (rows.length === 0) return false

    const pending = rows.filter((item) => item.status !== 'ödendi')
    const remainingAmount = pending.reduce((total, item) => total + item.amount, 0)
    const expectedStatus = pending.length === 0 ? 'closed' : 'active'

    return moneyDiffers(loan.remaining_amount, remainingAmount) || loan.remaining_installments !== pending.length || loan.status !== expectedStatus
  })

  if (bankAccounts.length === 0) {
    actions.push({
      id: 'setup-bank-account',
      title: 'Önce bir banka hesabı ekle',
      description: 'Ödeme, kredi taksidi ve borç kapatma akışları için kaynak hesap gerekiyor.',
      to: '/kartlar',
      cta: 'Hesap ekle',
      tone: 'rose',
      icon: 'card',
      priority: 1,
    })
  }

  if (overduePayments.length + overdueLoanInstallments.length > 0) {
    actions.push({
      id: 'overdue-payments',
      title: `${overduePayments.length + overdueLoanInstallments.length} geciken ödeme var`,
      description: 'Geciken ödeme ve kredi taksitlerini öne aldım; nakit planını bozmadan kapatmak iyi olur.',
      to: overduePayments.length > 0 ? '/odemeler' : '/borclar/krediler',
      cta: 'Gecikeni gör',
      tone: 'rose',
      icon: 'alert',
      priority: 2,
    })
  }

  if (cashFlow.projectedCash < 0) {
    actions.push({
      id: 'cash-gap',
      title: 'Ay sonu nakit açığı görünüyor',
      description: `${cashFlow.monthLabel} projeksiyonu ${formatCurrency(cashFlow.projectedCash)}. Ödeme tarihlerini ve tahsilatları birlikte kontrol et.`,
      to: '/analiz',
      cta: 'Raporlara git',
      tone: 'rose',
      icon: 'alert',
      priority: 3,
    })
  }

  if (urgentCount > 0) {
    actions.push({
      id: 'urgent-upcoming',
      title: `${urgentCount} vade 3 gün içinde`,
      description: 'Yakın vadeleri kaçırmamak için ödeme alarmındaki ilk kalemlerden başlamak en güvenlisi.',
      to: '/odemeler',
      cta: 'Vadeleri gör',
      tone: urgentCount >= 3 ? 'rose' : 'amber',
      icon: 'calendar',
      priority: 4,
    })
  }

  if (totalProvision > 0) {
    actions.push({
      id: 'card-provisions',
      title: `${formatCurrency(totalProvision)} provizyon bekliyor`,
      description: 'Kesinleşenleri güncel borca aktar, iptal olanları limitten çıkar.',
      to: '/kartlar?section=ekstreler',
      cta: 'Provizyonları aç',
      tone: 'amber',
      icon: 'card',
      priority: 4.5,
    })
  }

  if (statementReadyCards.length > 0) {
    actions.push({
      id: 'statement-ready',
      title: `${statementReadyCards.length} kartta ekstre kesilebilir`,
      description: 'Dönem içi kesinleşen harcamalar ekstre borcuna aktarılmaya hazır görünüyor.',
      to: '/kartlar?section=ekstreler',
      cta: 'Ekstreleri kontrol et',
      tone: 'indigo',
      icon: 'calendar',
      priority: 4.7,
    })
  }

  const dataHealthIssueCount = cardSplitIssues.length + cardScheduledDebtIssues.length + unclassifiedCardDebts.length + loanSummaryDrifts.length

  if (dataHealthIssueCount > 0) {
    actions.push({
      id: 'data-health',
      title: 'Kayıt kontrolü önerisi var',
      description: `${dataHealthIssueCount} kayıt için güvenli düzeltme önerisi hazır.`,
      to: '/veri-sagligi',
      cta: 'Veri kontrolü',
      tone: 'stone',
      icon: 'health',
      priority: 50,
    })
  }

  if (loansWithoutPlan.length > 0) {
    actions.push({
      id: 'loan-plan',
      title: `${loansWithoutPlan.length} kredide ödeme planı eksik`,
      description: 'Plan oluşunca yaklaşan taksitler, analiz ve nakit akışı daha doğru çalışır.',
      to: '/borclar/krediler',
      cta: 'Plan oluştur',
      tone: 'indigo',
      icon: 'loan',
      priority: 6,
    })
  }

  if (creditUsageRate >= 80) {
    actions.push({
      id: 'credit-usage',
      title: 'Kart limit kullanımı yüksek',
      description: `Toplam limitin yaklaşık %${Math.round(creditUsageRate)} kullanılıyor. Ortak limit ve dönem içi harcamayı kontrol et.`,
      to: '/kartlar',
      cta: 'Kartlara git',
      tone: 'amber',
      icon: 'card',
      priority: 7,
    })
  }

  const reconcilable = [...bankAccounts, ...creditCards]
  if (reconcilable.length > 0) {
    const reconItems = buildReconciliationItems(reconcilable, latestReconciliationByCard(data.accountReconciliations))
    const reconDrift = reconItems.filter((i) => i.status === 'drift').length
    const reconNever = reconItems.filter((i) => i.status === 'never').length
    const reconStale = reconItems.filter((i) => i.status === 'stale').length

    if (reconDrift > 0) {
      actions.push({
        id: 'reconciliation-drift',
        title: `${reconDrift} hesapta bakiye farkı var`,
        description: 'Son mutabakatta app ile banka arasında fark tespit edildi. Farkın kaynağını incelemek iyi olur.',
        to: '/veri-sagligi',
        cta: 'Mutabakata git',
        tone: 'rose',
        icon: 'alert',
        priority: 8,
      })
    } else if (reconNever > 0) {
      actions.push({
        id: 'reconciliation-never',
        title: `${reconNever} hesap hiç mutabık olmadı`,
        description: 'Banka ile en az bir kez karşılaştır; sessiz kaymaları erken yakala.',
        to: '/veri-sagligi',
        cta: 'Mutabakata git',
        tone: 'amber',
        icon: 'health',
        priority: 8.5,
      })
    } else if (reconStale > 0) {
      actions.push({
        id: 'reconciliation-stale',
        title: `${reconStale} hesapta mutabakat ${STALE_AFTER_DAYS}+ gün önce`,
        description: 'Düzenli mutabakat kaçak işlemleri erken yakalar. Bankadaki gerçek rakamla karşılaştır.',
        to: '/veri-sagligi',
        cta: 'Mutabakata git',
        tone: 'stone',
        icon: 'calendar',
        priority: 9,
      })
    }
  }

  if (!data.salaryHistory.length) {
    actions.push({
      id: 'salary-setup',
      title: 'Maaş bilgisini ekle',
      description: 'Maaş geçmişi girilince aylık nakit akışı ve ay sonu tahmini daha gerçekçi olur.',
      to: '/varliklar',
      cta: 'Maaş ekle',
      tone: 'emerald',
      icon: 'check',
      priority: 20,
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: 'all-clear',
      title: 'Bugün sakin görünüyor',
      description: 'Yakın vade, bakiye açığı veya limit uyarısı yok.',
      to: '/kartlar',
      cta: 'Hesaplara bak',
      tone: 'emerald',
      icon: 'check',
      priority: 100,
    })
  }

  return actions.sort((a, b) => a.priority - b.priority)
}
