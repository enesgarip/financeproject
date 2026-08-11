import type { MonthStrip, MonthStripTone } from '../../utils/dashboardMonthStrip'
import { SERIT_FILL, type SeritTone } from '../serit'

/**
 * Ay şeridi (`2a`/`4e`): kalan ay bir zaman çizgisi, her vade bir çubuk.
 * Yükseklik tutarı, renk tipi verir. Ekran başına izin verilen 1-2 yükseltilmiş
 * bloktan biri budur (grafik istisnası).
 *
 * Hesap `utils/dashboardMonthStrip.ts`'te; burada yalnız çizim ve token eşlemesi var.
 */
const TONE_MAP: Record<MonthStripTone, SeritTone> = {
  statement: 'danger',
  installment: 'warning',
  planned: 'info',
  income: 'brand',
}

const LEGEND: { tone: MonthStripTone; label: string }[] = [
  { tone: 'statement', label: 'Ekstre' },
  { tone: 'installment', label: 'Taksit' },
  { tone: 'planned', label: 'Planlı' },
  { tone: 'income', label: 'Gelir' },
]

export function SeritMonthStrip({ strip, monthLabel }: { strip: MonthStrip; monthLabel: string }) {
  return (
    <div className="rounded-[14px] border border-line-strong bg-raised px-3.5 pb-3.5 pt-4">
      <div className="mb-2.5 flex justify-between text-[10px] text-ink-ghost">
        {strip.axis.map((day) => (
          <span key={day} className="serit-num">
            {day}
          </span>
        ))}
      </div>

      {/* Çubukların yarım genişliği kenarlarda taşmasın diye içeriden pay bırakılır. */}
      <div
        className="relative h-[76px] px-[7px] lg:h-24"
        role="img"
        aria-label={
          strip.marks.length === 0
            ? `${monthLabel} ayının kalanında planlı vade yok`
            : `${monthLabel} ayının kalanında ${strip.marks.length} vade`
        }
      >
        <div className="absolute inset-x-0 bottom-0 h-px bg-line-strong" aria-hidden="true" />
        {strip.marks.map((mark) => (
          <div
            key={mark.id}
            aria-hidden="true"
            className="absolute bottom-0 w-3 -translate-x-1/2 rounded-t-[3px] lg:w-3.5"
            style={{
              left: `${mark.positionPct}%`,
              height: `${mark.heightPct}%`,
              background: SERIT_FILL[TONE_MAP[mark.tone]],
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-ink-muted">
        {LEGEND.map((entry) => (
          <span key={entry.tone} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-[7px] rounded-[2px]"
              style={{ background: SERIT_FILL[TONE_MAP[entry.tone]] }}
            />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  )
}
