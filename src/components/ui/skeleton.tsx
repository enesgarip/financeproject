import { cn } from "@/lib/utils"

/** Single skeleton block with shimmer sweep animation */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-xl", className)}
      {...props}
    />
  )
}

/** Pre-built skeleton layouts for common dashboard patterns */

function SkeletonHero() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/40 bg-card p-6">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-10 w-52" />
          <Skeleton className="mt-1 h-14 w-44" />
        </div>
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-border/30 bg-muted/20 p-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonMetricGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
          <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-8 rounded-xl" />
          </div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  )
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4">
      <div className="flex items-center justify-between pb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border/20 bg-muted/20 p-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3" style={{ width: `${40 + (i % 4) * 12}%` }} />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function SkeletonDashboard() {
  return (
    <div className="flex flex-col gap-5">
      <SkeletonHero />
      <SkeletonMetricGrid count={4} />
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl lg:w-56" />
      </div>
      <SkeletonTable rows={4} />
    </div>
  )
}

export { Skeleton, SkeletonHero, SkeletonMetricGrid, SkeletonCard, SkeletonTable, SkeletonDashboard }
