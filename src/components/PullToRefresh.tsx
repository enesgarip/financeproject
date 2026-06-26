import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePullToRefresh } from '../hooks/usePullToRefresh'

export function PullToRefresh({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { pullDistance, refreshing, progress } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ type: 'active' })
  })

  return (
    <>
      <div
        className="pointer-events-none flex items-center justify-center overflow-hidden"
        style={{
          height: pullDistance,
          transition: refreshing || pullDistance === 0 ? 'height 0.2s ease' : 'none',
        }}
        aria-hidden={pullDistance === 0}
      >
        <RefreshCw
          size={20}
          className={refreshing ? 'animate-spin text-primary' : 'text-muted-foreground'}
          style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: progress }}
        />
      </div>
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance * 0.4}px)` : undefined,
          transition: refreshing || pullDistance === 0 ? 'transform 0.2s ease' : 'none',
        }}
      >
        {children}
      </div>
    </>
  )
}
