import type { ReactNode } from 'react'
import { SERIT_FILL, type SeritTone } from './tone'
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
}: {
  label: string
  value: number | null | undefined
  tone?: SeritTone
  description?: ReactNode
  /** 0–100. Verilirse rakamın altına 4px'lik ilerleme çubuğu çizilir. */
  progress?: number
  progressTone?: SeritTone
}) {
  const amount = useSeritAmount()
  const { amount: text, unit } = amount(value)

  return (
    <div>
      <p
        className="uppercase text-ink-faint"
        style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}
      >
        {label}
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2 lg:mt-1.5">
        <p
          className="serit-num text-[46px] font-semibold min-[400px]:text-[52px] lg:text-[62px]"
          style={{ lineHeight: 0.95, letterSpacing: '-0.045em', color: SERIT_FILL[tone] }}
        >
          {text}
          <span className="text-[19px] text-ink-faint lg:text-[23px]"> {unit}</span>
        </p>

        {description ? (
          <p className="mb-2 max-w-[240px] text-[13px] leading-[1.5] text-ink-muted lg:mb-3">{description}</p>
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
