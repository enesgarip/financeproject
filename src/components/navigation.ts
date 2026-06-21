import {
  BarChart3,
  CreditCard,
  HandCoins,
  Home,
  ShieldCheck,
  WalletCards,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Extra resting pathnames (siblings) that should also light this item up.
   *  Child routes are covered automatically by NavLink, so only list siblings. */
  activePaths?: readonly string[]
}

/**
 * Role-based information architecture:
 *   Özet -> Hesaplar -> Birikim -> Borçlar -> Takvim -> Analiz
 * Hubs own their local tabs; the mobile bottom bar stays capped at five slots.
 *
 * This module is the single source of truth for navigation: the bottom bar,
 * the header overflow menu, page titles and content widths are all derived
 * from here so Layout / BottomNav / App never drift apart.
 */
export const primaryNavItems: readonly NavItem[] = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Hesaplar', icon: CreditCard },
  { to: '/varliklar', label: 'Birikim', icon: Wallet },
  { to: '/borclar/krediler', label: 'Borçlar', icon: HandCoins, activePaths: ['/borclar/kisiler'] },
  { to: '/odemeler', label: 'Takvim', icon: WalletCards, activePaths: ['/odemeler/hedefler'] },
  { to: '/analiz', label: 'Analiz', icon: BarChart3 },
]

/** Utility / maintenance destinations that live outside the primary role-based flow. */
export const secondaryNavItems: readonly NavItem[] = [
  { to: '/veri-sagligi', label: 'Kontrol', icon: ShieldCheck },
]

/** Mobile bottom bar holds 5 slots; Analiz spills into the header overflow menu. */
export const bottomNavItems: readonly NavItem[] = primaryNavItems.filter((item) => item.to !== '/analiz')

/** Header overflow on mobile: primary items that don't fit the bottom bar, then utilities. */
const bottomPaths = new Set(bottomNavItems.map((item) => item.to))
export const overflowNavItems: readonly NavItem[] = [
  ...primaryNavItems.filter((item) => !bottomPaths.has(item.to)),
  ...secondaryNavItems,
]

export type HubTab = { to: string; label: string; end?: boolean }

export const assetsHubTabs: HubTab[] = [
  { to: '/varliklar', label: 'Varlıklar', end: true },
  { to: '/varliklar/maas', label: 'Maaş' },
  { to: '/varliklar/altin', label: 'Altın' },
]

export const liabilitiesHubTabs: HubTab[] = [
  { to: '/borclar/krediler', label: 'Krediler' },
  { to: '/borclar/kisiler', label: 'Kişiler' },
]

export const planningHubTabs: HubTab[] = [
  { to: '/odemeler', label: 'Takvim', end: true },
  { to: '/odemeler/hedefler', label: 'Hedefler' },
]

export const analysisHubTabs: HubTab[] = [
  { to: '/analiz', label: 'Analiz', end: true },
  { to: '/analiz/detay', label: 'Detay' },
]

export const dataHealthHubTabs: HubTab[] = [
  { to: '/veri-sagligi', label: 'Bulgular', end: true },
  { to: '/veri-sagligi/islemler', label: 'Yedek & Ayarlar' },
]

type RouteWidth = 'wide' | 'medium' | 'narrow'

const routeMeta: Record<string, { title: string; subtitle?: string; width: RouteWidth }> = {
  '/': { title: 'Finans Özeti', subtitle: 'Genel bakış ve günlük durum', width: 'wide' },
  '/kartlar': { title: 'Hesaplar ve Kartlar', subtitle: 'Banka hesapları, kartlar ve işlemler', width: 'wide' },
  '/varliklar': { title: 'Varlıklar', subtitle: 'Nakit, yatırım ve birikimler', width: 'medium' },
  '/varliklar/maas': { title: 'Maaş', subtitle: 'Maaş geçmişi ve trend', width: 'medium' },
  '/varliklar/altin': { title: 'Altın', subtitle: 'Altın varlıkları ve değerleme', width: 'narrow' },
  '/borclar/krediler': { title: 'Krediler', subtitle: 'Aktif krediler ve taksit planları', width: 'wide' },
  '/borclar/kisiler': { title: 'Kişiler', subtitle: 'Kişisel borç ve alacaklar', width: 'medium' },
  '/odemeler': { title: 'Ödeme Takvimi', subtitle: 'Planlı ödemeler ve vadeler', width: 'medium' },
  '/odemeler/hedefler': { title: 'Bütçe & Hedefler', subtitle: 'Birikim hedefleri ve bütçe takibi', width: 'medium' },
  '/analiz': { title: 'Analiz', subtitle: 'Aylık rapor ve ay kapanış kontrolü', width: 'wide' },
  '/analiz/detay': { title: 'Detay', subtitle: 'Gelir/gider dağılımı ve trendler', width: 'wide' },
  '/veri-sagligi': { title: 'Veri Kontrolü', subtitle: 'Tutarlılık denetimi ve bulgular', width: 'wide' },
  '/veri-sagligi/islemler': { title: 'Yedek ve Ayarlar', subtitle: 'Veri yedekleme ve bakım', width: 'medium' },
}

const WIDTH_CLASS: Record<RouteWidth, string> = {
  wide: 'max-w-7xl',
  medium: 'max-w-5xl',
  narrow: 'max-w-4xl',
}

export function routeTitle(pathname: string): string {
  return routeMeta[pathname]?.title ?? 'Denge'
}

export function routeSubtitle(pathname: string): string | undefined {
  return routeMeta[pathname]?.subtitle
}

export function contentWidthClass(pathname: string): string {
  return WIDTH_CLASS[routeMeta[pathname]?.width ?? 'narrow']
}
