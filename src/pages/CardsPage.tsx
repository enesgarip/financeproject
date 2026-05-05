import type { CSSProperties } from 'react'
import { useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'card_name', label: 'Kart / hesap adı', type: 'text', required: true },
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
    name: 'credit_limit',
    label: 'Limit',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'debt_amount',
    label: 'Borç tutarı',
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

function cardGroupLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartları'
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
  const [expenseCard, setExpenseCard] = useState<Card | null>(null)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseError, setExpenseError] = useState('')
  const [expenseSaving, setExpenseSaving] = useState(false)

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
    setDebtPaymentAmount('')
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
    const { error: debtError } = await supabase
      .from('cards')
      .update({ debt_amount: nextDebt, updated_at: new Date().toISOString() })
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

  function openExpense(card: Card, reload: () => Promise<void>) {
    setExpenseCard(card)
    setReloadCards(() => reload)
    setExpenseAmount('')
    setExpenseError('')
  }

  async function handleExpenseSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!expenseCard) return

    const amount = parseNumber(expenseAmount)
    if (amount <= 0) {
      setExpenseError('Harcama tutarı 0 dan büyük olmalı.')
      return
    }

    setExpenseSaving(true)
    setExpenseError('')

    const nextDebt = expenseCard.debt_amount + amount
    const { error } = await supabase
      .from('cards')
      .update({ debt_amount: nextDebt, updated_at: new Date().toISOString() })
      .eq('id', expenseCard.id)

    setExpenseSaving(false)
    if (error) {
      setExpenseError(error.message)
      return
    }

    const historyError = await addTransactionHistory({
      user_id: expenseCard.user_id,
      type: 'card',
      title: `${expenseCard.card_name} harcama`,
      amount,
      source_table: 'cards',
      source_id: expenseCard.id,
      note: 'Kredi kartına harcama eklendi.',
    })
    if (historyError) {
      setExpenseError(historyError.message)
      return
    }

    setExpenseCard(null)
    await reloadCards?.()
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
        getInitialValues={(row?: Card) => ({
          bank_name: row?.bank_name ?? '',
          card_name: row?.card_name ?? '',
          card_type: row?.card_type ?? 'kredi_karti',
          current_balance: row?.current_balance ?? 0,
          credit_limit: row?.credit_limit ?? 0,
          debt_amount: row?.debt_amount ?? 0,
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
            current_balance: isCreditCard ? 0 : parseNumber(formData.get('current_balance')),
            credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
            debt_amount: isCreditCard ? parseNumber(formData.get('debt_amount')) : 0,
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
                `Limit: ${formatCurrency(row.credit_limit)}`,
                `Borç: ${formatCurrency(row.debt_amount)}`,
                `Ekstre: ${row.statement_day ? `Her ayın ${row.statement_day}. günü` : '-'}`,
                `Son ödeme: ${row.due_day ? `Her ayın ${row.due_day}. günü` : '-'}`,
              ]
            : [`Bakiye: ${formatCurrency(row.current_balance)}`]
        }
        renderExtra={(row) =>
          row.card_type === 'kredi_karti' && row.credit_limit > 0 ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-xs text-stone-600 dark:text-stone-400">
                <span>Limit kullanımı</span>
                <span>{Math.round((row.debt_amount / row.credit_limit) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-500"
                  style={{ width: `${Math.min(100, (row.debt_amount / row.credit_limit) * 100)}%` }}
                />
              </div>
            </div>
          ) : null
        }
        getCardClassName={() =>
          'border-[hsl(var(--bank-hue)_72%_74%)] bg-[hsl(var(--bank-hue)_88%_97%)] dark:border-[hsl(var(--bank-hue)_48%_38%)] dark:bg-[hsl(var(--bank-hue)_55%_16%)]'
        }
        getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_88%_94%)] dark:bg-[hsl(var(--bank-hue)_50%_22%)]'}
        getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        groupBy={(row) => cardGroupLabel(row.card_type)}
        renderMenuActions={(row, helpers) =>
          row.card_type === 'kredi_karti' ? (
            <button
              type="button"
              onClick={() => {
                openDebtPayment(row, helpers.reload, helpers.rows as Card[])
                helpers.closeMenu()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              💳 Borç öde
            </button>
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
          ) : row.card_type === 'kredi_karti' ? (
            <button
              type="button"
              onClick={() => openExpense(row, helpers.reload)}
              className="rounded-lg border border-stone-200 bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 dark:border-stone-700 dark:bg-rose-600"
            >
              Harcama ekle
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

      <SimpleModal title="Harcama ekle" open={Boolean(expenseCard)} onClose={() => setExpenseCard(null)}>
        <form onSubmit={handleExpenseSubmit} className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            <p className="font-semibold text-stone-950 dark:text-stone-50">{expenseCard?.card_name}</p>
            <p>Mevcut borç: {formatCurrency(expenseCard?.debt_amount ?? 0)}</p>
          </div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
            Harcama tutarı
            <input
              type="number"
              min="0"
              step="0.01"
              value={expenseAmount}
              onChange={(event) => setExpenseAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-rose-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
              placeholder="0.00"
              required
            />
          </label>
          {expenseError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{expenseError}</p> : null}
          <button
            type="submit"
            disabled={expenseSaving}
            className="w-full rounded-xl bg-rose-600 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60 hover:bg-rose-700"
          >
            {expenseSaving ? 'Ekleniyor...' : 'Harcamayı ekle'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
