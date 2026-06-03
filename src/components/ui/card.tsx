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
  const variantClass: Record<CardVariant, string> = {
    default: [
      "border border-border/80 bg-card text-card-foreground",
      "shadow-[var(--shadow-card)]",
      "dark:ring-1 dark:ring-white/[0.04]",
    ].join(" "),
    elevated: [
      "border border-border/60 bg-card text-card-foreground",
      "shadow-[var(--shadow-lifted)]",
      "dark:bg-[#1a1d26] dark:ring-1 dark:ring-white/[0.06]",
    ].join(" "),
    glass: [
      "border border-border/60 text-card-foreground",
      "bg-card/70 backdrop-blur-xl",
      "shadow-[var(--shadow-card)]",
      "dark:bg-card/40",
    ].join(" "),
    interactive: [
      "border border-border/80 bg-card text-card-foreground cursor-pointer",
      "shadow-[var(--shadow-card)]",
      "transition-all duration-250",
      "hover:-translate-y-0.5 hover:shadow-[var(--shadow-floating)] hover:border-primary/25",
      "active:translate-y-0 active:shadow-[var(--shadow-card)]",
      "dark:ring-1 dark:ring-white/[0.04]",
    ].join(" "),
    outline: [
      "border border-border bg-transparent text-card-foreground",
    ].join(" "),
  }

  const sizeClass: Record<CardSize, string> = {
    sm:      "gap-3 py-3 rounded-xl",
    default: "gap-4 py-4 rounded-2xl",
    lg:      "gap-5 py-5 rounded-2xl",
  }

  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(
        "group/card flex flex-col overflow-hidden text-sm transition-shadow",
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
        "text-base font-bold leading-snug tracking-tight text-card-foreground",
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
      className={cn("text-sm text-muted-foreground leading-relaxed", className)}
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
        "flex items-center border-t border-border/60 bg-muted/30 px-5 py-3",
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
