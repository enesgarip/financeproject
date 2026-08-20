import type { ReactNode } from 'react'

/**
 * Şerit'te ayrım gölgeyle değil çizgiyle yapılır — ama o çizgi bugüne kadar her
 * dosyada elle yazılıyordu (`border-t border-line`, `border-border/70`,
 * ham renkli `h-px`…). Aynı işin üç farklı kalınlıkta üç ayrı yazımı vardı;
 * bu bileşen ayıracı tek yere topluyor.
 *
 * İki ton kasıtlı olarak ayrı:
 *  - `line`   → **liste içi** satır ayıracı (zayıf; satırları bağlı tutar).
 *  - `strong` → **blok/bölüm** ayıracı (kenarlıkla aynı ton).
 *
 * Ardışık satırları ayırmak için `LineGroup` yeterlidir (kendi ayıracını çizer);
 * bu bileşen tekil ayrımlar içindir: bölüm sonu, form grubu, modal altlığı.
 */
export function Divider({
  orientation = 'horizontal',
  tone = 'line',
  space = 'md',
  label,
  className = '',
}: {
  orientation?: 'horizontal' | 'vertical'
  tone?: 'line' | 'strong'
  /** Ayıracın kendi dış boşluğu. Kap zaten boşluk veriyorsa `none`. */
  space?: 'none' | 'sm' | 'md'
  /** Ortada metin ("veya", "geçmiş"). Yalnız yatay ayıraçta anlamlı. */
  label?: ReactNode
  className?: string
}) {
  const toneClass = tone === 'strong' ? 'bg-line-strong' : 'bg-line'

  if (orientation === 'vertical') {
    const spaceClass = space === 'none' ? '' : space === 'sm' ? 'mx-2' : 'mx-3'
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        className={`w-px self-stretch shrink-0 ${toneClass} ${spaceClass} ${className}`}
      />
    )
  }

  const spaceClass = space === 'none' ? '' : space === 'sm' ? 'my-2' : 'my-4'

  if (label) {
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        className={`flex items-center gap-3 ${spaceClass} ${className}`}
      >
        <span className={`h-px flex-1 ${toneClass}`} />
        <span className="serit-eyebrow shrink-0">{label}</span>
        <span className={`h-px flex-1 ${toneClass}`} />
      </div>
    )
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={`h-px w-full ${toneClass} ${spaceClass} ${className}`}
    />
  )
}
