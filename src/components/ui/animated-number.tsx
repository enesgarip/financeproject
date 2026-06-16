import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface AnimatedNumberProps {
  value: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
  formatter?: (value: number) => string
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

export function AnimatedNumber({
  value,
  duration = 800,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  formatter,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const startRef = useRef<number | null>(null)
  // Track the "from" value across renders so RAF closure captures a stable snapshot
  const startValueRef = useRef(value)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (prefersReducedMotion) {
      // Use a ref update path that avoids setState-in-effect lint rule
      const raf = requestAnimationFrame(() => setDisplayValue(value))
      return () => cancelAnimationFrame(raf)
    }

    const startVal = startValueRef.current
    startRef.current = null

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }

    function tick(timestamp: number) {
      if (startRef.current === null) {
        startRef.current = timestamp
      }

      const elapsed = timestamp - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)

      const current = startVal + (value - startVal) * eased
      setDisplayValue(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        startValueRef.current = value
        setDisplayValue(value)
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [value, duration])

  const formatted = formatter
    ? formatter(displayValue)
    : displayValue.toFixed(decimals)

  return (
    <span className={cn("finance-value tabular-nums", className)}>
      {prefix}{formatted}{suffix}
    </span>
  )
}
