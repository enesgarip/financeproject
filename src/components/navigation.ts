import {
  BarChart3,
  Banknote,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  MoreHorizontal,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'

export const primaryNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Hesaplar', icon: CreditCard },
  { to: '/odemeler', label: 'Planlı', icon: WalletCards },
  { to: '/borclar', label: 'Kişiler', icon: HandCoins },
  { to: '/analiz', label: 'Raporlar', icon: BarChart3 },
  { to: '/daha', label: 'Diğer', icon: MoreHorizontal, activePaths: ['/varliklar', '/krediler', '/veri-sagligi'] },
] as const

export const bottomNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Hesaplar', icon: CreditCard },
  { to: '/odemeler', label: 'Planlı', icon: WalletCards },
  { to: '/borclar', label: 'Kişiler', icon: HandCoins },
  { to: '/daha', label: 'Diğer', icon: MoreHorizontal, activePaths: ['/varliklar', '/krediler', '/analiz', '/veri-sagligi'] },
] as const

export const quickEntryItems = [
  { section: 'records', to: '/varliklar', title: 'Varlıklar ve maaş', description: 'Nakit, yatırım, BES ve maaş.', icon: Banknote },
  { section: 'records', to: '/krediler', title: 'Krediler', description: 'Kredi bakiyesi ve taksit planı.', icon: Landmark },
  { section: 'maintenance', to: '/veri-sagligi', title: 'Veri kontrolü', description: 'Tutarsız kayıtları güvenle düzelt.', icon: ShieldCheck },
] as const
