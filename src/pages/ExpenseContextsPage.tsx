import { Briefcase, CreditCard, FolderKanban, HeartPulse, Palette, PawPrint, Plane, Plus, Trash2, Wallet, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useExpenseContexts, useInvalidateExpenseContexts } from '../app/useExpenseContexts'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input, Select } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { useToast } from '../components/ui/toast'
import { fetchTaggableCardExpenses } from '../data/repositories/cardsRepo'
import {
  deleteContextExpense,
  deleteExpenseContext,
  insertContextExpense,
  insertExpenseContext,
  setCardExpenseContext,
} from '../data/repositories/expenseContextsRepo'
import type { CardExpense, ExpenseContext, ExpenseContextKind } from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import {
  EXPENSE_CONTEXT_KINDS,
  contextCategories,
  contextKindLabel,
  contextKindTimeboxed,
  type ExpenseContextSummary,
} from '../utils/expenseContexts'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

/** Tür → ikon (registry saf util olduğu için ikon eşlemesi UI katmanında). */
const KIND_ICONS: Record<ExpenseContextKind, LucideIcon> = {
  pet: PawPrint,
  health: HeartPulse,
  hobby: Palette,
  business: Briefcase,
  travel: Plane,
  project: FolderKanban,
}

/** Tür adına göre isim alanı ipucu. */
function namePlaceholder(kind: ExpenseContextKind): string {
  if (kind === 'pet') return 'Adı (ör. Luna)'
  if (kind === 'travel') return 'Gezi adı (ör. Kapadokya)'
  if (kind === 'project') return 'Proje adı'
  return 'Ad'
}

export function ExpenseContextsPage() {
  const query = useExpenseContexts()
  const invalidate = useInvalidateExpenseContexts()
  const { user } = useAuth()
  const toast = useToast()
  const { confirm, confirmDialog } = useConfirmDialog()
  const contexts = query.data?.contexts ?? []

  const refresh = useCallback(async () => { await invalidate() }, [invalidate])

  if (query.isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />

  return (
    <div className="flex flex-col gap-5">
      {query.isError ? <Alert variant="warning">Bağlam verisi yüklenemedi. Sayfayı yenilemeyi dene.</Alert> : null}
      <ContextManager
        contexts={contexts}
        userId={user?.id}
        onChanged={refresh}
        onError={(message) => toast.error('Olmadı', message)}
        confirm={confirm}
      />
      {contexts.length > 0 ? (
        <>
          <ManualContextExpenseForm
            contexts={contexts}
            userId={user?.id}
            onChanged={async () => { await refresh(); toast.success('Gider eklendi.') }}
            onError={(message) => toast.error('Gider eklenemedi', message)}
          />
          <ContextCardTagging
            contexts={contexts}
            onChanged={refresh}
            onError={(message) => toast.error('Atanamadı', message)}
          />
          <section className="grid gap-4 lg:grid-cols-2">
            {(query.data?.summaries ?? []).map((summary) => (
              <ContextSummaryCard
                key={summary.context.id}
                summary={summary}
                onDelete={async (id) => {
                  const result = await deleteContextExpense(id)
                  if (!result.ok) return toast.error('Silinemedi', result.error.message)
                  await refresh()
                }}
              />
            ))}
          </section>
        </>
      ) : null}
      {confirmDialog}
    </div>
  )
}

function ContextManager({ contexts, userId, onChanged, onError, confirm }: {
  contexts: ExpenseContext[]
  userId?: string
  onChanged: () => Promise<void>
  onError: (message: string) => void
  confirm: ReturnType<typeof useConfirmDialog>['confirm']
}) {
  const [kind, setKind] = useState<ExpenseContextKind>('pet')
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!userId || !name.trim() || saving) return
    setSaving(true)
    const parsedBudget = parseNumber(budget)
    const result = await insertExpenseContext({
      user_id: userId,
      kind,
      name: name.trim(),
      budget_amount: budget.trim() ? parsedBudget : null,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      sort_order: contexts.length,
      note: null,
    })
    setSaving(false)
    if (!result.ok) return onError(result.error.message)
    setName(''); setBudget(''); setStartsOn(''); setEndsOn('')
    await onChanged()
  }

  async function remove(context: ExpenseContext) {
    const ok = await confirm({
      title: `${context.name} silinsin mi?`,
      description: 'Kart-dışı giderler silinir. Kart harcamaları kalır; yalnız bağlam etiketi düşer.',
      confirmLabel: 'Sil', variant: 'destructive',
    })
    if (!ok) return
    const result = await deleteExpenseContext(context.id)
    if (!result.ok) return onError(result.error.message)
    await onChanged()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><FolderKanban className="size-4 text-primary" /> Gider bağlamları</CardTitle>
        <p className="text-xs text-ink-muted">Evcil hayvan giderlerini veya düğün, taşınma gibi süreli projeleri tek mercekte izle.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {contexts.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {contexts.map((context) => {
              const KindIcon = KIND_ICONS[context.kind] ?? FolderKanban
              return (
              <li key={context.id} className="flex items-center justify-between rounded-xl border border-line-strong px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <KindIcon className="size-4 text-primary" />
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{context.name}</p><p className="text-xs text-ink-muted">{contextKindLabel(context.kind)}</p></div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`${context.name} bağlamını sil`} onClick={() => void remove(context)}><Trash2 /></Button>
              </li>
              )
            })}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-ink-muted">İlk evcil hayvanını veya projeni ekle.</p>}
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as ExpenseContextKind
              setKind(next)
              // Süresiz tür (pet/sağlık/hobi/yan iş) tarih taşımaz — temizle.
              if (!contextKindTimeboxed(next)) { setStartsOn(''); setEndsOn('') }
            }}
            aria-label="Bağlam türü"
          >
            {EXPENSE_CONTEXT_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>{entry.label}</option>
            ))}
          </Select>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={namePlaceholder(kind)} aria-label="Bağlam adı" required />
          <Input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" placeholder="Bütçe (ops.)" aria-label="Bağlam bütçesi" />
          {contextKindTimeboxed(kind) ? (
            <>
              <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} aria-label="Başlangıç (opsiyonel)" />
              <Input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} aria-label="Bitiş (boş bırak = süresiz)" />
            </>
          ) : null}
          <Button type="submit" disabled={!name.trim() || saving}><Plus /> {saving ? 'Ekleniyor...' : 'Ekle'}</Button>
        </form>
        <p className="text-xs text-ink-muted">
          Bütçe ve tarihler opsiyonel. Bitişi boş bırakırsan bağlam <strong className="font-semibold text-ink">süresiz</strong> sürer; evcil hayvan zaten süresizdir.
        </p>
      </CardContent>
    </Card>
  )
}

function ManualContextExpenseForm({ contexts, userId, onChanged, onError }: {
  contexts: ExpenseContext[]; userId?: string; onChanged: () => Promise<void>; onError: (message: string) => void
}) {
  const [contextId, setContextId] = useState(contexts[0]?.id ?? '')
  const active = contexts.find((context) => context.id === contextId) ?? contexts[0]
  const categories = contextCategories(active?.kind ?? 'pet')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(categories[0])
  const [paymentMethod, setPaymentMethod] = useState<'nakit' | 'banka' | 'diger'>('nakit')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsedAmount = parseNumber(amount)
    if (!userId || !active || parsedAmount <= 0 || saving) return
    setSaving(true)
    const result = await insertContextExpense({ user_id: userId, context_id: active.id, spent_at: spentAt, amount: parsedAmount, category, payment_method: paymentMethod, description: description.trim(), note: null })
    setSaving(false)
    if (!result.ok) return onError(result.error.message)
    setAmount(''); setDescription(''); await onChanged()
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4 text-primary" /> Kart-dışı gider ekle</CardTitle></CardHeader>
      <CardContent><form onSubmit={submit} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Select value={active?.id ?? ''} onChange={(event) => { setContextId(event.target.value); const next = contexts.find((c) => c.id === event.target.value); setCategory(contextCategories(next?.kind ?? 'pet')[0]) }} aria-label="Gider bağlamı">
          {contexts.map((context) => <option key={context.id} value={context.id}>{context.name}</option>)}
        </Select>
        <Input type="date" value={spentAt} onChange={(event) => setSpentAt(event.target.value)} aria-label="Gider tarihi" />
        <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="TL tutar" aria-label="Gider tutarı" required />
        <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Gider kategorisi">{categories.map((item) => <option key={item}>{item}</option>)}</Select>
        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Açıklama" aria-label="Gider açıklaması" />
        <div className="flex gap-2"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} aria-label="Ödeme yöntemi"><option value="nakit">Nakit</option><option value="banka">Banka</option><option value="diger">Diğer</option></Select><Button type="submit" aria-label="Bağlam giderini ekle" disabled={parseNumber(amount) <= 0 || saving}><Plus /></Button></div>
      </form></CardContent>
    </Card>
  )
}

function ContextCardTagging({ contexts, onChanged, onError }: { contexts: ExpenseContext[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const [expenses, setExpenses] = useState<CardExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const load = useCallback(async () => { const result = await fetchTaggableCardExpenses(100); if (result.ok) setExpenses(result.data); setLoading(false) }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  const names = useMemo(() => new Map(contexts.map((context) => [context.id, context.name])), [contexts])

  async function assign(expense: CardExpense, contextId: string) {
    setBusyId(expense.id)
    const result = await setCardExpenseContext(expense.id, contextId || null)
    setBusyId(null)
    if (!result.ok) return onError(result.error.message)
    setExpenses((rows) => rows.map((row) => row.id === expense.id ? { ...row, context_id: contextId || null } : row))
    await onChanged()
  }

  return (
    <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="size-4 text-primary" /> Kart harcamasını bağlama ata</CardTitle><p className="text-xs text-ink-muted">Etiketleme kart borcunu değiştirmez. Henüz kesinleşmemiş provizyonlar da listelenir.</p></CardHeader><CardContent>
      {loading ? <Skeleton className="h-24 rounded-xl" /> : <ul className="flex flex-col divide-y divide-line">{expenses.map((expense) => <li key={expense.id} className="flex items-center justify-between gap-3 py-2"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{expense.description}</span>{expense.status === 'provision' ? <Badge variant="outline" className="shrink-0">Provizyon</Badge> : null}</p><p className="truncate text-xs text-ink-muted">{formatDate(expense.spent_at)} · {formatCurrency(expense.amount)}{expense.context_id ? ` · ${names.get(expense.context_id) ?? 'Bağlam'}` : ''}</p></div><Select className="w-40 shrink-0" value={expense.context_id ?? ''} disabled={busyId === expense.id} onChange={(event) => void assign(expense, event.target.value)} aria-label={`${expense.description} için bağlam`}><option value="">Bağlam yok</option>{contexts.map((context) => <option key={context.id} value={context.id}>{context.name}</option>)}</Select></li>)}</ul>}
    </CardContent></Card>
  )
}

function ContextSummaryCard({ summary, onDelete }: { summary: ExpenseContextSummary; onDelete: (id: string) => Promise<void> }) {
  const { context, total, thisMonthTotal, remainingBudget, budgetUsedRatio, entries } = summary
  const usedWidth = `${Math.min(100, Math.max(0, (budgetUsedRatio ?? 0) * 100))}%`
  const KindIcon = KIND_ICONS[context.kind] ?? FolderKanban
  return (
    <Card><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><KindIcon className="size-4 text-primary" />{context.name}</CardTitle>{context.ends_on ? <p className="text-xs text-ink-muted">Bitiş {formatDate(context.ends_on)}</p> : <Badge variant="outline" className="mt-1">Süresiz</Badge>}</div><div className="text-right"><p className="font-bold tabular-nums">{formatCurrency(total)}</p><p className="text-xs text-ink-muted">Bu ay {formatCurrency(thisMonthTotal)}</p></div></div></CardHeader><CardContent className="flex flex-col gap-4">
      {remainingBudget != null ? <div><div className="mb-1 flex justify-between text-xs"><span className="font-semibold">Bütçe burn-down</span><span className={remainingBudget < 0 ? 'text-destructive' : 'text-ink-muted'}>{remainingBudget < 0 ? `${formatCurrency(-remainingBudget)} aşıldı` : `${formatCurrency(remainingBudget)} kaldı`}</span></div><div className="h-2 overflow-hidden rounded-full bg-page"><div className={`h-full rounded-full ${remainingBudget < 0 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: usedWidth }} /></div></div> : null}
      {entries.length ? <ul className="flex flex-col divide-y divide-line">{entries.slice(0, 10).map((entry) => <li key={entry.id} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{entry.description}</p><p className="text-xs text-ink-muted">{formatDate(entry.spentAt)} · {entry.category}</p></div><div className="flex items-center gap-2"><Badge variant={entry.source === 'card' ? 'secondary' : 'outline'}>{entry.paymentLabel}</Badge><span className="text-sm font-semibold tabular-nums">{formatCurrency(entry.amount)}</span>{entry.source === 'manual' ? <Button size="icon-xs" variant="ghost" aria-label="Gideri sil" onClick={() => void onDelete(entry.id.replace(/^manual:/, ''))}><Trash2 /></Button> : null}</div></li>)}</ul> : <p className="text-sm text-ink-muted">Henüz gider yok.</p>}
    </CardContent></Card>
  )
}
