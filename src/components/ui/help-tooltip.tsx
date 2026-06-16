import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export type HelpTooltipContent = {
  calculation: string
  importance: string
  source: string
}

type HelpTooltipProps = {
  title: string
  content: HelpTooltipContent
  className?: string
}

const helpRows = [
  { key: "calculation", label: "Nasıl hesaplanıyor?" },
  { key: "importance", label: "Neden önemli?" },
  { key: "source", label: "Veriler nereden geliyor?" },
] as const

export function HelpTooltip({ title, content, className }: HelpTooltipProps) {
  const tooltipId = React.useId()
  const rootRef = React.useRef<HTMLSpanElement>(null)
  const tooltipRef = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = React.useState(false)
  const [locked, setLocked] = React.useState(false)
  const [position, setPosition] = React.useState<{
    top: number
    left: number
    width: number
    placement: "top" | "bottom"
  } | null>(null)
  const visible = hovered || locked

  React.useEffect(() => {
    if (!visible) return

    function updatePosition() {
      const button = buttonRef.current
      if (!button) return

      const rect = button.getBoundingClientRect()
      const width = Math.min(288, window.innerWidth - 24)
      const centeredLeft = rect.left + rect.width / 2 - width / 2
      const left = Math.min(Math.max(12, centeredLeft), window.innerWidth - width - 12)
      const hasRoomBelow = window.innerHeight - rect.bottom >= 220

      setPosition({
        top: hasRoomBelow ? rect.bottom + 8 : rect.top - 8,
        left,
        width,
        placement: hasRoomBelow ? "bottom" : "top",
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [visible])

  React.useEffect(() => {
    if (!locked) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && (rootRef.current?.contains(target) || tooltipRef.current?.contains(target))) return
      setLocked(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLocked(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [locked])

  const tooltip =
    visible && position && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{ top: position.top, left: position.left, width: position.width }}
            className={cn(
              "fixed z-[60] rounded-lg border border-border bg-popover p-3 text-left text-xs text-popover-foreground shadow-[var(--shadow-elevated)] ring-1 ring-black/[0.025] dark:ring-white/[0.06]",
              position.placement === "top" && "-translate-y-full",
            )}
          >
            <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-foreground">{title}</p>
            <dl className="space-y-2">
              {helpRows.map((row) => (
                <div key={row.key}>
                  <dt className="font-bold text-muted-foreground">{row.label}</dt>
                  <dd className="mt-0.5 leading-5 text-foreground/90">{content[row.key]}</dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )
      : null

  return (
    <span
      ref={rootRef}
      className={cn("inline-flex align-middle", className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${title} hakkında bilgi`}
        aria-controls={visible ? tooltipId : undefined}
        aria-expanded={visible}
        aria-describedby={visible ? tooltipId : undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setLocked((current) => !current)
        }}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="inline-grid size-7 shrink-0 place-items-center rounded-full text-[15px] font-black leading-none text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      {tooltip}
    </span>
  )
}
