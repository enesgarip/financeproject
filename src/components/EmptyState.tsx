import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-dashed border-border/90 bg-card/85 px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
        <Inbox size={21} />
      </div>
      <h3 className="mt-4 text-base font-black text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}
