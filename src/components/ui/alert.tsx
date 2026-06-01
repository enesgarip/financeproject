import * as React from "react"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm shadow-sm",
  {
    variants: {
      variant: {
        info: "border-info/20 bg-info/10 text-info dark:border-info/30 dark:bg-info/15 dark:text-info",
        success:
          "border-success/20 bg-success/10 text-success dark:border-success/30 dark:bg-success/15 dark:text-success",
        warning:
          "border-warning/25 bg-warning/12 text-warning dark:border-warning/35 dark:bg-warning/15 dark:text-warning",
        destructive:
          "border-destructive/20 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/15 dark:text-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
)

function Alert({
  className,
  variant = "info",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = variant === "success" ? CheckCircle2 : variant === "warning" || variant === "destructive" ? AlertTriangle : Info

  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 leading-6">{children}</div>
    </div>
  )
}

export { Alert, alertVariants }
