import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent",
    "bg-clip-padding text-sm font-semibold whitespace-nowrap select-none",
    "transition-all outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "active:scale-[0.97] active:not-aria-[haspopup]:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)]",
          "hover:bg-primary/90 hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--primary)_40%,transparent)]",
        ].join(" "),
        outline: [
          "border-border bg-card/80 text-foreground",
          "hover:bg-muted hover:border-border/80",
          "dark:bg-card/40 dark:hover:bg-muted/60",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground border-border/40",
          "hover:bg-secondary/80",
        ].join(" "),
        ghost: [
          "text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "dark:hover:bg-muted/50",
        ].join(" "),
        destructive: [
          "bg-destructive/10 text-destructive border-destructive/20",
          "hover:bg-destructive/18 hover:border-destructive/35",
          "dark:bg-destructive/15 dark:hover:bg-destructive/25",
        ].join(" "),
        success: [
          "bg-success text-success-foreground",
          "shadow-[0_2px_8px_color-mix(in_srgb,var(--success)_28%,transparent)]",
          "hover:bg-success/90",
        ].join(" "),
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto!",
      },
      size: {
        xs:      "h-7  px-2    text-xs  rounded-md gap-1    [&_svg:not([class*='size-'])]:size-3",
        sm:      "h-9  px-3    text-xs  rounded-md gap-1.5  [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-10 px-4    text-sm",
        lg:      "h-11 px-5    text-sm",
        xl:      "h-12 px-6    text-base font-bold",
        icon:        "size-10 rounded-lg",
        "icon-xs":   "size-7  rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":   "size-9  rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg":   "size-11 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
