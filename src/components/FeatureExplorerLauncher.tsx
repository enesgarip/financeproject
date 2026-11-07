import { Suspense, useState } from 'react'
import { useLocation } from 'react-router'
import { Search } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { lazyWithReload } from '../lib/lazyWithReload'

const FeatureExplorer = lazyWithReload(() => import('./FeatureExplorer').then(module => ({ default: module.FeatureExplorer })))

/** Dizin ilk açılışta yüklenir; gezinme boyunca favori/arama durumu korunur. */
export function FeatureExplorerLauncher() {
  const location = useLocation()
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [openAt, setOpenAt] = useState<string | null>(null)
  return <div className="mt-3">
    <button type="button" aria-haspopup="dialog" onClick={() => { setMounted(true); setOpenAt(location.key) }} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line-strong bg-raised px-3 py-2 text-left text-sm font-semibold text-ink-muted hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary">
      <Search size={18} className="shrink-0 text-primary" aria-hidden="true" /><span>Ara ve keşfet</span><span className="ml-auto hidden text-xs font-normal sm:inline">Özellikler ve favoriler</span>
    </button>
    {mounted ? <Suspense fallback={<p role="status" className="py-2 text-sm text-ink-muted">Özellikler yükleniyor…</p>}><FeatureExplorer key={user?.id ?? 'anonymous'} open={openAt === location.key} onClose={() => setOpenAt(null)} /></Suspense> : null}
  </div>
}
