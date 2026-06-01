import {
  BarChart3,
  Banknote,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  MoreHorizontal,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'

export const primaryNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/varliklar', label: 'Varlıklar', icon: Banknote },
  { to: '/kartlar', label: 'Kartlar', icon: CreditCard },
  { to: '/krediler', label: 'Krediler', icon: Landmark },
  { to: '/borclar', label: 'Borç / Alacak', icon: HandCoins },
  { to: '/odemeler', label: 'Ödemeler', icon: WalletCards },
  { to: '/analiz', label: 'Analiz', icon: BarChart3 },
  { to: '/veri-sagligi', label: 'Veri Sağlığı', icon: ShieldCheck },
  { to: '/daha', label: 'Daha', icon: MoreHorizontal },
] as const

export const bottomNavItems = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Kartlar', icon: CreditCard },
  { to: '/odemeler', label: 'Ödemeler', icon: WalletCards },
  { to: '/analiz', label: 'Analiz', icon: BarChart3 },
  { to: '/daha', label: 'Daha', icon: MoreHorizontal },
] as const

export const quickEntryItems = [
  { to: '/varliklar', title: 'Varlıklar ve maaş', description: 'Nakit, yatırım, BES ve maaş geçmişi.', icon: Banknote },
  { to: '/krediler', title: 'Krediler', description: 'Kredi bakiyesi, taksit planı ve ödeme akışı.', icon: Landmark },
  { to: '/borclar', title: 'Borç / alacak', description: 'Kişi bazlı borçlar, alacaklar ve tahsilatlar.', icon: HandCoins },
  { to: '/kartlar', title: 'Hızlı harcama', description: 'Kart seçip peşin veya taksitli harcama gir.', icon: ReceiptText },
  { to: '/veri-sagligi', title: 'Veri sağlığı', description: 'Tutarsızlıkları kontrol et, güvenli düzelt.', icon: ShieldCheck },
] as const
