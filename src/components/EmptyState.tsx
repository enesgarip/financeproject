type EmptyStateProps = {
  title: string
  description: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-dashed border-border bg-card/80 px-6 py-12 text-center shadow-sm">
      <h3 className="text-base font-black text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
    </div>
  )
}
