import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { CrudPage, type FormField } from '../CrudPage'
import { HeroNumber, SectionEyebrow, TrendBars } from '../serit'
import type { CreditScoreHistory } from '../../types/database'
import { buildCreditScoreSummary } from '../../utils/creditScore'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'

const fields: FormField[] = [
  { name: 'score', label: 'Findeks kredi notu', type: 'number', min: '1', step: '1', required: true },
  { name: 'checked_on', label: 'Sorgulama tarihi', type: 'date', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function CreditScoreOverview({ rows }: { rows: CreditScoreHistory[] }) {
  const { current, previous, change, trend } = buildCreditScoreSummary(rows)
  if (!current) return null

  return (
    <section>
      <SectionEyebrow className="mb-2">Findeks kredi notum</SectionEyebrow>
      <HeroNumber label="Güncel kredi notu" value={current.score} unitOverride="puan" description={formatDate(current.checked_on)} />
      {previous && change !== null ? (
        <p className={`mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-bold ${change > 0 ? 'text-success' : change < 0 ? 'text-destructive' : 'text-ink-muted'}`}>
          {change > 0 ? <ArrowUpRight size={15} /> : change < 0 ? <ArrowDownRight size={15} /> : <Minus size={15} />}
          {change > 0 ? '+' : ''}{change} puan · önceki sorguya göre
        </p>
      ) : (
        <p className="mt-2.5 text-[13px] text-ink-muted">Sonraki sorgunda puan değişimi burada görünecek.</p>
      )}
      {trend.length >= 2 ? (
        <div className="mt-5">
          <SectionEyebrow className="mb-2">Son {trend.length} sorgu</SectionEyebrow>
          <TrendBars values={trend} label={`Son ${trend.length} Findeks kredi notunun trendi`} />
        </div>
      ) : null}
    </section>
  )
}

export function CreditScorePanel() {
  return (
    <section className="lg:col-span-12">
      <CrudPage
        table="credit_score_history"
        pageTitle="Kredi notum"
        addLabel="Kredi notu ekle"
        fields={fields}
        formDescription="Findeks'ten sorguladığın sonucu kaydet. Bu kayıt finansal bakiyelerini ve hesaplamalarını etkilemez."
        emptyTitle="Henüz kredi notu kaydı yok"
        emptyDescription="Findeks sonucunu eklediğinde sonraki sorgularınla değişimi burada takip edebilirsin."
        orderBy="checked_on"
        orderAscending={false}
        renderBeforeList={({ loading, rows }) => !loading ? <CreditScoreOverview rows={rows as CreditScoreHistory[]} /> : null}
        getInitialValues={(row?: CreditScoreHistory) => ({
          score: row?.score ?? '',
          checked_on: row?.checked_on ?? new Date().toLocaleDateString('sv-SE'),
          note: row?.note ?? '',
        })}
        validateForm={(formData, _values, editing, rows) => {
          const score = parseNumber(formData.get('score'))
          const checkedOn = String(formData.get('checked_on') ?? '')
          const errors: Record<string, string> = {}
          if (!Number.isInteger(score) || score < 1 || score > 1900) {
            errors.score = 'Findeks kredi notu 1–1900 arasında tam sayı olmalı.'
          }
          if (rows.some((row) => row.id !== editing?.id && row.checked_on === checkedOn)) {
            errors.checked_on = 'Bu sorgulama tarihi için zaten bir kredi notu kaydı var.'
          }
          return errors
        }}
        mapForm={(formData, userId) => ({
          user_id: userId,
          score: parseNumber(formData.get('score')),
          checked_on: String(formData.get('checked_on') ?? ''),
          note: String(formData.get('note') ?? '').trim() || null,
        })}
        renderTitle={(row) => `${row.score} puan`}
        renderSubtitle={(row) => formatDate(row.checked_on)}
        renderDetails={() => ['Kaynak: Findeks']}
        getCardClassName={() => 'border-primary/20 bg-primary/5'}
        getDetailClassName={() => 'bg-page'}
      />
      <p className="mt-4 text-xs text-ink-muted">
        Bu uygulama kredi notunu hesaplamaz veya Findeks'e bağlanmaz; yalnızca girdiğin sonuçları saklar.
      </p>
    </section>
  )
}
