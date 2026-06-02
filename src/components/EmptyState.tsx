import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border border-dashed border-border/90 bg-card/90 px-5 py-10 text-center shadow-[var(--shadow-card)] sm:px-8 sm:py-12">
      <div className="mx-auto grid size-12 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
        <Inbox size={21} />
      </div>
      <h3 className="mt-4 text-lg font-black leading-snug text-foreground">{title}</h3>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}
