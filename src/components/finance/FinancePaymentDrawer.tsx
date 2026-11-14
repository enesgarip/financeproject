import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { fetchPersonalDebtSmsMovements } from '../../data/repositories/linkedWorkflowsRepo'
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
import { dateInputValue, formatDate } from '../../utils/date'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { parseNumber } from '../../utils/formatCurrency'
import { exceedsTL, greaterThanTL, roundTL } from '../../utils/money'
import type { FinanceObligation } from '../../utils/obligations'
import { AccountPaymentModal } from './AccountPaymentModal'
import { Select } from '../ui/input'
import { QueryError } from '../ui/query-error'

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
  pendingSmsMovementId,
  externalError = '',
  detail,
}: FinancePaymentDrawerProps) {
  const { formatAmount, maskText } = useBalancePrivacy()
  const { user } = useAuth()
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
  // Kişisel alacak/borç da aynı tuzağa düşer: gelen FAST SMS'i bakiyeyi
  // artırdıktan sonra "Tahsil et" ikinci kez ekliyordu. Yön alacakta giriş.
  const isPersonalDebt = intent?.action === 'collect_debt' || intent?.action === 'settle_debt'
  const smsDirection: 'in' | 'out' = intent?.action === 'collect_debt' ? 'in' : 'out'
  const supportsSmsLink = isPersonalDebt && intent?.debtValueType === 'TRY'
  const [useSms, setUseSms] = useState(false)
  const [smsMovementId, setSmsMovementId] = useState('')
  const useRecordedMovement = Boolean(pendingSmsMovementId) || (supportsSmsLink && useSms)
  const debtId = intent?.sourceId ?? ''
  const smsMovements = useQuery({
    queryKey: ['personal-debt-sms', user?.id, debtId],
    enabled: Boolean(user && debtId && useRecordedMovement && !uncertain),
    queryFn: async () => {
      const result = await fetchPersonalDebtSmsMovements(debtId)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })
  const selectedMovement = smsMovements.data?.find((movement) => movement.id === smsMovementId)
  const [smsDebit, setSmsDebit] = useState<{ key: string; match: RecentSmsAccountMovement | null }>({ key: '', match: null })
  const [skipDebitChecked, setSkipDebitChecked] = useState(true)
  const parsedAmount = parseNumber(amountValue)
  const smsDebitKey = open && !useRecordedMovement && (isCardPayment || isPersonalDebt) && selectedAccountId && parsedAmount > 0
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
  const skipSourceDebit = Boolean(!supportsSmsLink && smsDebitMatch && skipDebitChecked)

  function changePaymentMethod(sms: boolean) {
    setUseSms(sms)
    setSmsMovementId('')
    if (intent) onAmountValueChange(sms ? '' : String(intent.amount))
  }

  let movementControl: ReactNode
  if (useRecordedMovement) {
    if (pendingSmsMovementId && uncertain) {
      movementControl = <p className="text-sm text-ink-muted">Seçtiğin SMS hareketine ait kayıt doğrulanacak.</p>
    } else if (smsMovements.isPending) {
      movementControl = <p role="status" className="text-sm text-ink-muted">SMS hareketleri yükleniyor…</p>
    } else if (smsMovements.isError) {
      movementControl = <QueryError title="SMS hareketleri yüklenemedi" message={smsMovements.error.message} onRetry={() => void smsMovements.refetch()} />
    } else if (smsMovements.data.length === 0) {
      movementControl = <p className="text-sm text-ink-muted">Bu kayıt için bağlanabilecek SMS hareketi bulunamadı.</p>
    } else {
      movementControl = (
        <div>
          <label className="block text-sm font-semibold text-ink">
            SMS hareketi
            <Select required className="mt-1" value={selectedMovement?.id ?? ''} onChange={(event) => {
              const movement = smsMovements.data.find((item) => item.id === event.target.value)
              setSmsMovementId(event.target.value)
              onAmountValueChange(movement && intent ? String(roundTL(Math.min(movement.amount, intent.amount))) : '')
            }}>
              <option value="">Hareket seç</option>
              {smsMovements.data.map((movement) => (
                <option key={movement.id} value={movement.id}>
                  {formatDate(dateInputValue(new Date(movement.occurred_at)))} · {maskText(movement.account_name)} · {formatAmount(movement.amount)} · {maskText(movement.title)}
                </option>
              ))}
            </Select>
          </label>
          {selectedMovement ? <p className="mt-2 break-words text-xs text-ink-muted">
            {formatDate(dateInputValue(new Date(selectedMovement.occurred_at)))} · {maskText(selectedMovement.title)} · {maskText(selectedMovement.account_name)} · {formatAmount(selectedMovement.amount)}
          </p> : null}
        </div>
      )
    }
  }
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
      paymentMethodControl={supportsSmsLink && !uncertain ? (
        <label className="block text-sm font-semibold text-ink">
          Kayıt yöntemi
          <Select className="mt-1" value={useSms ? 'sms' : 'account'} onChange={(event) => changePaymentMethod(event.target.value === 'sms')}>
            <option value="account">Hesap bakiyesine işle</option>
            <option value="sms">SMS hareketine bağla</option>
          </Select>
        </label>
      ) : null}
      recordedMovementControl={movementControl}
      submitDisabled={useRecordedMovement && !uncertain && (!selectedMovement || smsMovements.isError)}
      accountPreviewAmount={(amount) =>
        skipSourceDebit ? 0 : intent?.action === 'collect_debt' ? -amount : amount}
      extraControls={!uncertain && smsDebitMatch && supportsSmsLink ? (
        <div className="rounded-xl border border-warning/25 bg-warning/8 p-3 text-xs text-warning">
          Bu hesapta aynı tutarda bir SMS hareketi var. Ödeme veya tahsilat o harekete aitse <strong>SMS hareketine bağla</strong> yöntemini seç.
        </div>
      ) : !uncertain && smsDebitMatch ? (
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
            <strong>{smsDirection === 'in' ? 'tekrar artırılmaz' : 'tekrar düşülmez'}</strong>; yalnız {isPersonalDebt ? 'kişisel kayıt' : 'borç/ekstre kaydı'} kapatılır.
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
              ? <>{useRecordedMovement ? 'Seçilen SMS hareketi hesaba zaten işlendi. Bu kayıtla hesap bakiyesi aynı kalır. ' : null}Tam tutarda kayıt kapanır, kısmi tutarda kalan açık kalır.</>
              : null
      }
      validate={({ amount }) => {
        if (useRecordedMovement && intent) {
          if (!selectedMovement || greaterThanTL(amount, selectedMovement.amount)) return 'Tutar seçilen SMS hareketini aşamaz.'
          if (greaterThanTL(amount, intent.amount)) return 'Tutar kalan borç veya alacağı aşamaz.'
        }
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
      onSubmit={(payload) => onSubmit({ ...payload, skipSourceDebit, smsMovementId: useRecordedMovement ? selectedMovement?.id : undefined })}
      paidAtEditable={obligationSupportsPaidAt(intent)}
    >
      {detail ?? defaultPaymentDetail(intent, formatAmount)}
    </AccountPaymentModal>
  )
}
