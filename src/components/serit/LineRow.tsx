import type { ReactNode } from 'react'
import type { SeritAmountOptions } from '../../utils/formatCurrency'
import { SERIT_TEXT, type SeritTone } from './tone'
import { useSeritAmount } from './useSeritAmount'

/**
 * Şerit'in 4. kuralı: **liste = çizgi, kart değil.** Satırlar bir kap içinde
 * gruplanır, aralarında 1px ayıraç olur, son satırda ayıraç olmaz.
 *
 * İki kap biçimi var:
 *  - `plain`  → zeminsiz, sayfa zemininde durur; ayıraç 1px `line`. Baskın biçim.
 *  - `raised` → 14px yarıçaplı yükseltilmiş blok; ayıraç, 1px'lik boşluktan sızan
 *               `line-strong` zeminidir. Ekran başına 1-2 taneyle sınırlı (6. kural),
 *               bu yüzden kasıtlı olarak varsayılan DEĞİL.
 *
 * Satır zemini/padding'i kap belirler — satır bileşeni hangi grupta olduğunu
 * bilmez, aksi halde her çağıran ikisini elle eşlemek zorunda kalırdı.
 */
export function LineGroup({
  children,
  variant = 'plain',
  className = '',
}: {
  children: ReactNode
  variant?: 'plain' | 'raised'
  className?: string
}) {
  if (variant === 'raised') {
    return (
      <div
        className={`flex flex-col gap-px overflow-hidden rounded-[14px] border border-line-strong bg-line-strong [&>*]:bg-raised [&>*]:px-3.5 ${className}`}
      >
        {children}
      </div>
    )
  }

  return <div className={`[&>*+*]:border-t [&>*+*]:border-line ${className}`}>{children}</div>
}

export function LineRow({
  lead,
  title,
  subtitle,
  amount,
  amountOptions,
  amountTone = 'ink',
  trailing,
  onClick,
}: {
  /** Sol blok: gün rozeti, tarih sütunu veya renk çubuğu. */
  lead?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  amount?: number | null
  amountOptions?: SeritAmountOptions
  amountTone?: SeritTone
  /** Tutarın altına düşen ikincil içerik (ör. "Öde" metin butonu). */
  trailing?: ReactNode
  onClick?: () => void
}) {
  const format = useSeritAmount()
  const money = amount === undefined || amount === null ? null : format(amount, amountOptions)

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {lead}
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold text-ink">{title}</p>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p> : null}
        </div>
      </div>

      <div className="shrink-0 text-right">
        {money ? (
          <p className="serit-num text-[17px] font-semibold" style={{ color: SERIT_TEXT[amountTone] }}>
            {money.amount} {money.unit}
          </p>
        ) : null}
        {trailing}
      </div>
    </>
  )

  const shell = 'flex w-full items-center justify-between gap-3 py-[13px] text-left'

  if (!onClick) return <div className={shell}>{body}</div>

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03]`}
    >
      {body}
    </button>
  )
}

/**
 * "3g" / "12g" gün rozeti — kalan süreyi tipin rengiyle çerçeveler. Rakam mono
 * olmalı ki farklı basamak sayıları (3g / 12g / 22g) aynı genişlikte dursun.
 */
export function DayBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: SeritTone }) {
  const color = SERIT_TEXT[tone]
  return (
    <span
      className="serit-num shrink-0 rounded-md border px-1.5 py-[3px] text-[11px]"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      {children}
    </span>
  )
}
