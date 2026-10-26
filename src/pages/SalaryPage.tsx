import { CrudPage, type FormField } from '../components/CrudPage'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { Delta, HeroNumber, SectionEyebrow, TrendBars } from '../components/serit'
import type { SalaryHistory } from '../types/database'
import { formatDate } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { getSalaryTrend } from '../utils/financeSummary'

const salaryFields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  { name: 'amount', label: 'Net maaş', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'effective_date', label: 'Geçerli olduğu tarih', type: 'date', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function SalaryOverview({ rows }: { rows: SalaryHistory[] }) {
  if (rows.length === 0) return null

  const { current, previous, difference, percentage } = getSalaryTrend(rows)
  if (!current) return null
  // Trend serisi: en eski → en yeni, son çubuk jade olsun diye kronolojik.
  const trend = [...rows]
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    .slice(-6)
    .map((row) => row.amount)

  // Şerit: kahraman = güncel maaş, altında son değişim (Delta) ve 6 aylık trend.
  return (
    <section>
      <HeroNumber label="Güncel maaş" value={current.amount} description={formatDate(current.effective_date)} />

      {previous ? (
        <Delta value={difference} percent={percentage} suffix="önceki kayda göre" />
      ) : (
        <p className="mt-2.5 text-[13px] text-ink-muted">
          İlk maaş kaydı — sonraki kayıtlarda artış trendi burada görünecek.
        </p>
      )}

      {trend.length >= 2 ? (
        <details className="mt-5"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-primary">Maaş değişim grafiği</summary>
          <SectionEyebrow className="mb-2">Maaş trendi · son {trend.length} kayıt</SectionEyebrow>
          <TrendBars values={trend} label={`Son ${trend.length} maaş kaydının trendi`} />
        </details>
      ) : null}
    </section>
  )
}

export function SalaryPage() {
  const { formatAmount, maskText } = useBalancePrivacy()
  return (
    <CrudPage
      table="salary_history"
      pageTitle="Maaş geçmişi"
      pageLabel="Gelir merkezi"
      pageDescription="Maaş değişimlerini izle; nakit akışı tahminleri güncel maaşını kullansın."
      addLabel="Maaş ekle"
      fields={salaryFields}
      emptyTitle="Henüz maaş kaydı yok"
      emptyDescription="Maaşını varlık hesaplarına katmadan tarihsel artışını buradan takip edebilirsin."
      orderBy="effective_date"
      orderAscending={false}
      renderBeforeList={({ loading, rows }) => (!loading ? <SalaryOverview rows={rows as SalaryHistory[]} /> : null)}
      getInitialValues={(row?: SalaryHistory) => ({
        title: row?.title ?? 'Maaş',
        amount: row?.amount ?? 0,
        effective_date: row?.effective_date ?? new Date().toLocaleDateString('sv-SE'),
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        title: String(formData.get('title') ?? '').trim() || 'Maaş',
        amount: parseNumber(formData.get('amount')),
        effective_date: String(formData.get('effective_date') ?? ''),
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.title}
      renderSubtitle={(row) => formatDate(row.effective_date)}
      renderDetails={(row) => [`Net maaş: ${formatAmount(row.amount)}`]}
      listGridClassName="flex flex-col"
      renderCard={(row, { menu }) => <article className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"><div className="min-w-0"><h2 className="break-words text-sm font-semibold">{row.title}</h2><p className="text-xs text-ink-muted">{formatDate(row.effective_date)}</p>{row.note ? <p className="break-words text-xs text-ink-muted">{maskText(row.note)}</p> : null}</div><div className="flex items-center gap-3"><span className="serit-num font-semibold">{formatAmount(row.amount)}</span>{menu}</div></article>}
      getCardClassName={() => 'border-success/20 bg-success/5 dark:bg-success/8'}
      getDetailClassName={() => 'bg-page'}
    />
  )
}
