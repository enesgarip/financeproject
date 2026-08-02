import { useState } from 'react'
import { Link } from 'react-router'
import { SimpleModal } from '../components/SimpleModal'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import type { Card, CardExpense } from '../types/database'
import { expenseCategoryOptions } from '../utils/categories'
import { formatDate } from '../utils/date'
import type { HealthIssue } from './DataHealth.logic'

export type DataHealthCardExpenseReviewProps = {
  issue: HealthIssue
  expenses: CardExpense[]
  cards: Card[]
  busy: boolean
  error: string
  onClose: () => void
  onCancelDuplicate: (expenseId: string) => void
  onUpdateMetadata: (input: {
    expenseId: string
    description: string
    category: string
    expectedUpdatedAt: string
  }) => void
}

const statusLabels: Record<CardExpense['status'], string> = {
  provision: 'Provizyon',
  posted: 'Kesinleşti',
  cancelled: 'İptal edildi',
}

const sourceLabels: Record<NonNullable<CardExpense['source']>, string> = {
  manual: 'Manuel',
  sms: 'SMS',
  statement_import: 'Ekstre içe aktarma',
  movement_import: 'Hareket içe aktarma',
  receipt_scan: 'Fiş tarama',
  payment_auto: 'Otomatik ödeme',
  carryover: 'Devir',
}

function candidateExpenses(issue: HealthIssue, expenses: CardExpense[]) {
  const expensesById = new Map(expenses.map((expense) => [expense.id, expense]))
  const seen = new Set<string>()
  return (issue.payload?.ids ?? []).flatMap((id) => {
    const expense = expensesById.get(id)
    if (!expense || seen.has(id)) return []
    seen.add(id)
    return [expense]
  })
}

function cardLabel(expense: CardExpense, cardsById: Map<string, Card>) {
  const card = cardsById.get(expense.card_id)
  return card ? `${card.bank_name} · ${card.card_name}` : `Bilinmeyen kart · ${expense.card_id}`
}

function shortRecordDate(value: string | null | undefined) {
  return formatDate(value?.slice(0, 10))
}

function ExpenseDetails({
  expense,
  cardsById,
  formatAmount,
}: {
  expense: CardExpense
  cardsById: Map<string, Card>
  formatAmount: (value: number | null | undefined) => string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{expense.description.trim() || 'Açıklama eksik'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{cardLabel(expense, cardsById)}</p>
        </div>
        <p className="shrink-0 font-mono text-sm font-black tabular-nums text-foreground">
          {formatAmount(expense.amount)}
        </p>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-muted-foreground">İşlem tarihi</dt>
          <dd className="mt-0.5 text-foreground">{formatDate(expense.spent_at)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Durum</dt>
          <dd className="mt-0.5 text-foreground">{statusLabels[expense.status]}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Kategori</dt>
          <dd className="mt-0.5 text-foreground">{expense.category.trim() || 'Kategori eksik'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Kaynak</dt>
          <dd className="mt-0.5 text-foreground">
            {expense.source ? sourceLabels[expense.source] : 'Eski kayıt / bilinmiyor'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Taksit</dt>
          <dd className="mt-0.5 text-foreground">{expense.installment_count} çekim</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Oluşturulma</dt>
          <dd className="mt-0.5 text-foreground">{shortRecordDate(expense.created_at)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">İşlenme tarihi</dt>
          <dd className="mt-0.5 text-foreground">{shortRecordDate(expense.posted_at)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Kayıt kimliği</dt>
          <dd className="mt-0.5 break-all font-mono text-foreground">{expense.id}</dd>
        </div>
      </dl>
      {expense.note ? (
        <p className="mt-3 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Not:</span> {expense.note}
        </p>
      ) : null}
      {expense.transaction_fingerprint ? (
        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
          İşlem parmak izi: {expense.transaction_fingerprint}
        </p>
      ) : null}
    </div>
  )
}

function ReviewContent(props: DataHealthCardExpenseReviewProps) {
  const {
    issue,
    expenses,
    cards,
    busy,
    error,
    onClose,
    onCancelDuplicate,
    onUpdateMetadata,
  } = props
  const { formatAmount } = useBalancePrivacy()
  const [selectedExpenseId, setSelectedExpenseId] = useState('')
  const [compared, setCompared] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const candidates = candidateExpenses(issue, expenses)
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const selectedExpense = candidates.find((expense) => expense.id === selectedExpenseId)
  const isDuplicate = issue.kind === 'duplicateTransactionCandidate'
  const isDataQuality = issue.kind === 'cardExpenseDataQuality'
  const unresolvedIds = (issue.payload?.ids ?? []).filter(
    (id) => !candidates.some((expense) => expense.id === id),
  )

  function selectMetadataCandidate(expense: CardExpense) {
    setSelectedExpenseId(expense.id)
    setDescription(expense.description)
    setCategory(expense.category)
  }

  function submitMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedDescription = description.trim()
    const normalizedCategory = category.trim()
    if (!selectedExpense || !normalizedDescription || !normalizedCategory || busy) return
    onUpdateMetadata({
      expenseId: selectedExpense.id,
      description: normalizedDescription,
      category: normalizedCategory,
      expectedUpdatedAt: selectedExpense.updated_at,
    })
  }

  return (
    <SimpleModal
      title={isDuplicate ? 'Tekrarlanan harcamaları karşılaştır' : 'Eksik harcama bilgisini tamamla'}
      open
      onClose={onClose}
    >
      <div className="space-y-4" aria-busy={busy}>
        <div className="rounded-xl border border-info/20 bg-info/8 p-3 text-sm text-muted-foreground">
          <p className="font-bold text-foreground">{issue.title}</p>
          <p className="mt-1">{issue.description}</p>
          <Link
            to="/kartlar?section=islemler"
            className="mt-3 inline-flex rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/12"
          >
            Kart işlemleri ekranını aç
          </Link>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        {candidates.length === 0 ? (
          <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm text-warning">
            İncelenecek harcama kayıtları bulunamadı. Veriyi yenileyip tekrar dene.
          </p>
        ) : (
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-2 text-sm font-bold text-foreground">
              {isDuplicate ? 'Karşılaştırılacak adaylar' : 'Düzeltilecek harcamayı seç'}
            </legend>
            {candidates.map((expense, index) => (
              <label
                key={expense.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  selectedExpenseId === expense.id
                    ? 'border-primary/45 bg-primary/8 ring-1 ring-primary/15'
                    : 'border-border/70 bg-card/70 hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  name={`${isDuplicate ? 'duplicate' : 'metadata'}-${issue.id}`}
                  value={expense.id}
                  checked={selectedExpenseId === expense.id}
                  onChange={() => {
                    if (isDataQuality) selectMetadataCandidate(expense)
                    else {
                      setSelectedExpenseId(expense.id)
                      setCompared(false)
                    }
                  }}
                  aria-label={`Aday ${index + 1}: ${expense.description.trim() || 'Açıklama eksik'}`}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <ExpenseDetails expense={expense} cardsById={cardsById} formatAmount={formatAmount} />
              </label>
            ))}
          </fieldset>
        )}

        {unresolvedIds.length > 0 ? (
          <div className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-xs text-warning">
            <p className="font-bold">{unresolvedIds.length} aday artık yüklenen veride yok.</p>
            <p className="mt-1 break-all font-mono">{unresolvedIds.join(', ')}</p>
          </div>
        ) : null}

        {isDuplicate ? (
          <div className="space-y-3 rounded-xl border border-warning/20 bg-warning/8 p-3">
            <p className="text-xs text-warning">
              Yalnız gerçekten tekrarlanan kaydı seç. İptal, geçmişi silmeden kart işlem akışında uygulanır.
            </p>
            <label className="flex items-start gap-2 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                checked={compared}
                onChange={(event) => setCompared(event.target.checked)}
                disabled={busy || !selectedExpenseId}
                className="mt-0.5 size-4 accent-primary"
              />
              Kayıtları karşılaştırdım
            </label>
            <button
              type="button"
              onClick={() => {
                if (selectedExpenseId && compared && !busy) onCancelDuplicate(selectedExpenseId)
              }}
              disabled={busy || !selectedExpenseId || !compared}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-destructive px-4 text-sm font-bold text-destructive-foreground transition hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'İptal ediliyor...' : 'Seçili tekrar kaydını iptal et'}
            </button>
          </div>
        ) : null}

        {isDataQuality && selectedExpense ? (
          <form onSubmit={submitMetadata} className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <label className="block text-sm font-semibold text-foreground">
              Açıklama
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
                className="mt-1 min-h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
            </label>
            <label className="block text-sm font-semibold text-foreground">
              Kategori
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                disabled={busy}
                className="mt-1 min-h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              >
                <option value="">Kategori seçin</option>
                {expenseCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !description.trim() || !category.trim()}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Kaydediliyor...' : 'Değişiklikleri kaydet'}
            </button>
          </form>
        ) : null}

        {!isDuplicate && !isDataQuality ? (
          <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm text-warning">
            Bu bulgu harcama karşılaştırma modalıyla çözülemiyor.
          </p>
        ) : null}
      </div>
    </SimpleModal>
  )
}

export function DataHealthCardExpenseReview(props: DataHealthCardExpenseReviewProps) {
  return <ReviewContent key={props.issue.id} {...props} />
}
