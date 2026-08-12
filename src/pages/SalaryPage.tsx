import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { Delta, HeroNumber, SectionEyebrow, TrendBars } from '../components/serit'
import type { SalaryHistory } from '../types/database'
import { formatDate } from '../utils/date'
import { formatPercent, parseNumber } from '../utils/formatCurrency'
import { getSalaryTrend } from '../utils/financeSummary'
import { diffTL } from '../utils/money'

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
        <div className="mt-5">
          <SectionEyebrow className="mb-2">Maaş trendi · son {trend.length} kayıt</SectionEyebrow>
          <TrendBars values={trend} label={`Son ${trend.length} maaş kaydının trendi`} />
        </div>
      ) : null}
    </section>
  )
}

export function SalaryPage() {
  const { formatAmount } = useBalancePrivacy()
  return (
    <CrudPage
      table="salary_history"
      pageTitle="Maaş geçmişi"
      pageLabel="Gelir merkezi"
      pageDescription="Gelir değişimini tarihsel olarak izle ve nakit projeksiyonunun güncel maaşı kullanmasını sağla."
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
      renderExtra={(row, helpers) => {
        const orderedRows = [...(helpers.rows as SalaryHistory[])].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
        const index = orderedRows.findIndex((item) => item.id === row.id)
        const previous = index > 0 ? orderedRows[index - 1] : null
        if (!previous || previous.amount <= 0) return null

        const difference = diffTL(row.amount, previous.amount)
        const percentage = (difference / previous.amount) * 100
        const isUp = difference >= 0
        return (
          <div className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${isUp ? 'border-success/20 bg-success/8 text-success' : 'border-destructive/20 bg-destructive/8 text-destructive'}`}>
            {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            <span className="font-mono font-semibold tabular-nums">
              {difference >= 0 ? '+' : ''}{formatAmount(difference)} ({formatPercent(percentage, { signed: true })})
            </span>
          </div>
        )
      }}
      getCardClassName={() => 'border-success/20 bg-success/5 dark:bg-success/8'}
      getDetailClassName={() => 'bg-muted/40'}
    />
  )
}
