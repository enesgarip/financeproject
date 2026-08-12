import { CheckCircle2, Clock3, ReceiptText, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip } from '../components/ui/help-tooltip'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Card, CardExpense, CardStatementArchive, CardStatementPayment } from '../types/database'
import {
  buildStatementPaidMap,
  openStatementsWithRemaining,
  statementPaidAmount,
  statementRemainingAmount,
} from '../utils/cardStatementPayments'
import { formatDate } from '../utils/date'
import { sumTL } from '../utils/money'
import { cardHelp } from './CardsPage.help'
import { statementPeriodLabel } from './CardsPage.helpers'

const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 9, 12]

export function ProvisionPanel({
  rows,
  provisions,
  loading,
  actionId,
  onPost,
  onPostAll,
  onCancel,
  onSetInstallments,
}: {
  rows: Card[]
  provisions: CardExpense[]
  loading: boolean
  actionId: string | null
  onPost: (expense: CardExpense) => void
  onPostAll: (expenses: CardExpense[]) => void
  onCancel: (expense: CardExpense) => void
  onSetInstallments: (expense: CardExpense, installmentCount: number) => void
}) {
  const { formatAmount } = useBalancePrivacy()
  const pending = provisions.filter((expense) => expense.status === 'provision')
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const totalProvision = sumTL(pending.map((expense) => expense.amount))
  if (loading && pending.length === 0) {
    return (
      <SurfaceCard className="border-warning/20">
        <CardContent className="p-4 text-sm text-muted-foreground">Provizyonlar yükleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (pending.length === 0) return null

  return (
    <SurfaceCard className="border-warning/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 size={17} />
              Provizyondaki işlemler
              <HelpTooltip title="Provizyondaki işlemler" content={cardHelp.provisionsPanel} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kesinleşince dönem içine alınır, iptal edilirse limitten çıkarılır.</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="secondary">{formatAmount(totalProvision)}</Badge>
            <button
              type="button"
              onClick={() => onPostAll(pending)}
              disabled={Boolean(actionId)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60 hover:bg-success/90"
            >
              <CheckCircle2 size={13} />
              {actionId === 'post-all' ? 'Aktarılıyor...' : 'Tümünü aktar'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {pending.map((expense) => {
          const card = cardsById.get(expense.card_id)
          const postActionId = `post-${expense.id}`
          const cancelActionId = `cancel-${expense.id}`
          const installmentsActionId = `installments-${expense.id}`
          const canInstall = card?.card_type === 'kredi_karti'
          const installmentCount = Math.max(1, expense.installment_count)
          const installmentChoices = INSTALLMENT_OPTIONS.includes(installmentCount)
            ? INSTALLMENT_OPTIONS
            : [...INSTALLMENT_OPTIONS, installmentCount].sort((a, b) => a - b)

          return (
            <div key={expense.id} className="rounded-xl border border-warning/15 bg-warning/8 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{expense.description}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card ? `${card.bank_name} · ${card.card_name}` : 'Kart'} · {formatDate(expense.spent_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-card px-2 py-1 text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatAmount(expense.amount)}
                </span>
              </div>
              {canInstall ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Taksit
                    <select
                      value={installmentCount}
                      onChange={(event) => onSetInstallments(expense, Number(event.target.value))}
                      disabled={Boolean(actionId)}
                      className="rounded-lg border border-border/60 bg-card px-2 py-1 text-xs font-semibold tabular-nums text-foreground disabled:opacity-60"
                    >
                      {installmentChoices.map((count) => (
                        <option key={count} value={count}>
                          {count === 1 ? 'Tek çekim' : `${count} taksit`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {actionId === installmentsActionId ? (
                    <span className="text-xs text-muted-foreground">Kaydediliyor...</span>
                  ) : installmentCount > 1 ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {installmentCount} × {formatAmount(expense.amount / installmentCount)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onPost(expense)}
                  disabled={Boolean(actionId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 hover:bg-success/90"
                >
                  <CheckCircle2 size={14} />
                  {actionId === postActionId ? 'İşleniyor...' : 'Kesinleştir'}
                </button>
                <button
                  type="button"
                  onClick={() => onCancel(expense)}
                  disabled={Boolean(actionId)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/15 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  {actionId === cancelActionId ? 'İşleniyor...' : 'İptal et'}
                </button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </SurfaceCard>
  )
}

export function StatementPanel({
  rows,
  statements,
  statementPayments = [],
  loading,
  actionId,
  onPay,
}: {
  rows: Card[]
  statements: CardStatementArchive[]
  /** Kısmi ekstre ödemeleri (K7): satırlar kalan borcu gösterir. */
  statementPayments?: CardStatementPayment[]
  loading: boolean
  actionId: string | null
  onPay: (statement: CardStatementArchive, card: Card) => void
}) {
  const { formatAmount } = useBalancePrivacy()
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const paidByArchive = useMemo(() => buildStatementPaidMap(statementPayments), [statementPayments])
  const openStatements = openStatementsWithRemaining(statements, paidByArchive)
    .sort((a, b) => (a.due_date ?? a.statement_date).localeCompare(b.due_date ?? b.statement_date))
  const totalOpenAmount = sumTL(openStatements.map((statement) => statementRemainingAmount(statement, paidByArchive)))

  if (loading && openStatements.length === 0) {
    return (
      <SurfaceCard className="border-success/20">
        <CardContent className="p-4 text-sm text-muted-foreground">Ekstreler yükleniyor...</CardContent>
      </SurfaceCard>
    )
  }

  if (openStatements.length === 0) return null

  return (
    <SurfaceCard className="border-success/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText size={17} />
              Açık ekstreler
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Ekstre ödemesi seçilen hesaptan düşülür ve yalnızca bu ekstreyi kapatır.</p>
          </div>
          <Badge variant="secondary">{formatAmount(totalOpenAmount)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {openStatements.map((statement) => {
          const card = cardsById.get(statement.card_id)
          if (!card) return null

          return (
            <div key={statement.id} className="rounded-xl border border-success/15 bg-success/8 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{card.card_name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {card.bank_name} - {statementPeriodLabel(statement)} - son ödeme {formatDate(statement.due_date)}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-card px-2 py-1 text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatAmount(statementRemainingAmount(statement, paidByArchive))}
                </span>
              </div>
              {statementPaidAmount(statement, paidByArchive) > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatAmount(statementPaidAmount(statement, paidByArchive))} ödendi ·{' '}
                  {formatAmount(statement.statement_debt_amount)} ekstre tutarı
                </p>
              ) : null}
              <div className="mt-3 grid gap-2 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-center">
                <p className="text-xs leading-5 text-success/80">
                  Bu tutar kart borcunun içindedir. Kredi kartı taksitleri ayrıca borç olarak ikinci kez eklenmez.
                </p>
                <button
                  type="button"
                  onClick={() => onPay(statement, card)}
                  disabled={Boolean(actionId)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white  disabled:opacity-60 hover:bg-success/90"
                >
                  <CheckCircle2 size={14} />
                  {actionId === statement.id ? 'İşleniyor...' : 'Ekstreyi öde'}
                </button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </SurfaceCard>
  )
}

/** Kesilmiş ekstre arşivi (açık + ödenmiş). Ekstreler sekmesinin kalıcı içeriği;
 *  daha önce Analiz → Detay'ın dibinde saklanıyordu, asıl yeri burası. */
export function StatementArchivePanel({ rows, statements }: { rows: Card[]; statements: CardStatementArchive[] }) {
  const { formatAmount } = useBalancePrivacy()
  const cardsById = useMemo(() => new Map(rows.map((card) => [card.id, card])), [rows])
  const archives = [...statements]
    .sort((a, b) => b.statement_date.localeCompare(a.statement_date))
    .slice(0, 8)

  return (
    <SurfaceCard className="border-border/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText size={17} />
              Ekstre arşivi
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kesilmiş son ekstreler; açık olanlar yukarıdaki panelden ödenir.</p>
          </div>
          <Badge variant="secondary">{archives.length} kayıt</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {archives.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Ekstre kesildiğinde arşiv burada tutulur.</p>
        ) : (
          archives.map((archive) => {
            const card = cardsById.get(archive.card_id)
            return (
              <div key={archive.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{card?.card_name ?? 'Kart'}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(archive.statement_date)} · son ödeme {formatDate(archive.due_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={archive.status === 'open' ? 'secondary' : 'outline'}>
                      {archive.status === 'open' ? 'Açık' : 'Ödendi'}
                    </Badge>
                    <span className="whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                      {formatAmount(archive.statement_debt_amount)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </SurfaceCard>
  )
}
