import type { CSSProperties } from 'react'
import { useState } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { SimpleModal } from '../components/SimpleModal'
import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

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
      setTransactionError('Tutar 0’dan büyük olmalı.')
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

    setTransactionCard(null)
    await reloadCards?.()
  }

  return (
    <>
      <CrudPage
        table="cards"
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
                `Ekstre: ${row.statement_day ?? '-'}`,
                `Son ödeme: ${row.due_day ?? '-'}`,
              ]
            : [`Bakiye: ${formatCurrency(row.current_balance)}`]
        }
        getCardClassName={() =>
          'border-[hsl(var(--bank-hue)_72%_74%)] bg-[hsl(var(--bank-hue)_88%_97%)] dark:border-[hsl(var(--bank-hue)_48%_38%)] dark:bg-[hsl(var(--bank-hue)_55%_16%)]'
        }
        getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_88%_94%)] dark:bg-[hsl(var(--bank-hue)_50%_22%)]'}
        getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        groupBy={(row) => cardGroupLabel(row.card_type)}
        getGroupClassName={() =>
          'border-b border-stone-200 bg-transparent px-0 pb-2 pt-1 text-stone-500 dark:border-stone-800 dark:bg-transparent dark:text-stone-400'
        }
        renderRowActions={(row, helpers) =>
          row.card_type === 'banka_karti' ? (
            <button
              type="button"
              onClick={() => openTransaction(row, helpers.reload)}
              className="rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm dark:border-emerald-900 dark:bg-stone-950/40 dark:text-emerald-300"
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
            className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {transactionSaving ? 'İşleniyor...' : 'Bakiyeyi güncelle'}
          </button>
        </form>
      </SimpleModal>
    </>
  )
}
