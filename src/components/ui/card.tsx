import * as React from "react"

import { cn } from "@/lib/utils"

type CardVariant = "default" | "elevated" | "glass" | "interactive" | "outline" | "flat"
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
   * Şerit v2: kart yasağı kalktı, yerine **üç meşru gerekçe** geldi — bağımsız
   * nesne (araç, kredi, hedef, kart), aksiyon/araç bloğu (form, sihirbaz,
   * hesaplayıcı) ve grafik bloğu. Homojen satır verisi hâlâ karta değil
   * `LineGroup`a gider; kural `docs/UI_ARCHITECTURE.md`de.
   *
   * Görsel: zemin (`raised`) + 1px `line-strong` + **tek kademe hafif gölge**
   * (`--shadow-card`). Gölge ayrımı yapan şey değil, yalnız bloğu zeminden bir
   * tık ayıran şey — bu yüzden iki kademe yok ve iç içe bloklarda kullanılmaz.
   *
   * `variant` API'si korunuyor — 40+ çağıran var:
   *  - `default`/`elevated` → gölgeli blok (aynı görünür, ikisi de meşru kart),
   *  - `flat`               → kart içinde kart olduğunda gölgesiz kalan blok,
   *  - `outline`            → zeminsiz, yalnız kenarlık,
   *  - `interactive`        → hover zemini alan tıklanabilir kart.
   */
  const variantClass: Record<CardVariant, string> = {
    default: "border border-line-strong bg-raised text-ink shadow-[var(--shadow-card)]",
    elevated: "border border-line-strong bg-raised text-ink shadow-[var(--shadow-card)]",
    glass:
      "border border-line-strong bg-raised/85 text-ink shadow-[var(--shadow-card)] backdrop-blur-xl",
    interactive: [
      "border border-line-strong bg-raised text-ink cursor-pointer",
      "shadow-[var(--shadow-card)] transition-colors duration-[120ms]",
      "hover:bg-black/[.02] dark:hover:bg-white/[.03]",
    ].join(" "),
    outline: "border border-line-strong bg-transparent text-ink",
    flat: "border border-line-strong bg-raised text-ink",
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
