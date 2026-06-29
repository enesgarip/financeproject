import { Archive, BarChart3, CalendarRange, Check, Copy, Download, ImageDown, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { SimpleModal } from '../components/SimpleModal'
import type { NetWorthSnapshot } from '../types/database'
import { buildSearchCsv, type AnalysisData, type SearchItem } from '../utils/analysisView'
import { buildFinancialReport, reportToMarkdown, type FinancialReport } from '../utils/financialReport'
import { buildMonthlyCashFlow, sum } from '../utils/financeSummary'
import { activeExpense as activeCardExpense } from '../utils/budgetAlerts'
import { formatDate, isDateInMonth } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { buildMonthlySummary } from '../utils/monthlySummary'
import { downloadShareableCard, renderShareableCard } from '../utils/shareableCard'
import { normalizeSearchText } from '../utils/searchText'
import { buildYearEndReport } from '../utils/yearEndReport'
import { StatPill } from './AnalysisPage.atoms'

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
}

/**
 * Raporu yazdırılabilir (PDF) temiz bir pencerede açar. CSP-güvenli: pencere
 * opener'ın CSP'sini miras alır, bu yüzden INLINE SCRIPT yok — yazdırma
 * opener'dan `w.print()` ile tetiklenir (inline `<style>` 'unsafe-inline' ile serbest).
 */
function printFinancialReport(report: FinancialReport) {
  const sectionsHtml = report.sections
    .map((section) => {
      const lines = section.lines?.length
        ? `<ul>${section.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
        : ''
      const table = section.table
        ? `<table><thead><tr>${section.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${section.table.rows
            .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : ''
      const note = section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ''
      return `<section><h2>${escapeHtml(section.heading)}</h2>${lines}${table}${note}</section>`
    })
    .join('')

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>
    body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:720px;margin:24px auto;padding:0 16px}
    h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
    .sub{color:#64748b;font-size:12px;margin:0 0 8px}ul{margin:6px 0;padding-left:18px}li{margin:2px 0}
    table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}th,td{border:1px solid #e2e8f0;padding:5px 8px;text-align:left}
    th{background:#f8fafc}td:not(:first-child),th:not(:first-child){text-align:right}.note{color:#64748b;font-size:12px;font-style:italic;margin:6px 0}
  </style></head><body><h1>${escapeHtml(report.title)} — ${escapeHtml(report.generatedAt)}</h1>
  <p class="sub">Para birimi: TL. Hesap/banka/kişi adı içermez (yalnız yapı + rakam).</p>${sectionsHtml}</body></html>`

  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

function downloadCsv(items: SearchItem[]) {
  const blob = new Blob([buildSearchCsv(items)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finans-rapor-${new Date().toLocaleDateString('sv-SE')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * "AI için özet" — finansal durumu yapısal markdown olarak panoya kopyalar
 * (ChatGPT'ye yapıştırıp taktik almak) veya temiz PDF olarak yazdırır. Rapor
 * kategori-bazlı agregasyondur: hesap/banka/kişi adı içermez (gizlilik yapı gereği).
 */
function AiSummaryButton({ data }: { data: AnalysisData }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const report = useMemo(
    () =>
      buildFinancialReport({
        assets: data.assets,
        cards: data.cards,
        loans: data.loans,
        loanInstallments: data.loanInstallments,
        debts: data.debts,
        payments: data.payments,
        salaryHistory: data.salaryHistory,
        cardInstallments: data.cardInstallments,
      }),
    [data],
  )
  const markdown = useMemo(() => reportToMarkdown(report), [report])

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles />
        AI özeti
      </Button>
      <SimpleModal title="Finansal özet — AI için" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Aşağıdaki özet hesap/banka/kişi adı içermez — yalnız yapı ve rakam. ChatGPT gibi bir asistana yapıştırıp
            taktik alabilir veya PDF olarak indirebilirsin.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copyMarkdown}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Kopyalandı' : 'AI için kopyala (Markdown)'}
            </Button>
            <Button type="button" variant="outline" onClick={() => printFinancialReport(report)}>
              <Download />
              Yazdır / PDF
            </Button>
          </div>
          <pre className="max-h-[52svh] overflow-auto rounded-xl border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
            {markdown}
          </pre>
        </div>
      </SimpleModal>
    </>
  )
}

export function MonthlyReport({ data }: { data: AnalysisData }) {
  // Same engine the dashboard cash-flow card uses, so "Gelir / Nakit çıkışı / Net" here
  // can never disagree with the dashboard for the same month (credit-card auto
  // payments are excluded from cash outflow exactly like there).
  const cashFlow = buildMonthlyCashFlow(data)
  const cardSpending = sum(
    data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at)),
    (expense) => expense.amount,
  )
  const summary = useMemo(() => buildMonthlySummary(data.cardExpenses), [data.cardExpenses])
  const income = cashFlow.income
  const outflow = cashFlow.outflow
  const net = cashFlow.netFlow
  const reportRows = [
    { label: 'Kart ödemesi', value: cashFlow.cardOutflow },
    { label: 'Fatura/ödeme', value: cashFlow.paymentOutflow },
    { label: 'Kredi taksidi', value: cashFlow.loanOutflow },
    { label: 'Kişisel borç', value: cashFlow.debtOutflow },
  ]
  const changeTone = summary.changePercent === null ? 'stone' : summary.changePercent > 0 ? 'rose' : 'emerald'
  const changeLabel = summary.changePercent === null ? '—' : `${summary.changePercent > 0 ? '+' : ''}%${summary.changePercent}`

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Aylık rapor</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
            <BarChart3 />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="flex flex-wrap gap-2">
          <AiSummaryButton data={data} />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const canvas = renderShareableCard({ cashFlow, summary })
            downloadShareableCard(canvas, cashFlow.monthLabel)
          }}>
            <ImageDown />
            Kart
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Download />
            PDF
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
          <StatPill label="Gelir" value={formatCurrency(income)} tone="emerald" />
          <StatPill label="Kart harcaması" value={formatCurrency(cardSpending)} tone="rose" />
          <StatPill label="Nakit çıkışı" value={formatCurrency(outflow)} tone="rose" />
          <StatPill label="Net nakit" value={formatCurrency(net)} tone={net >= 0 ? 'emerald' : 'rose'} />
        </div>
        <div className="grid gap-2 min-[520px]:grid-cols-2">
          {reportRows.map((row) => (
            <div key={row.label} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
              <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">{formatCurrency(row.value)}</span>
            </div>
          ))}
        </div>

        {summary.categories.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase text-muted-foreground">Kategori dağılımı</p>
              <span className={`text-xs font-bold tabular-nums ${changeTone === 'emerald' ? 'text-success' : changeTone === 'rose' ? 'text-destructive' : 'text-muted-foreground'}`}>
                Geçen aya göre: {changeLabel}
              </span>
            </div>
            {summary.categories.slice(0, 6).map((cat) => (
              <div key={cat.category} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{cat.category}</span>
                  <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">
                    {formatCurrency(cat.amount)} <span className="text-xs font-normal text-muted-foreground">(%{cat.percentage})</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                  <div className="h-full rounded-full bg-foreground/20" style={{ width: `${Math.min(100, cat.percentage)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Kart harcamaları alışveriş tarihinde, nakit çıkışı ekstre veya ödeme tarihinde izlenir.
        </p>
      </CardContent>
    </Card>
  )
}

export function StatementArchive({ data }: { data: AnalysisData }) {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const archives = data.cardStatementArchives.slice(0, 6)

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Ekstre arşivi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{archives.length} son kayıt</p>
          </div>
          <Archive className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {archives.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Ekstre kesildiğinde arşiv burada tutulacak.</p>
        ) : (
          archives.map((archive) => (
            <div key={archive.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{cardsById.get(archive.card_id)?.card_name ?? 'Kart'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(archive.statement_date)} · son ödeme {formatDate(archive.due_date)}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(archive.statement_debt_amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function YearEndReport({ data, snapshots }: { data: AnalysisData; snapshots: NetWorthSnapshot[] }) {
  const report = useMemo(() => buildYearEndReport(data.cardExpenses, snapshots), [data.cardExpenses, snapshots])

  if (report.totalSpending === 0) return null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{report.year} yılı finansal özet</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Yıllık harcama: {formatCurrency(report.totalSpending)} · Aylık ortalama: {formatCurrency(report.avgMonthlySpending)}
            </p>
          </div>
          <CalendarRange className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="grid gap-2 min-[520px]:grid-cols-2 min-[900px]:grid-cols-4">
          <StatPill label="Toplam harcama" value={formatCurrency(report.totalSpending)} tone="rose" />
          <StatPill label="Aylık ortalama" value={formatCurrency(report.avgMonthlySpending)} tone="stone" />
          {report.mostExpensiveMonth ? (
            <StatPill label={`En pahalı: ${report.mostExpensiveMonth.label}`} value={formatCurrency(report.mostExpensiveMonth.amount)} tone="rose" />
          ) : null}
          {report.netWorthChange !== null ? (
            <StatPill label="Net değer değişimi" value={`${report.netWorthChange >= 0 ? '+' : ''}${formatCurrency(report.netWorthChange)}`} tone={report.netWorthChange >= 0 ? 'emerald' : 'rose'} />
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Aylık harcama trendi</p>
          <div className="grid grid-cols-6 gap-1.5 min-[760px]:grid-cols-12">
            {report.monthlyTotals.map((m) => {
              const maxAmount = report.mostExpensiveMonth?.amount ?? 1
              const heightPct = maxAmount > 0 ? Math.max(4, (m.amount / maxAmount) * 100) : 4
              return (
                <div key={m.month} className="flex flex-col items-center gap-1">
                  <div className="flex h-16 w-full items-end justify-center">
                    <div
                      className="w-full rounded-t-md bg-foreground/15"
                      style={{ height: `${heightPct}%` }}
                      title={`${m.label}: ${formatCurrency(m.amount)}`}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground">{m.label.slice(0, 3)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {report.topCategories.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase text-muted-foreground">En çok harcanan kategoriler</p>
            <div className="grid gap-2 min-[520px]:grid-cols-2 min-[900px]:grid-cols-3">
              {report.topCategories.slice(0, 6).map((cat) => (
                <div key={cat.category} className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{cat.category}</span>
                  <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">
                    {formatCurrency(cat.amount)} <span className="text-xs font-normal text-muted-foreground">(%{cat.percentage})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SearchExport({ items }: { items: SearchItem[] }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = normalizeSearchText(query)
  const filteredItems = useMemo(
    () =>
      normalizedQuery
        ? items.filter((item) => normalizeSearchText(`${item.type} ${item.title} ${item.subtitle}`).includes(normalizedQuery))
        : items.slice(0, 12),
    [items, normalizedQuery],
  )

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Genel arama ve dışa aktarım</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Varlık, kart, borç, ödeme, bütçe ve geçmiş kayıtları.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => downloadCsv(filteredItems)}>
            <Download />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ara: market, kart, kredi, hedef..."
            className="w-full rounded-xl border border-input bg-card/80 py-3 pl-10 pr-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
          />
        </label>
        <div className="space-y-2">
          {filteredItems.slice(0, 20).map((item, index) => (
            <div key={`${item.type}-${item.title}-${item.date}-${index}`} className="flex items-start justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.type} · {item.subtitle}
                </p>
              </div>
              {item.amount !== null ? (
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(item.amount)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
