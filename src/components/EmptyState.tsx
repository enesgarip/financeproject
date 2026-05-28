type EmptyStateProps = {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card/70 px-6 py-12 text-center shadow-sm">
      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-stone-500 dark:text-stone-400">{description}</p>
    </div>
  )
}
