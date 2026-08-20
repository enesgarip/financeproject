import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Şerit v2 Faz 2: form alanları da dilin token'larına bağlandı — kenarlık
 * `line-strong`, zemin `raised`, metin `ink`, ipucu `ink-faint`. Sinyal
 * renkleri (`destructive`) semantik katmanda kalır — Faz 8'de `--signal-*`
 * takma adları kaldırıldı, tek sinyal kümesi bu.
 */
const baseInputClass = [
  "w-full rounded-xl border border-line-strong bg-raised px-3 text-sm font-medium text-ink",
  "outline-none transition-all placeholder:text-ink-faint",
  "focus:border-ring focus:ring-2 focus:ring-ring/20",
  "disabled:cursor-not-allowed disabled:bg-page disabled:text-ink-faint disabled:opacity-60",
  "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/20",
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
        "h-10 min-w-0 cursor-pointer",
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
