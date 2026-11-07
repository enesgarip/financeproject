import { useState, type ReactNode } from 'react'

/** İlk açılışa kadar veri çeken çocukları kurmaz; sonra form durumunu korur. */
export function DeferredDetails({ summary, children, className, summaryClassName, defaultOpen = false, openRequestKey }: {
  summary: ReactNode
  children: ReactNode
  className?: string
  summaryClassName?: string
  defaultOpen?: boolean
  /** Yeni doğrudan bağlantı bölümü açar; kullanıcı yine kapatabilir. */
  openRequestKey?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [visited, setVisited] = useState(defaultOpen)
  const [dismissedRequest, setDismissedRequest] = useState<string | undefined>()
  const isOpen = open || (openRequestKey !== undefined && openRequestKey !== dismissedRequest)

  return (
    <details className={className} open={isOpen} onToggle={(event) => {
      if (event.target !== event.currentTarget) return
      const nextOpen = event.currentTarget.open
      setOpen(nextOpen)
      if (!nextOpen) setDismissedRequest(openRequestKey)
      setVisited(true)
    }}>
      <summary className={summaryClassName}>{summary}</summary>
      {visited || isOpen ? children : null}
    </details>
  )
}
