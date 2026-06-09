import { cn } from '../lib/utils'

type AppMarkProps = {
  className?: string
}

export function AppMark({ className }: AppMarkProps) {
  return (
    <img
      src="/icon.svg"
      alt=""
      aria-hidden="true"
      className={cn('block shrink-0 overflow-hidden rounded-xl object-cover', className)}
    />
  )
}
