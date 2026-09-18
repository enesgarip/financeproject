// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useBalancePrivacy', () => ({
  useBalancePrivacy: () => ({ formatAmount: (value: number) => `${value.toFixed(2)} TL` }),
}))

import { AccountSelector } from './AccountSelector'

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
    expect(screen.getByText(/banka hesabı bakiyesi ve kredi kartı borcu değişmez/i)).toBeTruthy()
  })
})
