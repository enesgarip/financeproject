export const usageTabs = {
  accounts: 'Hesaplar › Hesaplar ve nakit',
  cards: 'Hesaplar › Kredi kartları',
  'card-period': 'Kredi kartları › Dönem harcamaları',
  'card-installments': 'Kredi kartları › Taksitler',
  'card-statements': 'Kredi kartları › Ekstreler',
  'card-pending': 'Kredi kartları › Provizyon',
  'card-categories': 'Kredi kartları › Kategoriler',
  'payment-due': 'Ödemeler › Vadeler',
  'payment-plans': 'Ödemeler › Kayıtlı planlar',
} as const

export const usageActions = {
  expense: { label: 'Harcama ekleme', opens: true, submits: true },
  transfer: { label: 'Hesaplar arası transfer', opens: true, submits: true },
  reserve: { label: 'Hedefe para ayırma', opens: false, submits: true },
  'car-service': { label: 'Araç bakımını tamamlama', opens: true, submits: true },
  purchase: { label: 'Alsam mı? değerlendirmesi', opens: true, submits: false },
  payment: { label: 'Ödeme veya tahsilat', opens: true, submits: true },
  backup: { label: 'JSON yedek alma', opens: false, submits: true },
} as const

export const usageSources = {
  direct: 'Doğrudan bağlantı',
  'quick-actions': 'Hızlı işlem menüsü',
  'bottom-nav': 'Alt bardaki harcama düğmesi',
  discovery: 'Ara ve keşfet',
  accounts: 'Hesaplar ve kartlar',
  vehicle: 'Araçlar',
  'expense-group': 'Gider grupları',
  wishlist: 'Alınacaklar',
  goals: 'Bütçe ve hedefler',
  purchase: 'Alsam mı?',
  overview: 'Özet',
  plan: 'Plan sekmeleri',
  payments: 'Ödemeler',
  loans: 'Krediler',
  people: 'Kişiler',
  control: 'Veri kontrolü',
  maintenance: 'Bakım',
} as const

export type UsageAction = keyof typeof usageActions
export type UsageActionStage = 'opened' | 'attempted' | 'completed' | 'failed' | 'closed'
export type UsageSource = keyof typeof usageSources
export type UsageFlowAction = 'expense' | 'transfer' | 'car-service' | 'purchase' | 'payment'
export type UsageDays = 7 | 30

export function usageSourceFrom(state: unknown, fallback: UsageSource): UsageSource {
  if (typeof state !== 'object' || !state || !('usageSource' in state)) return fallback
  const source = state.usageSource
  return typeof source === 'string' && Object.hasOwn(usageSources, source) ? source as UsageSource : fallback
}

export type UsageEvent =
  | { kind: 'page'; subject: string }
  | { kind: 'tab'; subject: keyof typeof usageTabs }
  | { kind: UsageActionStage; subject: UsageAction; flowId?: string; source?: UsageSource }
  | { kind: 'discovery'; subject: string }
  | { kind: 'no_results'; subject: 'search' }

export type UsageSummaryRow = {
  kind: UsageEvent['kind']
  subject: string
  event_count: number
  active_days: number
}

export type UsageInsights = {
  rows: (UsageSummaryRow & { previous_count: number })[]
  comparison: { active_days: number; page_views: number; completed: number; failed: number }
  previous: { active_days: number; page_views: number; completed: number; failed: number }
  flows: {
    subject: UsageFlowAction
    opened: number
    submitted: number
    completed: number
    closed_before_submit: number
    failed: number
    recovered: number
  }[]
  sources: { subject: UsageAction; source: UsageSource; event_count: number }[]
  automation: {
    card_sms: number
    account_sms: number
    sms_errors: number
    foreign_completed: number
    foreign_pending: number
    foreign_pending_over_day: number
  }
}
