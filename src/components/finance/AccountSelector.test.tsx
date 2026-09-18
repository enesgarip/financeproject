// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useBalancePrivacy', () => ({
  useBalancePrivacy: () => ({ formatAmount: (value: number) => `${value.toFixed(2)} TL` }),
}))

import { AccountSelector } from './AccountSelector'
import type { Card } from '../../types/database'

afterEach(cleanup)

describe('AccountSelector hesap dışı kaynak', () => {
  it('nakit seçeneğini hesap olmadan da sunar ve bakiye etkisini açıklar', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <AccountSelector
        accounts={[]}
        value=""
        onChange={onChange}
        outsideAccountsValue="outside-accounts"
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Kaynak hesap' }), {
      target: { value: 'outside-accounts' },
    })
    expect(onChange).toHaveBeenCalledWith('outside-accounts')

    rerender(
      <AccountSelector
        accounts={[]}
        value="outside-accounts"
        onChange={onChange}
        outsideAccountsValue="outside-accounts"
      />,
    )
    expect(screen.getByText(/izlenen hesap, nakit cüzdanı ve kredi kartı bakiyesi değişmez/i)).toBeTruthy()
  })

  it('banka, nakit ve kredi kartı kaynaklarını ayrı gruplar', () => {
    const base = {
      id: 'base', user_id: 'u', bank_name: 'Banka', card_name: 'Kaynak', card_type: 'banka_karti',
      holder_name: null, account_number: null, limit_group_name: null, current_balance: 100,
      credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0,
      provision_amount: 0, statement_day: null, due_day: null, note: null,
      created_at: '', updated_at: '',
    } satisfies Card
    const accounts: Card[] = [
      base,
      { ...base, id: 'cash', bank_name: 'Nakit', card_name: 'Cüzdan', account_kind: 'cash' },
      { ...base, id: 'credit', card_name: 'Kredi', card_type: 'kredi_karti', credit_limit: 1000 },
    ]

    render(<AccountSelector accounts={accounts} value="" onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Banka hesapları' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Nakit' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Kredi kartları' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /Cüzdan \(Nakit cüzdanı/i })).toBeTruthy()
  })
})
