import { SERIT_FILL, type SeritTone } from './tone'
import { useSeritAmount } from './useSeritAmount'

export type BreakdownSegment = {
  label: string
  value: number
  tone: SeritTone
  /**
   * Sinyal paletini aşan kimlik rengi (varlık sınıfı, gider kategorisi).
   * Şerit "renk yalnızca sinyal" der ama bu kural DURUM için geçerli; bir
   * kompozisyon diliminin rengi kimliktir ve repo'nun CVD-doğrulanmış viz
   * paleti (`components/charts/vizPalette.ts`) orada daha doğru sonuç verir.
   */
  color?: string
}

/**
 * Şerit'in 7. kuralı: bileşenli tutarlar (kart borcu kovaları, varlık dağılımı,
 * ay gideri) pasta değil **yatay kırılım çubuğu** + altında etiket/değer üçlüsü.
 *
 * Sıfır toplamda çubuk tamamen boş `track` kalır — sıfıra bölme yerine, kullanıcı
 * "veri yok" ile "hepsi tek kovada" arasını ayırt edebilsin diye.
 */
export function BreakdownBar({
  segments,
  height = 10,
  showValues = true,
}: {
  segments: BreakdownSegment[]
  height?: number
  showValues?: boolean
}) {
  const format = useSeritAmount()
  const total = segments.reduce((acc, segment) => acc + Math.max(0, segment.value), 0)

  return (
    <div>
      <div
        className="flex gap-0.5 overflow-hidden rounded-full bg-track"
        style={{ height }}
        role="presentation"
      >
        {total > 0
          ? segments.map((segment) => (
              <div
                key={segment.label}
                className="transition-[width] duration-200 ease-out"
                style={{
                  width: `${(Math.max(0, segment.value) / total) * 100}%`,
                  background: segment.color ?? SERIT_FILL[segment.tone],
                }}
              />
            ))
          : null}
      </div>

      {showValues ? (
        <div className="mt-3 flex justify-between gap-3">
          {segments.map((segment, index) => {
            const money = format(segment.value)
            return (
              <div key={segment.label} className={index === segments.length - 1 ? 'text-right' : undefined}>
                <p className="text-xs text-ink-muted">{segment.label}</p>
                <p className="serit-num mt-0.5 text-sm font-semibold text-ink">{money.amount}</p>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
