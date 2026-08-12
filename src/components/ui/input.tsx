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

// `CurrencyInput` SİLİNDİ (denetim 2026-08-12 §3): para girişinin iki ayrı
// bileşeni vardı ve virgül/negatif davranışları farklıydı. Tek para girişi
// `components/finance/MoneyInput.tsx` — `parseNumber` ile TR virgülünü de kabul
// eder ve girilen tutarı biçimlenmiş olarak altında gösterir.
export { Input, Select, Textarea }
