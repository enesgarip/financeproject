import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type ProgressColor = "primary" | "success" | "warning" | "danger" | "info"

const colorMap: Record<ProgressColor, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger:  "bg-destructive",
  info:    "bg-info",
}

function getAutoColor(value: number): ProgressColor {
  if (value >= 90) return "danger"
  if (value >= 75) return "warning"
  return "success"
}

function Progress({
  className,
  value,
  color,
  autoColor = false,
  size = "default",
  animated = true,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  color?: ProgressColor
  autoColor?: boolean
  size?: "xs" | "sm" | "default" | "lg"
  animated?: boolean
}) {
  const resolvedColor = color ?? (autoColor ? getAutoColor(value ?? 0) : "primary")
  const colorClass = colorMap[resolvedColor]

  const heightClass = {
    xs:      "h-0.5",
    sm:      "h-1",
    default: "h-1.5",
    lg:      "h-2.5",
  }[size]

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex w-full items-center overflow-hidden rounded-full",
        "bg-muted/70 dark:bg-muted/40",
        heightClass,
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "size-full flex-1 rounded-full",
          colorClass,
          animated && "transition-transform duration-700 ease-out",
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
