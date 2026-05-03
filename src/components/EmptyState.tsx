type EmptyStateProps = {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-5 py-10 text-center dark:border-stone-700 dark:bg-stone-900">
      <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
    </div>
  )
}
