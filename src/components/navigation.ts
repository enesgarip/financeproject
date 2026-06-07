import {
  BarChart3,
  CreditCard,
  HandCoins,
  Home,
  WalletCards,
  Wallet,
} from 'lucide-react'

/**
 * Role-based information architecture:
 *   Özet → Hesaplar (transactional) → Varlıklar (holdings) → Borçlar (liabilities) → Planlı (flow) → Raporlar (insight)
 * Varlıklar and Borçlar are hubs with sub-tabs; see *HubTabs below.
 */
export const primaryNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Hesaplar', icon: CreditCard },
  { to: '/varliklar', label: 'Varlıklar', icon: Wallet, activePaths: ['/varliklar/maas'] },
  { to: '/borclar/krediler', label: 'Borçlar', icon: HandCoins, activePaths: ['/borclar', '/borclar/kisiler', '/krediler'] },
  { to: '/odemeler', label: 'Planlı', icon: WalletCards },
  { to: '/analiz', label: 'Raporlar', icon: BarChart3 },
] as const

/** Mobile bottom bar holds 5 slots; Raporlar lives in the header menu instead. */
export const bottomNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Hesaplar', icon: CreditCard },
  { to: '/varliklar', label: 'Varlıklar', icon: Wallet, activePaths: ['/varliklar/maas'] },
  { to: '/borclar/krediler', label: 'Borçlar', icon: HandCoins, activePaths: ['/borclar', '/borclar/kisiler', '/krediler'] },
  { to: '/odemeler', label: 'Planlı', icon: WalletCards },
] as const

export type HubTab = { to: string; label: string; end?: boolean }

export const assetsHubTabs: HubTab[] = [
  { to: '/varliklar', label: 'Varlıklar', end: true },
  { to: '/varliklar/maas', label: 'Maaş' },
]

export const liabilitiesHubTabs: HubTab[] = [
  { to: '/borclar/krediler', label: 'Krediler' },
  { to: '/borclar/kisiler', label: 'Kişiler' },
]
