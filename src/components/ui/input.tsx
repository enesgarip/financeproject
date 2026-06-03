import * as React from "react"
import { cn } from "@/lib/utils"

const baseInputClass = [
  "w-full rounded-xl border border-input bg-card/80 px-3 text-sm font-medium text-foreground",
  "outline-none transition-all placeholder:text-muted-foreground/50",
  "focus:border-ring focus:ring-2 focus:ring-ring/20 focus:bg-card",
  "disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-60",
  "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/20",
  "dark:bg-card/50 dark:focus:bg-card/70",
].join(" ")

function Input({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-10 min-w-0",
        type === "date" && "appearance-none [color-scheme:light] dark:[color-scheme:dark]",
        baseInputClass,
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
      className={cn(
        "h-10 min-w-0 cursor-pointer bg-card/80 dark:bg-card/50",
        baseInputClass,
        className,
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 min-w-0 resize-y py-2.5",
        baseInputClass,
        className,
      )}
      {...props}
    />
  )
}

/** Currency-aware input with ₺ prefix and monospace font */
function CurrencyInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
        ₺
      </span>
      <input
        data-slot="input"
        type="number"
        inputMode="decimal"
        step="0.01"
        className={cn(
          "h-10 min-w-0 pl-7",
          "font-mono text-right tracking-tight tabular-nums",
          baseInputClass,
          className,
        )}
        {...props}
      />
    </div>
  )
}

/** Input with leading icon */
function InputWithIcon({
  icon,
  className,
  ...props
}: React.ComponentProps<"input"> & { icon: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {icon}
      </span>
      <Input className={cn("pl-9", className)} {...props} />
    </div>
  )
}

export { Input, Select, Textarea, CurrencyInput, InputWithIcon }
