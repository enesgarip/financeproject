import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, Star } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { recordUsage } from '../lib/usageTelemetry'
import { appFeatures, featureFavoritesKey, parseFeatureFavorites, searchFeatures, type AppFeature } from '../utils/featureDiscovery'
import { SimpleModal } from './SimpleModal'
import { Input } from './ui/input'

function readFavorites(userId: string | undefined) {
  try { return userId ? parseFeatureFavorites(localStorage.getItem(featureFavoritesKey(userId))) : [] }
  catch { return [] }
}

function FeatureRow({ feature, favorite, onToggle, onSelect }: { feature: AppFeature; favorite: boolean; onToggle: () => void; onSelect: () => void }) {
  return <li className="flex items-start gap-1 border-b border-line py-2 last:border-0">
    <Link to={feature.to} state={{ usageSource: 'discovery' }} onClick={onSelect} className="min-w-0 flex-1 rounded-lg px-2 py-2 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary">
      <span className="flex items-start gap-2 text-sm font-semibold text-ink"><span className="min-w-0 break-words">{feature.title}</span><ArrowUpRight size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /></span>
      <span className="mt-1 block text-[13px] leading-relaxed text-ink-muted">{feature.description}</span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{feature.location}</span>
    </Link>
    <button type="button" aria-label={`${feature.title}: ${favorite ? 'favorilerden çıkar' : 'favorilere ekle'}`} aria-pressed={favorite} onClick={onToggle} className="grid size-11 shrink-0 place-items-center rounded-lg text-primary hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-primary"><Star size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
  </li>
}

export function FeatureExplorer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState(() => readFavorites(user?.id))
  const [storageError, setStorageError] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const results = searchFeatures(query)
  const noResults = open && Boolean(query.trim()) && results.length === 0
  const userId = user?.id
  useEffect(() => {
    if (!noResults || !userId) return
    const timer = window.setTimeout(() => recordUsage(userId, { kind: 'no_results', subject: 'search' }), 750)
    return () => window.clearTimeout(timer)
  }, [noResults, userId])
  const groups = [...new Set(results.map(feature => feature.group))]
  const pinned = favorites.flatMap(id => appFeatures.find(feature => feature.id === id) ?? [])
  function updateQuery(value: string) {
    setQuery(value)
    if (resultsRef.current) resultsRef.current.scrollTop = 0
  }
  function close() { setQuery(''); onClose() }
  function selectFeature(feature: AppFeature) {
    recordUsage(userId, { kind: 'discovery', subject: feature.id })
    close()
  }
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id]
    setFavorites(next)
    try {
      if (!user) throw new Error('Oturum bulunamadı.')
      localStorage.setItem(featureFavoritesKey(user.id), JSON.stringify(next))
      setStorageError(false)
    } catch { setStorageError(true) }
  }
  return <SimpleModal
    title="Ara ve keşfet"
    open={open}
    onClose={close}
    scrollRef={resultsRef}
    scrollClassName="feature-explorer-scroll"
    pinnedContent={<label className="block text-sm font-semibold">
      Özellik ara
      <Input data-navigation-transient type="search" className="mt-2 min-h-11" placeholder="Altın, aylık hedef, SMS…" value={query} onChange={event => updateQuery(event.target.value)} />
    </label>}
  >
    <div className="space-y-5">
      <p className="text-[13px] text-ink-muted">Yapmak istediğini yaz veya özellikleri aşağıdan keşfet. Yıldızla işaretlediklerin favorilerine eklenir.</p>
      {storageError ? <p role="status" className="text-sm text-warning">Favoriler bu oturumda kullanılabilir; bu tarayıcıya kaydedilemedi.</p> : null}
      {!query.trim() ? <section aria-label="Favori kısayollar" className="rounded-xl border border-line-strong p-3">
        <h3 className="text-sm font-semibold">Favori kısayollar</h3>
        {pinned.length ? <div className="mt-2 flex flex-wrap gap-2">{pinned.map(feature => <Link key={feature.id} to={feature.to} state={{ usageSource: 'discovery' }} onClick={() => selectFeature(feature)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary/8 px-3 py-2 text-sm font-semibold text-primary"><Star size={15} fill="currentColor" className="shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{feature.title}</span></Link>)}</div> : <p className="mt-2 text-[13px] text-ink-muted">Sık kullandığın özellikleri yıldızla; buradan hızlıca aç.</p>}
        <p className="mt-2 text-xs text-ink-muted">Bu cihazda, hesabına özel saklanır.</p>
      </section> : null}
      <p role="status" aria-live="polite" className="text-xs text-ink-muted">{query.trim() ? `${results.length} özellik bulundu` : `${appFeatures.length} özelliği keşfet`}</p>
      {results.length === 0 ? <div className="space-y-2"><p className="text-sm text-ink">Bu aramayla eşleşen özellik bulunamadı.</p><button type="button" className="min-h-11 text-sm font-semibold text-primary" onClick={() => updateQuery('')}>Tüm özellikleri göster</button></div> : groups.map(group => <section key={group} aria-label={group}>
        <h3 className="border-b border-line-strong pb-2 text-sm font-semibold text-primary">{group}</h3>
        <ul>{results.filter(feature => feature.group === group).map(feature => <FeatureRow key={feature.id} feature={feature} favorite={favorites.includes(feature.id)} onToggle={() => toggleFavorite(feature.id)} onSelect={() => selectFeature(feature)} />)}</ul>
      </section>)}
    </div>
  </SimpleModal>
}
