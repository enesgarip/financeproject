import { ChevronDown, PieChart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCategorySpendingHistory } from '../app/useCategorySpendingHistory'
import { CompositionBar } from '../components/charts/CompositionBar'
import { CategoryBudgetControl } from '../components/finance/CategoryBudgetControl'
import { buildBudgetUsage } from '../utils/budgetAlerts'
import { getCurrentSalary } from '../utils/financeSummary'
import { buildVizColorMap, orderSlicesCanonically, vizColor } from '../components/charts/vizPalette'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { QueryError } from '../components/ui/query-error'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { AnalysisData } from '../utils/analysisView'
import { expenseCategories } from '../utils/categories'
import { buildCategorySpending, calendarPeriodRange, categoryMonthLabel, categoryPeriodOptions, type CategorySelection, type CategoryTransaction } from '../utils/categorySpending'
import { dateInputValue, formatDate } from '../utils/date'
import { formatPercent } from '../utils/formatCurrency'

const COLORS = buildVizColorMap(expenseCategories, ['Diğer'])
const SELECT_CLASS = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-raised px-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

function CategoryRows({ rows, cardNames }: { rows: CategoryTransaction[]; cardNames: Map<string, string> }) {
  const { formatAmount, maskText } = useBalancePrivacy()
  const [page, setPage] = useState(0)
  const pages = Math.ceil(rows.length / 10)
  const currentPage = Math.min(page, pages - 1)
  return <div className="pb-3 pl-3">
    <ul className="divide-y divide-line">
      {rows.slice(currentPage * 10, currentPage * 10 + 10).map(row => <li key={row.id} className="grid min-w-0 gap-1 py-3 text-sm min-[460px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><p className="break-words text-ink">{maskText(row.description || 'Kart harcaması')}</p><p className="mt-1 break-words text-xs text-ink-muted">{formatDate(row.date)} · {maskText(cardNames.get(row.cardId) ?? 'Kart')} {row.installment ? `· ${row.installment}` : ''}</p></div>
        <span className="serit-num break-words font-semibold text-ink">{formatAmount(row.amount)}</span>
      </li>)}
    </ul>
    {pages > 1 ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <button type="button" className="min-h-11 px-2 text-primary disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Önceki</button>
      <span aria-live="polite">{currentPage + 1} / {pages}</span>
      <button type="button" className="min-h-11 px-2 text-primary disabled:opacity-40" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Sonraki</button>
    </div> : null}
  </div>
}

export function CategorySpendingChart({ data }: { data: AnalysisData }) {
  const query = useCategorySpendingHistory()
  const { formatAmount, maskText, hidden } = useBalancePrivacy()
  const [selection, setSelection] = useState<CategorySelection>({ mode: 'statement', cardId: 'all', period: 'current' })
  const todayKey = dateInputValue(new Date())
  const months = useMemo(() => query.data ? categoryPeriodOptions(query.data, selection, new Date(`${todayKey}T00:00:00`)) : [], [query.data, selection, todayKey])
  // Kart değişiminde artık mevcut olmayan ay sessizce başka aya taşınmaz.
  const period = selection.mode === 'calendar' && selection.period === 'current' ? todayKey.slice(0, 7) : selection.period
  const model = useMemo(() => query.data ? buildCategorySpending(data.cards, query.data, { ...selection, period }, new Date(`${todayKey}T00:00:00`)) : null, [data.cards, query.data, selection, period, todayKey])
  const cards = data.cards.filter(card => selection.mode === 'calendar' || card.card_type === 'kredi_karti')
  const names = new Map(data.cards.map(card => [card.id, card.card_name]))
  const chart = orderSlicesCanonically((model?.categories ?? []).map(row => ({ name: row.category, value: row.amount, color: vizColor(COLORS, row.category) })), expenseCategories)
  const title = selection.mode === 'calendar' ? categoryMonthLabel(period) : period === 'current' ? 'Güncel ekstre dönemi' : `${categoryMonthLabel(period)} ekstreleri`
  const scopeKey = `${selection.mode}:${selection.cardId}:${period}`
  const budgetUsage = useMemo(() => buildBudgetUsage(data.budgets, data.cardExpenses, new Date(`${todayKey}T00:00:00`), getCurrentSalary(data.salaryHistory)?.amount ?? null), [data.budgets, data.cardExpenses, data.salaryHistory, todayKey])
  const showBudget = selection.mode === 'calendar' && selection.cardId === 'all' && period === todayKey.slice(0, 7)
  return <Card className="min-w-0 border-line-strong lg:col-span-7">
    <CardHeader className="pb-0"><div className="flex items-start justify-between gap-3"><div><CardTitle>Kategori harcaması</CardTitle><p className="mt-1 text-xs text-ink-muted">Kart ve dönem seçerek harcamalarının dağılımını incele.</p></div><PieChart size={18} className="shrink-0 text-primary" aria-hidden="true" /></div></CardHeader>
    <CardContent className="space-y-3 pt-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-xs text-ink-muted">Görünüm<select className={SELECT_CLASS} value={selection.mode} onChange={event => setSelection({ mode: event.target.value as CategorySelection['mode'], cardId: 'all', period: 'current' })}><option value="statement">Ekstre dönemi</option><option value="calendar">Takvim ayı</option></select></label>
        <label className="min-w-0 text-xs text-ink-muted">Kart<select className={SELECT_CLASS} value={selection.cardId} onChange={event => setSelection({ ...selection, cardId: event.target.value })}><option value="all">Tüm kartlar</option>{cards.map(card => <option key={card.id} value={card.id}>{maskText(card.card_name)}</option>)}</select></label>
        <label className="min-w-0 text-xs text-ink-muted">Dönem<select className={SELECT_CLASS} value={period} onChange={event => setSelection({ ...selection, period: event.target.value })}>
          {selection.mode === 'statement' ? <option value="current">Güncel ekstre dönemi</option> : null}
          {!months.includes(period) && period !== 'current' ? <option value={period}>{categoryMonthLabel(period)}{selection.mode === 'statement' ? ' ekstreleri' : ''}</option> : null}
          {months.map(month => <option key={month} value={month}>{categoryMonthLabel(month)}{selection.mode === 'statement' ? ' ekstreleri' : ''}</option>)}
        </select></label>
      </div>
      {query.isError ? <QueryError title="Kategori geçmişi yüklenemedi" message="Dönem toplamları doğrulanamıyor." onRetry={() => void query.refetch()} retrying={query.isFetching} /> : query.isPending ? <p role="status" className="py-4 text-sm text-ink-muted">Kategori geçmişi yükleniyor…</p> : model ? <>
        <div className="space-y-1 text-xs text-ink-muted">
          {selection.mode === 'statement' ? <>
            <p>{period === 'current' ? 'Her kredi kartının kendi devam eden dönemi toplanır; bugüne kadar kesinleşen kayıtlar gösterilir.' : 'Seçilen ayda kesilen ekstrelerin kayıtlı harcama ayrıntıları gösterilir.'}</p>
            {model.periods.map(row => <p key={`${row.cardId}:${row.statementId ?? 'current'}`}><strong className="font-semibold">{maskText(names.get(row.cardId) ?? 'Kart')}</strong> · {row.start ? `${formatDate(row.start)} – ${formatDate(row.end)}` : `${formatDate(row.end)} kesimi · dönem başlangıcı kayıtlı değil`}</p>)}
            <p>Taksitli alışverişlerde yalnız bu ekstreye düşen taksit sayılır. Provizyonlar ve gelecek taksitler dahil değildir.</p>
          </> : <><p>{formatDate(calendarPeriodRange(period).start)} – {formatDate(calendarPeriodRange(period).end)}</p><p>Kesinleşmiş alışverişler işlem tarihine göre toplanır. Taksitli alışverişin toplam tutarı alışveriş ayında sayılır; provizyonlar dahil değildir.</p></>}
        </div>
        {model.warnings.length ? <div role="status" className="space-y-1 rounded-lg bg-page p-3 text-xs text-warning">{model.warnings.map(warning => <p key={warning}>{maskText(warning)}</p>)}</div> : null}
        {model.categories.length ? <>
          <CompositionBar key={`${scopeKey}:chart`} data={chart} totalLabel={title} showRows={false} />
          <div key={`${scopeKey}:categories`} className="divide-y divide-line">
            {model.categories.map(category => <details key={category.category} className="group">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-3 text-sm [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: vizColor(COLORS, category.category) }} aria-hidden="true" /><span className="break-words font-semibold text-ink">{category.category}</span></span>
                <span className="flex flex-wrap items-center gap-2"><span className="serit-num text-ink">{formatAmount(category.amount)}</span><span className="text-xs text-ink-muted">{hidden ? '••••' : formatPercent(model.total > 0 ? category.amount / model.total * 100 : 0)}</span><ChevronDown size={14} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" /></span>
              </summary>
              {showBudget ? <CategoryBudgetControl category={category.category} month={`${period}-01`} budget={data.budgets.find(budget => budget.category === category.category && budget.month === `${period}-01`)} usage={budgetUsage.find(budget => budget.category === category.category)} /> : null}
              <CategoryRows rows={category.rows} cardNames={names} />
            </details>)}
          </div>
        </> : <p className="rounded-xl bg-page p-3 text-sm text-ink-muted">Bu seçim için kayıtlı kesinleşmiş harcama yok.</p>}
      </> : null}
    </CardContent>
  </Card>
}
