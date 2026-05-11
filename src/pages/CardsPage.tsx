import { ReceiptText, WalletCards } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'card_name', label: 'Kart / hesap adı', type: 'text', required: true },
  {
    name: 'holder_name',
    label: 'Kart sahibi',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'card_type',
    label: 'Tür',
    type: 'select',
    options: [
      { label: 'Kredi kartı', value: 'kredi_karti' },
      { label: 'Banka kartı', value: 'banka_karti' },
    ],
  },
  {
    name: 'limit_group_name',
    label: 'Ortak limit grubu',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'credit_limit',
    label: 'Limit / ortak limit',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'debt_amount',
    label: 'Güncel toplam borç',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_debt_amount',
    label: 'Dönem borcu',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'current_period_spending',
    label: 'Dönem içi harcama',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_day',
    label: 'Ekstre günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'due_day',
    label: 'Son ödeme günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'current_balance',
    label: 'Bakiye',
    type: 'number',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'banka_karti' },
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  return 'Banka kartı'
}

function cardGroupLabel(row: Card) {
  if (row.card_type === 'kredi_karti') return row.limit_group_name?.trim() ? `Ortak limit · ${row.limit_group_name.trim()}` : 'Tekil kredi kartları'
  return 'Banka kartları'
}

function normalizeBankName(bankName: string) {
  return bankName.trim().toLocaleLowerCase('tr-TR')
}

function bankHue(bankName: string, rows: Card[]) {
  const banks = Array.from(new Set(rows.map((row) => normalizeBankName(row.bank_name)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'tr-TR'),
  )
  const index = Math.max(0, banks.indexOf(normalizeBankName(bankName)))

  return (index * 47 + 196) % 360
}

function bankHueStyle(bankName: string, rows: Card[]) {
  return { '--bank-hue': String(bankHue(bankName, rows)) } as CSSProperties
}

function limitGroupKey(card: Card) {
  return card.limit_group_name?.trim() || card.id
}

function limitGroupCards(card: Card, rows: Card[]) {
  const key = limitGroupKey(card)
  return rows.filter((row) => row.card_type === 'kredi_karti' && limitGroupKey(row) === key)
}

function limitGroupStats(card: Card, rows: Card[]) {
  const groupCards = limitGroupCards(card, rows)
  const sharedLimit = Math.max(...groupCards.map((row) => row.credit_limit), card.credit_limit, 0)
  const totalDebt = groupCards.reduce((total, row) => total + row.debt_amount, 0)
  return {
    sharedLimit,
    totalDebt,
    availableLimit: Math.max(0, sharedLimit - totalDebt),
    usageRate: sharedLimit > 0 ? Math.min(100, (totalDebt / sharedLimit) * 100) : 0,
    isShared: Boolean(card.limit_group_name?.trim()) && groupCards.length > 1,
  }
}

type LimitGroupSummary = {
  key: string
  label: string
  bankName: string
  cards: Card[]
  limit: number
  debt: number
  statementDebt: number
  currentPeriod: number
  available: number
  usageRate: number
}

function buildLimitGroupSummaries(rows: Card[]): LimitGroupSummary[] {
  const groups = new Map<string, Card[]>()

  for (const card of rows.filter((row) => row.card_type === 'kredi_karti')) {
    const key = limitGroupKey(card)
    groups.set(key, [...(groups.get(key) ?? []), card])
  }

  return Array.from(groups, ([key, cards]) => {
    const limit = Math.max(...cards.map((card) => card.credit_limit), 0)
    const debt = cards.reduce((total, card) => total + card.debt_amount, 0)
    const statementDebt = cards.reduce((total, card) => total + card.statement_debt_amount, 0)
    const currentPeriod = cards.reduce((total, card) => total + card.current_period_spending, 0)
    const label = cards.find((card) => card.limit_group_name?.trim())?.limit_group_name?.trim() || cards[0]?.card_name || 'Kredi kartı'

    return {
      key,
      label,
      bankName: cards[0]?.bank_name ?? '',
      cards,
      limit,
      debt,
      statementDebt,
      currentPeriod,
      available: Math.max(0, limit - debt),
      usageRate: limit > 0 ? Math.min(100, (debt / limit) * 100) : 0,
    }
  }).sort((a, b) => b.debt - a.debt)
}

function CreditCardOverview({ rows }: { rows: Card[] }) {
  const groups = buildLimitGroupSummaries(rows)
  const bankCards = rows.filter((row) => row.card_type === 'banka_karti')
  if (groups.length === 0 && bankCards.length === 0) return null

  const totalLimit = groups.reduce((total, group) => total + group.limit, 0)
  const totalDebt = groups.reduce((total, group) => total + group.debt, 0)
  const totalAvailable = Math.max(0, totalLimit - totalDebt)
  const totalUsageRate = totalLimit > 0 ? Math.min(100, (totalDebt / totalLimit) * 100) : 0
  const cashBalance = bankCards.reduce((total, card) => total + card.current_balance, 0)

  return (
    <div className="flex flex-col gap-3">
      <SurfaceCard className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-muted-foreground">Kart özeti</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{formatCurrency(totalDebt)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Kalan ortak limit {formatCurrency(totalAvailable)}</p>
            </div>
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <WalletCards />
            </div>
          </div>
          <Progress value={totalUsageRate} className="mt-4 h-2" />
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <OverviewStat label="Limit" value={formatCurrency(totalLimit)} />
            <OverviewStat label="Kullanım" value={`%${Math.round(totalUsageRate)}`} />
            <OverviewStat label="Hesap" value={formatCurrency(cashBalance)} />
          </div>
        </CardContent>
      </SurfaceCard>

      {groups.length > 0 ? (
        <div className="flex snap-x gap-3 overflow-x-auto pb-1">
          {groups.map((group) => (
            <SurfaceCard key={group.key} className="min-w-[86%] snap-start border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800 min-[520px]:min-w-[48%]">
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{group.label}</CardTitle>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{group.bankName}</p>
                  </div>
                  <Badge variant="secondary">{group.cards.length} kart</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-1">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <OverviewStat label="Borç" value={formatCurrency(group.debt)} />
                  <OverviewStat label="Dönem" value={formatCurrency(group.statementDebt)} />
                  <OverviewStat label="Dönem içi" value={formatCurrency(group.currentPeriod)} />
                </div>
                <Progress value={group.usageRate} className="h-1.5" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Limit {formatCurrency(group.limit)}</span>
                  <span>Kalan {formatCurrency(group.available)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.cards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/55 px-2.5 py-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-foreground">
                        {card.holder_name || card.card_name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(card.debt_amount)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </SurfaceCard>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function cardOptionLabel(card: Card) {
  const owner = card.holder_name ? ` · ${card.holder_name}` : ''
  return `${card.bank_name} · ${card.card_name}${owner}`
}

function QuickExpensePanel({
  rows,
  reload,
  setError,
}: {
  rows: Card[]
  reload: () => Promise<void>
  setError: (message: string) => void
}) {
  const [cardId, setCardId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [localError, setLocalError] = useState('')
  const [saving, setSaving] = useState(false)
  const cards = useMemo(() => rows.filter((row) => row.card_type === 'kredi_karti' || row.card_type === 'banka_karti'), [rows])
  const activeCardId = cards.some((card) => card.id === cardId) ? cardId : (cards[0]?.id ?? '')
  const selectedCard = cards.find((card) => card.id === activeCardId)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedAmount = parseNumber(amount)
    const trimmedDescription = description.trim()
    if (!selectedCard) {
      setLocalError('Kart seçmelisin.')
      return
    }
    if (parsedAmount <= 0) {
      setLocalError('Tutar 0 dan büyük olmalı.')
      return
    }
    if (!trimmedDescription) {
      setLocalError('Açıklama yazmalısın.')
      return
    }

    setSaving(true)
    setLocalError('')
    setError('')
    const { error } = await supabase.rpc('add_card_expense', {
      p_card_id: selectedCard.id,
      p_amount: parsedAmount,
      p_description: trimmedDescription,
    })

    setSaving(false)
    if (error) {
      setLocalError(error.message)
      return
    }

    setAmount('')
    setDescription('')
    await reload()
  }

  if (cards.length === 0) return null

  return (
    <SurfaceCard className="border-0 shadow-sm ring-1 ring-emerald-200/80 dark:ring-emerald-900/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Hızlı harcama</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kart, TL tutar ve açıklama yeterli.</p>
          </div>
          {selectedCard ? (
            <Badge variant={selectedCard.card_type === 'kredi_karti' ? 'secondary' : 'outline'}>
              {selectedCard.card_type === 'kredi_karti'
                ? `Borç ${formatCurrency(selectedCard.debt_amount)}`
                : `Bakiye ${formatCurrency(selectedCard.current_balance)}`}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Kart
            <select
              value={activeCardId}
              onChange={(event) => {
                setCardId(event.target.value)
                setLocalError('')
              }}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              required
            >
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {cardOptionLabel(card)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
              TL
              <input
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setLocalError('')
                }}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                required
              />
            </label>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
              Açıklama
              <input
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                  setLocalError('')
                }}
                type="text"
                placeholder="Migros, benzin, yemek..."
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                required
              />
            </label>
          </div>
          {localError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{localError}</p> : null}
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-emerald-800"
          >
            {saving ? 'Ekleniyor...' : 'Harcamayı kaydet'}
          </button>
        </form>
      </CardContent>
    </SurfaceCard>
  )
}

export function CardsPage() {
  const [transactionCard, setTransactionCard] = useState<Card | null>(null)
  const [transactionType, setTransactionType] = useState<'in' | 'out'>('in')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [reloadCards, setReloadCards] = useState<(() => Promise<void>) | null>(null)
  const [debtPaymentCard, setDebtPaymentCard] = useState<Card | null>(null)
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('')
  const [debtPaymentSourceCard, setDebtPaymentSourceCard] = useState('')
  const [debtPaymentError, setDebtPaymentError] = useState('')
  const [debtPaymentSaving, setDebtPaymentSaving] = useState(false)
  const [allCards, setAllCards] = useState<Card[]>([])

  function openTransaction(card: Card, reload: () => Promise<void>) {
    setTransactionCard(card)
    setReloadCards(() => reload)
    setTransactionType('in')
    setTransactionAmount('')
    setTransactionError('')
  }

  async function handleTransactionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transactionCard) return

    const amount = parseNumber(transactionAmount)
    if (amount <= 0) {
      setTransactionError('Tutar 0 dan büyük olmalı.')
      return
    }

    const nextBalance = transactionType === 'in' ? transactionCard.current_balance + amount : transactionCard.current_balance - amount
    if (nextBalance < 0) {
      setTransactionError('Giden tutar mevcut bakiyeden büyük olamaz.')
      return
    }

    setTransactionSaving(true)
    setTransactionError('')
    const { error } = await supabase
      .from('cards')
      .update({ current_balance: nextBalance, updated_at: new Date().toISOString() })
      .eq('id', transactionCard.id)

    setTransactionSaving(false)
    if (error) {
      setTransactionError(error.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: transactionCard.user_id,
      type: 'transfer',
      title: `${transactionCard.card_name} ${transactionType === 'in' ? 'para girişi' : 'para çıkışı'}`,
      amount,
      source_table: 'cards',
      source_id: transactionCard.id,
      note: transactionType === 'in' ? 'Banka kartına para geldi.' : 'Banka kartından para çıktı.',
    })
    if (historyError) {
      setTransactionError(historyError.message)
      return
    }

    setTransactionCard(null)
    await reloadCards?.()
  }

  function openDebtPayment(card: Card, reload: () => Promise<void>, cards: Card[]) {
    setDebtPaymentCard(card)
    setReloadCards(() => reload)
    setAllCards(cards.filter((c) => c.card_type === 'banka_karti' && c.id !== card.id))
    setDebtPaymentAmount(String(card.statement_debt_amount || card.debt_amount || ''))
    setDebtPaymentSourceCard('')
    setDebtPaymentError('')
  }

  async function handleDebtPaymentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!debtPaymentCard) return

    const amount = parseNumber(debtPaymentAmount)
    if (amount <= 0) {
      setDebtPaymentError('Tutar 0 dan büyük olmalı.')
      return
    }

    if (!debtPaymentSourceCard) {
      setDebtPaymentError('Kaynak hesap seçmelisin.')
      return
    }

    const sourceCard = allCards.find((c) => c.id === debtPaymentSourceCard)
    if (!sourceCard) {
      setDebtPaymentError('Kaynak hesap bulunamadı.')
      return
    }

    if (sourceCard.current_balance < amount) {
      setDebtPaymentError('Kaynak hesap bakiyesi yetersiz.')
      return
    }

    setDebtPaymentSaving(true)
    setDebtPaymentError('')

    const { error: sourceError } = await supabase
      .from('cards')
      .update({ current_balance: sourceCard.current_balance - amount, updated_at: new Date().toISOString() })
      .eq('id', sourceCard.id)

    if (sourceError) {
      setDebtPaymentSaving(false)
      setDebtPaymentError(sourceError.message)
      return
    }

    const nextDebt = Math.max(0, debtPaymentCard.debt_amount - amount)
    const nextStatementDebt = Math.max(0, debtPaymentCard.statement_debt_amount - amount)
    const { error: debtError } = await supabase
      .from('cards')
      .update({ debt_amount: nextDebt, statement_debt_amount: nextStatementDebt, updated_at: new Date().toISOString() })
      .eq('id', debtPaymentCard.id)

    setDebtPaymentSaving(false)
    if (debtError) {
      setDebtPaymentError(debtError.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: debtPaymentCard.user_id,
      type: 'payment',
      title: `${debtPaymentCard.card_name} kart borcu ödendi`,
      amount,
      source_table: 'cards',
      source_id: debtPaymentCard.id,
      note: `${sourceCard.card_name} hesabından ödendi.`,
    })
    if (historyError) {
      setDebtPaymentError(historyError.message)
      return
    }

    setDebtPaymentCard(null)
    await reloadCards?.()
  }

  async function cutStatement(card: Card, reload: () => Promise<void>, setError: (message: string) => void) {
    if (card.current_period_spending <= 0) {
      setError('Dönem içi harcama olmadığı için kesilecek ekstre yok.')
      return
    }

    const { error } = await supabase
      .from('cards')
      .update({
        statement_debt_amount: card.statement_debt_amount + card.current_period_spending,
        current_period_spending: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', card.id)

    if (error) {
      setError(error.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: card.user_id,
      type: 'card',
      title: `${card.card_name} ekstresi kesildi`,
      amount: card.current_period_spending,
      source_table: 'cards',
      source_id: card.id,
      note: card.holder_name ? `${card.holder_name} kartı için dönem borcuna aktarıldı.` : 'Dönem borcuna aktarıldı.',
    })
    if (historyError) setError(historyError.message)

    await reload()
  }

  return (
    <>
      <CrudPage
        table="cards"
        pageTitle="Kartlar"
        addLabel="Kart ekle"
        fields={fields}
        emptyTitle="Henüz kart yok"
        emptyDescription="Kredi kartı ve banka kartlarını buradan takip edebilirsin."
        orderBy="card_type"
        renderBeforeList={({ loading, rows, reload, setError }) =>
          !loading ? (
            <div className="flex flex-col gap-3">
              <QuickExpensePanel rows={rows as Card[]} reload={reload} setError={setError} />
              <CreditCardOverview rows={rows as Card[]} />
            </div>
          ) : null
        }
        getInitialValues={(row?: Card) => ({
          bank_name: row?.bank_name ?? '',
          card_name: row?.card_name ?? '',
          card_type: row?.card_type ?? 'kredi_karti',
          holder_name: row?.holder_name ?? '',
          limit_group_name: row?.limit_group_name ?? '',
          current_balance: row?.current_balance ?? 0,
          credit_limit: row?.credit_limit ?? 0,
          debt_amount: row?.debt_amount ?? 0,
          statement_debt_amount: row?.statement_debt_amount ?? row?.debt_amount ?? 0,
          current_period_spending: row?.current_period_spending ?? 0,
          statement_day: row?.statement_day ?? '',
          due_day: row?.due_day ?? '',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => {
          const cardType = formData.get('card_type') as Card['card_type']
          const isCreditCard = cardType === 'kredi_karti'

          return {
            user_id: userId,
            bank_name: String(formData.get('bank_name') ?? ''),
            card_name: String(formData.get('card_name') ?? ''),
            card_type: cardType,
            holder_name: isCreditCard ? String(formData.get('holder_name') ?? '').trim() || null : null,
            limit_group_name: isCreditCard ? String(formData.get('limit_group_name') ?? '').trim() || null : null,
            current_balance: isCreditCard ? 0 : parseNumber(formData.get('current_balance')),
            credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
            debt_amount: isCreditCard ? parseNumber(formData.get('debt_amount')) : 0,
            statement_debt_amount: isCreditCard ? parseNumber(formData.get('statement_debt_amount')) : 0,
            current_period_spending: isCreditCard ? parseNumber(formData.get('current_period_spending')) : 0,
            statement_day: isCreditCard ? optionalDay(formData.get('statement_day')) : null,
            due_day: isCreditCard ? optionalDay(formData.get('due_day')) : null,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.card_name}
        renderSubtitle={(row) => `${row.bank_name} · ${cardTypeLabel(row.card_type)}`}
        renderDetails={(row) =>
          row.card_type === 'kredi_karti'
            ? [
                row.holder_name ? `Kart sahibi: ${row.holder_name}` : 'Kart sahibi: -',
                row.limit_group_name ? `Ortak limit: ${row.limit_group_name}` : 'Ortak limit: -',
                `Limit: ${formatCurrency(row.credit_limit)}`,
                `Güncel borç: ${formatCurrency(row.debt_amount)}`,
                `Dönem borcu: ${formatCurrency(row.statement_debt_amount)}`,
                `Dönem içi: ${formatCurrency(row.current_period_spending)}`,
                `Ekstre: ${row.statement_day ? `Her ayın ${row.statement_day}. günü` : '-'}`,
                `Son ödeme: ${row.due_day ? `Her ayın ${row.due_day}. günü` : '-'}`,
              ]
            : [`Bakiye: ${formatCurrency(row.current_balance)}`]
        }
        renderExtra={(row, helpers) => {
          if (row.card_type !== 'kredi_karti' || row.credit_limit <= 0) return null

          const stats = limitGroupStats(row, helpers.rows as Card[])
          return (
            <div className="mt-3 rounded-xl bg-white/60 p-3 dark:bg-stone-950/35">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-stone-600 dark:text-stone-400">
                <span>{stats.isShared ? 'Ortak limit kullanımı' : 'Limit kullanımı'}</span>
                <span>{Math.round(stats.usageRate)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${stats.usageRate}%` }}
                />
              </div>
              {stats.isShared ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-600 dark:text-stone-300">
                  <span>Grup borcu: {formatCurrency(stats.totalDebt)}</span>
                  <span className="text-right">Kalan limit: {formatCurrency(stats.availableLimit)}</span>
                </div>
              ) : null}
            </div>
          )
        }}
        getCardClassName={() =>
          'border-[hsl(var(--bank-hue)_72%_74%)] bg-[hsl(var(--bank-hue)_88%_97%)] dark:border-[hsl(var(--bank-hue)_48%_38%)] dark:bg-[hsl(var(--bank-hue)_55%_16%)]'
        }
        getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_88%_94%)] dark:bg-[hsl(var(--bank-hue)_50%_22%)]'}
        getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        groupBy={(row) => cardGroupLabel(row)}
        renderMenuActions={(row, helpers) =>
          row.card_type === 'kredi_karti' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  openDebtPayment(row, helpers.reload, helpers.rows as Card[])
                  helpers.closeMenu()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <ReceiptText size={14} />
                Borç öde
              </button>
              <button
                type="button"
                onClick={() => {
                  helpers.closeMenu()
                  void cutStatement(row, helpers.reload, helpers.setError)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                <ReceiptText size={14} />
                Ekstre kes
              </button>
            </>
          ) : null
        }
        renderRowActions={(row, helpers) =>
          row.card_type === 'banka_karti' ? (
            <button
              type="button"
              onClick={() => openTransaction(row, helpers.reload)}
              className="rounded-lg border border-stone-200 bg-stone-700 px-3 py-2 text-xs font-semibold text-white shadow-sm dark:border-stone-700 dark:bg-stone-600"
            >
              İşlem
            </button>
          ) : null
        }
      />

      <SimpleModal title="Banka kartı işlemi" open={Boolean(transactionCard)} onClose={() => setTransactionCard(null)}>
        <form onSubmit={handleTransactionSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{transactionCard?.card_name}</p>
            <p>Mevcut bakiye: {formatCurrency(transactionCard?.current_balance ?? 0)}</p>
          </div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            İşlem tipi
            <select
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value as 'in' | 'out')}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              <option value="in">Para geldi</option>
              <option value="out">Para gitti</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Tutar
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={transactionAmount}
              onChange={(event) => setTransactionAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          {transactionError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{transactionError}</p> : null}
          <button
            type="submit"
            disabled={transactionSaving}
            className="w-full rounded-xl bg-stone-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-stone-600"
          >
            {transactionSaving ? 'İşleniyor...' : 'Bakiyeyi güncelle'}
          </button>
        </form>
      </SimpleModal>

      <SimpleModal title="Kredi kartı borç ödeme" open={Boolean(debtPaymentCard)} onClose={() => setDebtPaymentCard(null)}>
        <form onSubmit={handleDebtPaymentSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{debtPaymentCard?.card_name}</p>
            <p>Mevcut borç: {formatCurrency(debtPaymentCard?.debt_amount ?? 0)}</p>
          </div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Ödeme tutarı
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={debtPaymentAmount}
              onChange={(event) => setDebtPaymentAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Kaynak hesap
            <select
              required
              value={debtPaymentSourceCard}
              onChange={(event) => setDebtPaymentSourceCard(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              <option value="">Hesap seç</option>
              {allCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.card_name} ({formatCurrency(card.current_balance)})
                </option>
              ))}
            </select>
          </label>
          {debtPaymentError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{debtPaymentError}</p> : null}
          <button
            type="submit"
            disabled={debtPaymentSaving}
            className="w-full rounded-xl bg-stone-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-stone-600"
          >
            {debtPaymentSaving ? 'İşleniyor...' : 'Borç öde'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
