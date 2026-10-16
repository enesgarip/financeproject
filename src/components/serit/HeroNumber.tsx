import { useEffect, useRef, type ReactNode } from 'react'
import { SERIT_FILL, SERIT_TEXT, type SeritTone } from './tone'
import { useSeritAmount } from './useSeritAmount'

/**
 * Ekranın cevapladığı TEK soru, dev mono rakam olarak. Şerit'in kuralı: her ekranda
 * bir tane, en üstte. Rakamın kendisi `ink`; renk buraya yalnız gerçekten kritikse
 * girer (`tone`).
 *
 * Ölçek handoff'tan: 46px mobil → 62px masaüstü, ağırlık 600, line-height .95,
 * letter-spacing -.045em; birim 19/23px ve `ink-faint`.
 */
export function HeroNumber({
  label,
  value,
  tone = 'ink',
  description,
  progress,
  progressTone = 'brand',
  unitOverride,
  unavailable = false,
}: {
  label: string
  value: number | null | undefined
  tone?: SeritTone
  description?: ReactNode
  /** 0–100. Verilirse rakamın altına 4px'lik ilerleme çubuğu çizilir. */
  progress?: number
  progressTone?: SeritTone
  /**
   * Para olmayan kahraman rakamlar için birim ("bulgu", "gün"). Verildiğinde
   * tutar biçimlendirmesi ve gizlilik maskesi UYGULANMAZ — bir sayaç gizlenecek
   * bakiye değildir ve `••••` orada bilgi kaybı olur.
   */
  unitOverride?: string
  /** Sorgu doğrulanamadığında sıfır toplam izlenimi vermeden göster. */
  unavailable?: boolean
}) {
  const amount = useSeritAmount()
  const money = amount(value)
  const text = unavailable ? '—' : unitOverride ? String(value ?? 0) : money.amount
  const unit = unavailable ? '' : unitOverride ?? money.unit
  const numberRef = useRef<HTMLParagraphElement>(null)
  const previousValue = useRef(value)
  useEffect(() => {
    const element = numberRef.current
    if (previousValue.current != null && value != null && previousValue.current !== value && element?.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.animate([{ backgroundColor: 'var(--accent)' }, { backgroundColor: 'transparent' }], { duration: 180, easing: 'ease-out' })
    }
    previousValue.current = value
  }, [value])

  return (
    <div>
      <p
        className="text-[13px] font-medium leading-5 text-ink-muted"
      >
        {label}
      </p>

      <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end lg:gap-x-5">
        <p
          ref={numberRef}
          className="serit-num max-w-full break-words text-[36px] font-semibold min-[400px]:text-[40px] lg:text-[56px]"
          style={{ lineHeight: 1.1, letterSpacing: '-0.04em', color: SERIT_TEXT[tone], fontSize: text.length > 10 ? 'clamp(1.5rem, 7vw, 3.5rem)' : undefined }}
        >
          {text}
          <span className="text-[19px] text-ink-faint lg:text-[23px]"> {unit}</span>
        </p>

        {description ? (
          <p className="max-w-md text-[13px] leading-relaxed text-ink-muted lg:mb-1">{description}</p>
        ) : null}
      </div>

      {progress === undefined ? null : (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-track" role="presentation">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%`, background: SERIT_FILL[progressTone] }}
          />
        </div>
      )}
    </div>
  )
}
