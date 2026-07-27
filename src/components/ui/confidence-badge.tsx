import { CircleHelp, Clock3 } from 'lucide-react'
import type { Confidence } from '../../utils/dataConfidence'

/**
 * Rakamın güven seviyesini gösteren küçük rozet. `exact` seviyede hiçbir şey
 * render etmez — güvenilir rakamı işaretlemek gürültü olur; asıl bilgi olan
 * "buna temkinli yaklaş"tır.
 */
export function ConfidenceBadge({ confidence, className = '' }: { confidence: Confidence; className?: string }) {
  if (confidence.level === 'exact') return null

  const isStale = confidence.level === 'stale'
  const Icon = isStale ? Clock3 : CircleHelp

  return (
    <span
      title={confidence.reason}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${
        isStale
          ? 'bg-warning/12 text-warning ring-warning/25'
          : 'bg-muted text-muted-foreground ring-border/60'
      } ${className}`}
    >
      <Icon size={10} aria-hidden="true" />
      {confidence.label}
      <span className="sr-only"> — {confidence.reason}</span>
    </span>
  )
}
