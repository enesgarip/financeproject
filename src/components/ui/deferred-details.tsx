import { useState, type ReactNode } from 'react'

/** İlk açılışa kadar veri çeken çocukları kurmaz; sonra form durumunu korur. */
export function DeferredDetails({ summary, children, className, summaryClassName, defaultOpen = false }: {
  summary: ReactNode
  children: ReactNode
  className?: string
  summaryClassName?: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [visited, setVisited] = useState(defaultOpen)

  return (
    <details className={className} open={open} onToggle={(event) => {
      if (event.target !== event.currentTarget) return
      const nextOpen = event.currentTarget.open
      setOpen(nextOpen)
      if (nextOpen) setVisited(true)
    }}>
      <summary className={summaryClassName}>{summary}</summary>
      {visited ? children : null}
    </details>
  )
}
