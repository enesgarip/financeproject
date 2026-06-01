import * as React from "react"

import { cn } from "@/lib/utils"

const controlClassName =
  "w-full rounded-lg border border-input bg-background/85 px-3 text-base font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] outline-none transition placeholder:text-muted-foreground/65 focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/15 dark:bg-surface-muted/85 dark:shadow-none"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-11 min-w-0",
        type === "date" && "appearance-none [color-scheme:light] dark:[color-scheme:dark]",
        controlClassName,
        className,
      )}
      {...props}
    />
  )
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn("h-11 min-w-0 bg-background", controlClassName, className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-24 min-w-0 resize-y py-3", controlClassName, className)}
      {...props}
    />
  )
}

export { Input, Select, Textarea }
