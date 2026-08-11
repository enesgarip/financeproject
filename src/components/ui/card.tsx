import * as React from "react"

import { cn } from "@/lib/utils"

type CardVariant = "default" | "elevated" | "glass" | "interactive" | "outline"
type CardSize = "default" | "sm" | "lg"

function Card({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: CardSize
  variant?: CardVariant
}) {
  /**
   * Şerit'e geçişte kartın kendisi sadeleşti: **gölge yok**, ayrım 1px
   * `line-strong` ve `raised` zeminle yapılıyor. Bu, tek tek dönüştürülmemiş
   * yüzeyleri (araçlar, gider bağlamları, modal/form içleri, detay panelleri)
   * dosya dosya dolaşmadan aynı dile getirir.
   *
   * `variant` API'si korunuyor — 40+ çağıran var — ama görsel fark artık
   * gölge/parlaklık değil, zemin ve kenarlık tonu. `elevated` "yükseltilmiş
   * blok"tur (Şerit'in ekran başına 1-2 taneyle sınırladığı yüzey), `outline`
   * zeminsizdir, `interactive` yalnız hover zemini alır.
   */
  const variantClass: Record<CardVariant, string> = {
    default: "border border-line-strong bg-raised text-ink",
    elevated: "border border-line-strong bg-raised text-ink",
    glass: "border border-line-strong bg-raised/85 text-ink backdrop-blur-xl",
    interactive: [
      "border border-line-strong bg-raised text-ink cursor-pointer",
      "transition-colors duration-[120ms]",
      "hover:bg-black/[.02] dark:hover:bg-white/[.03]",
    ].join(" "),
    outline: "border border-line-strong bg-transparent text-ink",
  }

  const sizeClass: Record<CardSize, string> = {
    sm:      "gap-3 py-3 rounded-[12px]",
    default: "gap-4 py-4 rounded-[14px]",
    lg:      "gap-5 py-5 rounded-[14px]",
  }

  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(
        "group/card flex flex-col overflow-hidden text-sm",
        sizeClass[size],
        variantClass[variant],
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 px-5",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "group-data-[size=sm]/card:px-4",
        "group-data-[size=lg]/card:px-6",
        "[.border-b]:pb-4",
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base font-semibold leading-snug tracking-tight text-ink",
        "group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-ink-muted leading-relaxed", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        "px-5 group-data-[size=sm]/card:px-4 group-data-[size=lg]/card:px-6",
        className,
      )}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-line px-5 py-3",
        "group-data-[size=sm]/card:px-4 group-data-[size=lg]/card:px-6",
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
