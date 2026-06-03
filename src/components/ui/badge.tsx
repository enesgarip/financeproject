import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex items-center justify-center gap-1 rounded-full border border-transparent",
    "px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
    "transition-colors",
    "[&>svg]:pointer-events-none [&>svg]:size-3!",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary/15 text-primary border-primary/20 dark:bg-primary/20 dark:text-primary",
        secondary:
          "bg-secondary text-secondary-foreground border-border/50",
        destructive:
          "bg-destructive/12 text-destructive border-destructive/20 dark:bg-destructive/18",
        success:
          "bg-success/12 text-success border-success/20 dark:bg-success/18",
        warning:
          "bg-warning/12 text-warning border-warning/20 dark:bg-warning/18",
        info:
          "bg-info/12 text-info border-info/20 dark:bg-info/18",
        outline:
          "border-border text-muted-foreground",
        ghost:
          "text-muted-foreground hover:bg-muted",
        solid:
          "bg-primary text-primary-foreground border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
