import type { ReactNode } from 'react'
import {
  accountLabelForObligation,
  amountLabelForObligation,
  emptyAccountMessageForObligation,
  modalTitleForObligation,
  obligationAmountEditable,
  submitLabelForObligation,
} from '../../services/financePaymentActions'
import type { Card } from '../../types/database'
import { formatDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { exceedsTL } from '../../utils/money'
import type { FinanceObligation } from '../../utils/obligations'
import { AccountPaymentModal } from './AccountPaymentModal'

type AccountPaymentSubmit = {
  account: Card
  amount: number
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

function defaultPaymentDetail(intent: FinanceObligation | null) {
  if (!intent) return null

  return (
    <>
      <p className="font-semibold text-foreground">{intent.title}</p>
      <p className="mt-0.5">{intent.subtitle}</p>
      <p className="mt-0.5">Tarih: {formatDate(intent.date)}</p>
      <p className="mt-0.5">
        Planlanan tutar:{' '}
        <span className="font-mono font-semibold text-foreground">{formatCurrency(intent.amount)}</span>
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
      accountLabel={accountLabelForObligation(intent)}
      emptyMessage={emptyAccountMessageForObligation(intent)}
      submitLabel={submitLabelForObligation(intent)}
      saving={saving}
      externalError={externalError}
      amountEditable={obligationAmountEditable(intent)}
      accountPreviewAmount={(amount) => intent?.action === 'collect_debt' ? -amount : amount}
      successAction={intent?.action === 'collect_debt' || intent?.action === 'pay_card_statement'}
      info={intent?.action === 'pay_card_statement' ? 'Bu ekstre kapandığında ekstreye bağlı kredi kartı taksitleri otomatik ödenmiş olur.' : null}
      validate={({ amount }) => {
        if (intent?.action === 'pay_card_debt' && exceedsTL(amount, intent.amount)) {
          return 'Ödeme tutarı ödenebilir kart borcundan büyük olamaz.'
        }
        return null
      }}
      onSubmit={onSubmit}
    >
      {detail ?? defaultPaymentDetail(intent)}
    </AccountPaymentModal>
  )
}
