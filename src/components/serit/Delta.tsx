import { formatPercent } from '../../utils/formatCurrency'
import { SERIT_TEXT } from './tone'
import { useSeritAmount } from './useSeritAmount'

/**
 * Kahraman rakamın altındaki değişim satırı: "▲ 18.900 ₺ bu ay (+%3,3)".
 * Artı jade, eksi `danger`, sıfır nötr — renk yine yalnız sinyal.
 *
 * Ok karakteri metin olarak yazılır ama `aria-hidden` değil: ekran okuyucuya
 * yön bilgisi kelimeyle verilir, üçgen sembolü görsel kısaltmadır.
 */
export function Delta({
  value,
  percent,
  suffix = 'bu ay',
}: {
  value: number
  percent?: number
  suffix?: string
}) {
  const format = useSeritAmount()
  const money = format(Math.abs(value))
  const tone = value > 0 ? 'brand' : value < 0 ? 'danger' : 'neutral'

  return (
    <p className="mt-2.5 text-[13px]" style={{ color: SERIT_TEXT[tone] }}>
      <span aria-hidden="true">{value > 0 ? '▲' : value < 0 ? '▼' : '■'}</span>{' '}
      <span className="sr-only">{value > 0 ? 'artış' : value < 0 ? 'azalış' : 'değişim yok'} </span>
      <span className="serit-num font-semibold">
        {money.amount} {money.unit}
      </span>{' '}
      {suffix}
      {percent === undefined ? null : <> ({formatPercent(percent, { signed: true })})</>}
    </p>
  )
}
