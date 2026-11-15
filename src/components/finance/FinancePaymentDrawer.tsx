import { useEffect, useState, type ReactNode } from 'react'
import {
  accountLabelForObligation,
  amountLabelForObligation,
  emptyAccountMessageForObligation,
  estimatedMinimumCardPayment,
  findRecentSmsAccountMovement,
  modalTitleForObligation,
  obligationAmountEditable,
  submitLabelForObligation,
  type RecentSmsAccountMovement,
} from '../../services/financePaymentActions'
import { obligationSupportsPaidAt } from '../../services/financePaymentActions'
import type { Card } from '../../types/database'
import { formatDate } from '../../utils/date'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { parseNumber } from '../../utils/formatCurrency'
import { exceedsTL } from '../../utils/money'
import type { FinanceObligation } from '../../utils/obligations'
import { AccountPaymentModal } from './AccountPaymentModal'

type AccountPaymentSubmit = {
  account: Card | null
  amount: number
  skipSourceDebit?: boolean
  smsMovementId?: string
  paidAt?: string
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
  uncertain?: boolean
  pendingSkipSourceDebit?: boolean
  pendingSmsMovementId?: string
  externalError?: string
  detail?: ReactNode
}

function defaultPaymentDetail(intent: FinanceObligation | null, formatAmount: (value: number | null | undefined) => string) {
  if (!intent) return null

  return (
    <>
      <p className="font-semibold text-ink">{intent.title}</p>
      <p className="mt-0.5">{intent.subtitle}</p>
      <p className="mt-0.5">Tarih: {formatDate(intent.date)}</p>
      <p className="mt-0.5">
        {intent.action === 'settle_debt' || intent.action === 'collect_debt' || intent.action === 'pay_card_statement' ? 'Güncel kalan:' : 'Planlanan tutar:'}{' '}
        <span className="font-mono font-semibold text-ink">{formatAmount(intent.amount)}</span>
      </p>
    </>
  )
}

export function FinancePaymentDrawer(props: FinancePaymentDrawerProps) {
  if (!props.open) return null
  return <PaymentDrawer key={props.intent?.id} {...props} />
}

function PaymentDrawer({
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
  uncertain = false,
  pendingSkipSourceDebit,
  pendingSmsMovementId,
  externalError = '',
  detail,
}: FinancePaymentDrawerProps) {
  const { formatAmount } = useBalancePrivacy()
  const outsideAccountsValue = intent?.action === 'pay_payment' ? 'outside-accounts' : undefined
  // Asgari yalnız EKSTRE kovası üzerinden (K7): bankada dönem içi harcamanın
  // asgarisi olmaz. Taban 0 ise (salt dönem içi borç) ipucu hiç gösterilmez.
  // K7: ekstre de kısmi/asgari ödenebilir; iki kart akışında da taban ekstre kovası.
  const minimumPayment =
    intent?.action === 'pay_card_debt' || intent?.action === 'pay_card_statement'
      ? estimatedMinimumCardPayment(intent.minimumPaymentBase ?? 0, intent.minimumPaymentRate)
      : 0
  // B4: seçili hesapta son 3 günde aynı tutarlı SMS kaynaklı çıkış varsa bakiye
  // muhtemelen zaten düşmüş demektir; kullanıcıya "tekrar düşme" seçeneği sunulur.
  // Sonuç, sorgulandığı (hesap, tutar) anahtarıyla saklanır; anahtar değişince
  // eski sonuç render'da geçersiz sayılır (effect'te senkron temizlik gerekmez).
  const isCardPayment = intent?.action === 'pay_card_debt' || intent?.action === 'pay_card_statement'
  const isPersonalDebt = intent?.action === 'collect_debt' || intent?.action === 'settle_debt'
  const smsDirection: 'in' | 'out' = intent?.action === 'collect_debt' ? 'in' : 'out'
  const [applyAccountMovement, setApplyAccountMovement] = useState(false)
  // Önceki sürümden kalan belirsiz SMS isteği aynı makbuzla doğrulanır.
  const useRecordedMovement = Boolean(pendingSmsMovementId)
  const [smsDebit, setSmsDebit] = useState<{ key: string; match: RecentSmsAccountMovement | null }>({ key: '', match: null })
  const [skipDebitChecked, setSkipDebitChecked] = useState(true)
  const parsedAmount = parseNumber(amountValue)
  const smsDebitKey = open && !useRecordedMovement && isCardPayment && selectedAccountId && parsedAmount > 0
    ? `${selectedAccountId}:${parsedAmount}:${smsDirection}`
    : ''

  useEffect(() => {
    if (!smsDebitKey) return

    let cancelled = false
    const [accountId, rawAmount, direction] = smsDebitKey.split(':')
    void findRecentSmsAccountMovement(accountId, Number(rawAmount), direction === 'in' ? 'in' : 'out').then((match) => {
      if (cancelled) return
      setSmsDebit({ key: smsDebitKey, match })
      if (match) setSkipDebitChecked(true)
    })
    return () => {
      cancelled = true
    }
  }, [smsDebitKey])

  const smsDebitMatch = smsDebitKey && smsDebit.key === smsDebitKey ? smsDebit.match : null
  const skipSourceDebit = uncertain ? Boolean(pendingSkipSourceDebit) : isPersonalDebt ? !applyAccountMovement : Boolean(smsDebitMatch && skipDebitChecked)
  const movementControl = useRecordedMovement
    ? <p className="text-sm text-ink-muted">Seçtiğin SMS hareketine ait kayıt doğrulanacak.</p>
    : undefined

  // Tavan, nominal tutardan büyük olabilir: ekstre kalemi "planlanan" ekstre
  // borcunu gösterir ama pay_card_debt dönem içini de kapatabilir (B7).
  const payableCeiling = intent ? intent.maxPayableAmount ?? intent.amount : 0
  const quickAmounts = isCardPayment && intent ? (
    <div className="flex flex-wrap gap-2">
      {minimumPayment > 0 ? (
        <button
          type="button"
          onClick={() => onAmountValueChange(String(minimumPayment))}
          className="rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04]"
        >
          Tahmini asgari tutar ({formatAmount(minimumPayment)})
        </button>
      ) : null}
      {exceedsTL(payableCeiling, intent.amount) && exceedsTL(intent.amount, 0) ? (
        <button
          type="button"
          onClick={() => onAmountValueChange(String(intent.amount))}
          className="rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04]"
        >
          Ekstre ({formatAmount(intent.amount)})
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onAmountValueChange(String(payableCeiling))}
        className="rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04]"
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
      outsideAccountsValue={outsideAccountsValue}
      submitLabel={uncertain ? 'Sonucu doğrula' : submitLabelForObligation(intent)}
      saving={saving}
      confirming={uncertain}
      externalError={externalError}
      amountEditable={obligationAmountEditable(intent)}
      paymentMethodControl={isPersonalDebt && !uncertain ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-line-strong bg-page p-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={applyAccountMovement}
            onChange={(event) => setApplyAccountMovement(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span>
            <span className="font-semibold">Hesap bakiyesine işle</span>
            <span className="mt-1 block text-xs text-ink-muted">İşaretli değilse yalnız borç/alacak kaydı güncellenir; hesap bakiyesi ve hesap hareketleri değişmez. SMS otomasyonu işlemi zaten kaydettiyse boş bırak.</span>
          </span>
        </label>
      ) : null}
      recordedMovementControl={movementControl}
      accountSelectionRequired={!isPersonalDebt || !skipSourceDebit}
      accountPreviewAmount={(amount) =>
        skipSourceDebit ? 0 : intent?.action === 'collect_debt' ? -amount : amount}
      extraControls={!uncertain && smsDebitMatch ? (
        <label className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/8 p-3 text-xs font-medium text-warning">
          <input
            type="checkbox"
            checked={skipDebitChecked}
            onChange={(event) => setSkipDebitChecked(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--warning)]"
          />
          <span>
            Bu hesapta {formatDate(smsDebitMatch.occurredAt.slice(0, 10))} tarihli aynı tutarlı SMS hareketi var
            (&quot;{smsDebitMatch.title}&quot;) — bakiye muhtemelen zaten {smsDirection === 'in' ? 'arttı' : 'düştü'}. İşaretliyken hesap bakiyesi{' '}
            <strong>{smsDirection === 'in' ? 'tekrar artırılmaz' : 'tekrar düşülmez'}</strong>; yalnız borç/ekstre kaydı kapatılır.
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
              ? <>{skipSourceDebit ? 'Hesap bakiyesi ve hesap hareketleri değişmez. ' : null}Tam tutarda kayıt kapanır, kısmi tutarda kalan açık kalır.</>
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
      onSubmit={(payload) => onSubmit({ ...payload, skipSourceDebit, smsMovementId: pendingSmsMovementId })}
      paidAtEditable={obligationSupportsPaidAt(intent)}
    >
      {detail ?? defaultPaymentDetail(intent, formatAmount)}
    </AccountPaymentModal>
  )
}
