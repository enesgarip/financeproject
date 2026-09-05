import { useMemo, useState } from 'react'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { buildCardPaymentCycle, buildCardCycleForecast, cardSpendingScenario } from '../../utils/cardPaymentCycle'
import { formatDate } from '../../utils/date'
import type { FinanceSummaryInput } from '../../utils/financeSummary'

export function CardPaymentCyclePanel({ data, from, buffer, reserved, reservedKnown }: {
  data: FinanceSummaryInput; from: Date; buffer: number; reserved: number; reservedKnown: boolean
}) {
  const { formatAmount, hidden } = useBalancePrivacy()
  const [extra, setExtra] = useState('')
  const cycle = useMemo(() => buildCardPaymentCycle(data, { from, buffer, reserved }), [data, from, buffer, reserved])
  const forecast = useMemo(() => buildCardCycleForecast(data, from), [data, from])
  const scenario = useMemo(() => cardSpendingScenario(forecast, Number(extra), cycle.held), [forecast, extra, cycle.held])
  if (!cycle.next.length) return null
  return <section className="mt-6 border-t border-line-strong pt-4" aria-labelledby="card-cycle-title">
    <h2 id="card-cycle-title" className="text-base font-semibold text-ink">Kart döngüsü</h2>
    <p className="mt-1 text-xs leading-5 text-ink-muted">Kesilen ekstrenin tamamını ödeme planı. Açılan limit gelir sayılmaz.</p>
    {!reservedKnown && <p role="status" className="mt-2 text-sm text-warning">Kasa rezervi doğrulanamadı. Ödeme hazırlığı henüz doğrulanmış değil.</p>}
    <h3 className="mt-4 text-sm font-semibold">Ekstre için hazır mı?</h3>
    <p className="mt-1 text-xs leading-5 text-ink-muted">{formatAmount(cycle.cash)} nakitten tampon, kasa rezervi ve vadesiz kişisel borç için {formatAmount(cycle.held)} ayrıldı. Diğer kayıtlı nakit çıkışları vade sırasıyla düşülür; aynı para iki karta ayrılmaz.</p>
    {cycle.statements.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Ödenmemiş kesilmiş ekstre yok.</p> : <ul className="mt-2 divide-y divide-line">
      {cycle.statements.map((row) => <li key={row.id} className="py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{row.name}</span><span className="serit-num">{formatAmount(row.amount)}</span></div>
        <p className="mt-1 text-xs text-ink-muted">{row.due ? `${formatDate(row.due)}${row.estimatedDate ? ' · kart ayarından tahmini vade' : ''}` : 'Son ödeme tarihi eksik; bugün ayrılması varsayıldı.'}</p>
        <p className="mt-1 text-xs">Bugünkü nakitten karşılanan: {formatAmount(row.readyNow)}</p>
        <p className="mt-1 text-xs text-ink-muted">{row.gapByDue > 0 ? `Vade planında eksik: ${formatAmount(row.gapByDue)}` : 'Kayıtlı vade planında açık görünmüyor.'}</p>
      </li>)}
    </ul>}
    <p className="mt-2 text-xs leading-5 text-ink-muted">Vade planı gelecekteki maaş ve tahsilatları varsayar; bunlar bugün hazır para değildir. Aynı günün geliri ödemeden sonra sayılır. Kayıtlı olmayan giderler, faiz ve gecikme bedelleri dahil değildir.</p>
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer py-2 text-sm font-semibold">Sonraki ekstreye biriken</summary>
      <ul className="divide-y divide-line">{cycle.next.map((row) => <li key={row.id} className="py-2 text-sm">
        <p className="font-semibold">{row.name}: {row.projection ? `yaklaşık ${formatAmount(row.projection.amount)}` : 'Kesim / ödeme günü eksik'}</p>
        {row.projection && <p className="mt-1 text-xs text-ink-muted">{formatDate(row.projection.statementDate)} kesimi · dönem içi {formatAmount(row.projection.currentPeriod)} + bu kesime planlı taksit {formatAmount(row.projection.installmentTotal)}</p>}
        <p className="mt-1 text-xs text-ink-muted">Bekleyen provizyon: {formatAmount(row.provision)}; tahmine eklenmedi.</p>
      </li>)}</ul>
      <p className="text-xs leading-5 text-ink-muted">Eski ekstre ve sonraki dönemlerin taksitleri bu tutarda yok. Yeni harcamalarla değişir; banka ekstresi yerine geçmez.</p>
    </details>
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-semibold">Tüm kart borcu sonrası nakit farkı</h3>
      <p className="serit-num mt-1 text-xl">{formatAmount(cycle.cashMinusDebt)}</p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">Nakit − toplam kart borcu ({formatAmount(cycle.cardDebt)}). Gelecek taksitler ve provizyon dahil; tampon, rezerv ve diğer borçlar bu farktan düşülmedi. Harcama limiti değildir.</p>
    </div>
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer py-2 text-sm font-semibold">Kart harcamam devam ederse</summary>
      <label className="mt-2 block text-sm" htmlFor="card-cycle-extra">Kayıtlı planların dışında aylık yeni kart harcaması (TL)</label>
      <input id="card-cycle-extra" type={hidden ? 'password' : 'number'} inputMode="decimal" min="0" step="0.01" value={extra} onChange={(event) => setExtra(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-line-strong bg-page px-3" placeholder="Aylık tahminini yaz" />
      <p className="mt-2 text-xs leading-5 text-ink-muted">Bu aydan başlayarak her ay aynı yeni harcama, ilk ödeme gelecek ay varsayılır. Kayıtlı borçları ve planları tekrar yazma. Son ayın yeni harcaması bu altı aylık ufkun sonrasına kalır. Ay sonu bakiyesidir; ay içindeki açığı göstermez. Bu karşılaştırmada kayıtlı gelecek taksitler ve kart talimatları tahmini ekstre vadelerinde nakitten düşülür. Kayıtlı olmayan abonelikleri yeni harcama tahminine dahil et. Kesim / ödeme günü eksik kartların gelecek ödemeleri hesaplanamaz.</p>
      {extra !== '' && Number(extra) >= 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Ay</th><th>Kayıtlı plan</th><th>Yeni harcamayla</th></tr></thead><tbody>{scenario.map((month) => <tr key={month.monthKey} className="border-t border-line"><th className="py-3 font-normal">{month.monthLabel}</th><td>{formatAmount(month.baseline)}</td><td>{formatAmount(month.scenario)}</td></tr>)}</tbody></table><p className="text-xs text-ink-muted">Her iki sütunda tampon, kasa rezervi ve vadesiz kişisel borç ayrıldı.</p></div>}
    </details>
  </section>
}
