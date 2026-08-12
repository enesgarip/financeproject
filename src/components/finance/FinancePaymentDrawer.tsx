import { useEffect, useState, type ReactNode } from 'react'
import {
  accountLabelForObligation,
  amountLabelForObligation,
  emptyAccountMessageForObligation,
  estimatedMinimumCardPayment,
  findRecentSmsAccountDebit,
  modalTitleForObligation,
  obligationAmountEditable,
  submitLabelForObligation,
  type RecentSmsAccountDebit,
} from '../../services/financePaymentActions'
import type { Card } from '../../types/database'
import { formatDate } from '../../utils/date'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { parseNumber } from '../../utils/formatCurrency'
import { exceedsTL } from '../../utils/money'
import type { FinanceObligation } from '../../utils/obligations'
import { AccountPaymentModal } from './AccountPaymentModal'

type AccountPaymentSubmit = {
  account: Card
  amount: number
  skipSourceDebit?: boolean
}

type FinancePaymentDrawerProps = {
  intent: FinanceObligation | null
  open: boolean
  accounts: Card[]
  selectedAccountId: string
  onSelectedAccountChange: (value: string) => void
  amountValue: string
  onAmountValueChange: (value: string) => void
  onClose: () => void
  onSubmit: (payload: AccountPaymentSubmit) => Promise<void> | void
  saving?: boolean
  externalError?: string
  detail?: ReactNode
}

function defaultPaymentDetail(intent: FinanceObligation | null, formatAmount: (value: number | null | undefined) => string) {
  if (!intent) return null

  return (
    <>
      <p className="font-semibold text-foreground">{intent.title}</p>
      <p className="mt-0.5">{intent.subtitle}</p>
      <p className="mt-0.5">Tarih: {formatDate(intent.date)}</p>
      <p className="mt-0.5">
        Planlanan tutar:{' '}
        <span className="font-mono font-semibold text-foreground">{formatAmount(intent.amount)}</span>
      </p>
    </>
  )
}

export function FinancePaymentDrawer({
  intent,
  open,
  accounts,
  selectedAccountId,
  onSelectedAccountChange,
  amountValue,
  onAmountValueChange,
  onClose,
  onSubmit,
  saving = false,
  externalError = '',
  detail,
}: FinancePaymentDrawerProps) {
  const { formatAmount } = useBalancePrivacy()
  // Asgari yalnız EKSTRE kovası üzerinden (K7): bankada dönem içi harcamanın
  // asgarisi olmaz. Taban 0 ise (salt dönem içi borç) ipucu hiç gösterilmez.
  // K7: ekstre de kısmi/asgari ödenebilir; iki kart akışında da taban ekstre kovası.
  const minimumPayment =
    intent?.action === 'pay_card_debt' || intent?.action === 'pay_card_statement'
      ? estimatedMinimumCardPayment(intent.minimumPaymentBase ?? 0)
      : 0
  // B4: seçili hesapta son 3 günde aynı tutarlı SMS kaynaklı çıkış varsa bakiye
  // muhtemelen zaten düşmüş demektir; kullanıcıya "tekrar düşme" seçeneği sunulur.
  // Sonuç, sorgulandığı (hesap, tutar) anahtarıyla saklanır; anahtar değişince
  // eski sonuç render'da geçersiz sayılır (effect'te senkron temizlik gerekmez).
  const isCardPayment = intent?.action === 'pay_card_debt' || intent?.action === 'pay_card_statement'
  const [smsDebit, setSmsDebit] = useState<{ key: string; match: RecentSmsAccountDebit | null }>({ key: '', match: null })
  const [skipDebitChecked, setSkipDebitChecked] = useState(true)
  const parsedAmount = parseNumber(amountValue)
  const smsDebitKey = open && isCardPayment && selectedAccountId && parsedAmount > 0
    ? `${selectedAccountId}:${parsedAmount}`
    : ''

  useEffect(() => {
    if (!smsDebitKey) return

    let cancelled = false
    const [accountId, rawAmount] = smsDebitKey.split(':')
    void findRecentSmsAccountDebit(accountId, Number(rawAmount)).then((match) => {
      if (cancelled) return
      setSmsDebit({ key: smsDebitKey, match })
      if (match) setSkipDebitChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [smsDebitKey])

  const smsDebitMatch = smsDebitKey && smsDebit.key === smsDebitKey ? smsDebit.match : null
  const skipSourceDebit = Boolean(smsDebitMatch && skipDebitChecked)
  // Tavan, nominal tutardan büyük olabilir: ekstre kalemi "planlanan" ekstre
  // borcunu gösterir ama pay_card_debt dönem içini de kapatabilir (B7).
  const payableCeiling = intent ? intent.maxPayableAmount ?? intent.amount : 0
  const quickAmounts = isCardPayment && intent ? (
    <div className="flex flex-wrap gap-2">
      {minimumPayment > 0 ? (
        <button
          type="button"
          onClick={() => onAmountValueChange(String(minimumPayment))}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
        >
          Asgari tahmini ({formatAmount(minimumPayment)})
        </button>
      ) : null}
      {exceedsTL(payableCeiling, intent.amount) && exceedsTL(intent.amount, 0) ? (
        <button
          type="button"
          onClick={() => onAmountValueChange(String(intent.amount))}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
        >
          Ekstre ({formatAmount(intent.amount)})
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onAmountValueChange(String(payableCeiling))}
        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-muted"
      >
        Tamamı ({formatAmount(payableCeiling)})
      </button>
    </div>
  ) : null

  return (
    <AccountPaymentModal
      title={modalTitleForObligation(intent)}
      open={open}
      onClose={onClose}
      accounts={accounts}
      selectedAccountId={selectedAccountId}
      onSelectedAccountChange={onSelectedAccountChange}
      amountValue={amountValue}
      onAmountValueChange={onAmountValueChange}
      amountLabel={amountLabelForObligation(intent)}
      amountActions={quickAmounts}
      accountLabel={accountLabelForObligation(intent)}
      emptyMessage={emptyAccountMessageForObligation(intent)}
      submitLabel={submitLabelForObligation(intent)}
      saving={saving}
      externalError={externalError}
      amountEditable={obligationAmountEditable(intent)}
      accountPreviewAmount={(amount) =>
        skipSourceDebit ? 0 : intent?.action === 'collect_debt' ? -amount : amount}
      extraControls={isCardPayment && smsDebitMatch ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/8 p-3 text-xs font-medium text-warning">
          <input
            type="checkbox"
            checked={skipDebitChecked}
            onChange={(event) => setSkipDebitChecked(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--warning)]"
          />
          <span>
            Bu hesapta {formatDate(smsDebitMatch.occurredAt.slice(0, 10))} tarihli aynı tutarlı SMS hareketi var
            (&quot;{smsDebitMatch.title}&quot;) — bakiye muhtemelen zaten düştü. İşaretliyken hesap bakiyesi{' '}
            <strong>tekrar düşülmez</strong>; yalnız borç/ekstre kaydı kapatılır.
          </span>
        </label>
      ) : null}
      successAction={intent?.action === 'collect_debt' || intent?.action === 'pay_card_statement'}
      info={
        intent?.action === 'pay_card_statement'
          ? 'Tam tutar girilirse ekstre kapanır ve bağlı kredi kartı taksitleri ödenmiş olur; daha az girersen kısmi ödenir, kalan ekstre borcu açık kalır.'
          : intent?.action === 'pay_card_debt'
            ? 'Ödeme önce ekstre borcundan, kalanı dönem içi harcamadan düşülür. Provizyon ve gelecek taksitler bu tutara dahil değildir.'
            : intent?.action === 'settle_debt' || intent?.action === 'collect_debt'
              ? 'Tam tutar girilirse kayıt kapanır; daha az girersen kısmi ödenir ve kalan değer açık kalır.'
              : null
      }
      validate={({ amount }) => {
        if (intent?.action === 'pay_card_debt' && exceedsTL(amount, intent.maxPayableAmount ?? intent.amount)) {
          return 'Ödeme tutarı ödenebilir kart borcundan büyük olamaz.'
        }
        if (intent?.action === 'pay_card_statement' && exceedsTL(amount, intent.maxPayableAmount ?? intent.amount)) {
          return 'Ödeme tutarı ekstrenin kalan borcundan büyük olamaz.'
        }
        if ((intent?.action === 'settle_debt' || intent?.action === 'collect_debt') && exceedsTL(amount, intent.amount)) {
          return intent.action === 'collect_debt'
            ? 'Tahsilat tutarı alacak değerinden büyük olamaz.'
            : 'Ödeme tutarı borç değerinden büyük olamaz.'
        }
        return null
      }}
      onSubmit={(payload) => onSubmit({ ...payload, skipSourceDebit })}
    >
      {detail ?? defaultPaymentDetail(intent, formatAmount)}
    </AccountPaymentModal>
  )
}
