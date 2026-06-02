import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { bankBrandGradient, getBankBrand } from '@/utils/bankBranding'

type BankLogoSize = 'xs' | 'sm' | 'md' | 'lg'

const sizeClass: Record<BankLogoSize, string> = {
  xs: 'size-8 rounded-lg text-[10px]',
  sm: 'size-9 rounded-lg text-[11px]',
  md: 'size-11 rounded-xl text-xs',
  lg: 'size-12 rounded-xl text-sm',
}

/**
 * Banka adından marka renkli, monogramlı bir rozet üretir. Telifli logo
 * görseli kullanmadan tanınır ve premium bir kimlik verir.
 */
export function BankLogo({
  bankName,
  size = 'md',
  className,
  style,
  title,
}: {
  bankName: string | null | undefined
  size?: BankLogoSize
  className?: string
  style?: CSSProperties
  title?: string
}) {
  const brand = getBankBrand(bankName)

  return (
    <div
      aria-hidden="true"
      title={title ?? brand.name}
      style={{ backgroundImage: bankBrandGradient(bankName), ...style }}
      className={cn(
        'grid shrink-0 place-items-center font-black uppercase leading-none tracking-tight text-white shadow-sm ring-1 ring-black/15',
        sizeClass[size],
        className,
      )}
    >
      {brand.code}
    </div>
  )
}
