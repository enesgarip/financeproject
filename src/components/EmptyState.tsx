type EmptyStateProps = {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center shadow-sm dark:border-stone-700 dark:bg-stone-950/80">
      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-stone-500 dark:text-stone-400">{description}</p>
    </div>
  )
}
