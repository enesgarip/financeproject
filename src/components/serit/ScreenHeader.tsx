import type { ReactNode } from 'react'

/**
 * Her Şerit ekranının ilk satırı: solda ekranın adı (uppercase eyebrow), sağda
 * bağlam ("4 hesap · 3 kart", "30 gün"). Ekran eyebrow'u bölüm eyebrow'undan
 * biraz daha geniş harf aralığı kullanır (.14em / .12em) — hiyerarşi farkı bu.
 */
export function ScreenHeader({ eyebrow, context }: { eyebrow: string; context?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="serit-eyebrow" style={{ letterSpacing: '0.14em' }}>
        {eyebrow}
      </p>
      {context ? <span className="shrink-0 text-xs text-ink-faint">{context}</span> : null}
    </div>
  )
}

/** Bölüm başlığı. Ayrı bileşen çünkü ekran başına birden çok kez geçer. */
export function SectionEyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`serit-eyebrow ${className}`}>{children}</p>
}
