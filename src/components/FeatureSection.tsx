import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { DeferredDetails } from './ui/deferred-details'

/** Veri/lazy içerik geldikten sonra da doğrudan özellik bağlantısını görünür kılar. */
export function FeatureSection({ id, aliases = [], className, children }: { id: string; aliases?: string[]; className?: string; children: ReactNode }) {
  const { hash, key } = useLocation()
  const targeted = hash === `#${id}` || aliases.some(alias => hash === `#${alias}`)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!targeted) return
    const frame = requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true })
      ref.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
    return () => cancelAnimationFrame(frame)
  }, [targeted, key])
  return <div id={id} ref={ref} tabIndex={-1} data-feature-section={id} className={cn('min-w-0 scroll-mt-44 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary', className)}>{children}</div>
}

export function FeatureDetails({ id, ...props }: ComponentProps<typeof DeferredDetails> & { id: string }) {
  const location = useLocation()
  return <FeatureSection id={id}><DeferredDetails {...props} openRequestKey={location.hash === `#${id}` ? location.key : undefined} /></FeatureSection>
}
