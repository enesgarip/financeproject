import { SERIT_FILL } from './tone'

/**
 * Şerit'in trend grafiği: geçmiş çubuklar `chart-idle`, **sonuncusu jade**.
 * Eksen, ızgara ve tooltip yok — bu grafik bir sayı değil, bir yön okutur;
 * kesin değer hep yanındaki cümlede yazar.
 *
 * Negatif değerler mutlak yükseklikle çizilir: seri (net değer, maaş) tek
 * yönlüdür, sıfır çizgisi eklemek okunurluğu artırmıyor.
 */
export function TrendBars({
  values,
  height = 64,
  label,
}: {
  values: number[]
  height?: number
  /** Ekran okuyucu için tek cümlelik özet; görsel karşılığı altındaki metindir. */
  label: string
}) {
  const max = values.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0)

  return (
    <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={label}>
      {values.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-t-[2px] transition-[height] duration-200 ease-out"
          style={{
            // Sıfır seride bile çubuklar görünsün diye taban yükseklik.
            height: max === 0 ? '8%' : `${Math.max(8, (Math.abs(value) / max) * 100)}%`,
            background: index === values.length - 1 ? SERIT_FILL.brand : SERIT_FILL.idle,
          }}
        />
      ))}
    </div>
  )
}
