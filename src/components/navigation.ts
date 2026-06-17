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
  { to: '/analiz', label: 'Genel', end: true },
  { to: '/analiz/trendler', label: 'Trendler' },
  { to: '/analiz/servet', label: 'Servet' },
  { to: '/analiz/kayitlar', label: 'Kayıtlar' },
]

export const dataHealthHubTabs: HubTab[] = [
  { to: '/veri-sagligi', label: 'Bulgular', end: true },
  { to: '/veri-sagligi/islemler', label: 'Yedek & Ayarlar' },
]

type RouteWidth = 'wide' | 'medium' | 'narrow'

const routeMeta: Record<string, { title: string; width: RouteWidth }> = {
  '/': { title: 'Finans Özeti', width: 'wide' },
  '/kartlar': { title: 'Hesaplar ve Kartlar', width: 'wide' },
  '/varliklar': { title: 'Varlıklar', width: 'medium' },
  '/varliklar/maas': { title: 'Maaş', width: 'medium' },
  '/varliklar/altin': { title: 'Altın', width: 'narrow' },
  '/borclar/krediler': { title: 'Krediler', width: 'wide' },
  '/borclar/kisiler': { title: 'Kişiler', width: 'medium' },
  '/odemeler': { title: 'Ödeme Takvimi', width: 'medium' },
  '/odemeler/hedefler': { title: 'Bütçe & Hedefler', width: 'medium' },
  '/analiz': { title: 'Analiz', width: 'wide' },
  '/analiz/trendler': { title: 'Trendler', width: 'wide' },
  '/analiz/servet': { title: 'Servet Analizi', width: 'wide' },
  '/analiz/kayitlar': { title: 'Kayıtlar', width: 'wide' },
  '/veri-sagligi': { title: 'Veri Kontrolü', width: 'wide' },
  '/veri-sagligi/islemler': { title: 'Yedek ve Ayarlar', width: 'medium' },
}

const WIDTH_CLASS: Record<RouteWidth, string> = {
  wide: 'max-w-7xl',
  medium: 'max-w-5xl',
  narrow: 'max-w-4xl',
}

export function routeTitle(pathname: string): string {
  return routeMeta[pathname]?.title ?? 'Denge'
}

export function contentWidthClass(pathname: string): string {
  return WIDTH_CLASS[routeMeta[pathname]?.width ?? 'narrow']
}
