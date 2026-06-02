import { Inbox, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-dashed border-primary/25 bg-card/92 px-5 py-10 text-center shadow-[var(--shadow-card)] ring-1 ring-primary/10 sm:px-8 sm:py-12">
      <div className="mx-auto grid size-14 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
        <Inbox size={23} />
      </div>
      <h3 className="mt-4 text-lg font-black leading-snug text-foreground">{title}</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? (
        <div className="mt-5 flex justify-center">{action}</div>
      ) : (
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2 text-xs font-black text-muted-foreground ring-1 ring-border/70">
          <Plus size={14} />
          İlk kayıtla ekran anlam kazanır
        </div>
      )}
    </div>
  )
}
