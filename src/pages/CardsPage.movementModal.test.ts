import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { transferActionLabel } from './CardsPage.movementLabels'

function account(accountKind: 'bank' | 'cash'): Card {
  return { account_kind: accountKind } as Card
}

describe('transferActionLabel', () => {
  it('adlandırır banka hesabından nakit cüzdanına aktarımı nakit çekme olarak', () => {
    expect(transferActionLabel(account('bank'), account('cash'))).toBe('Nakit çek')
  })

  it('adlandırır nakit cüzdanından banka hesabına aktarımı yatırma olarak', () => {
    expect(transferActionLabel(account('cash'), account('bank'))).toBe('Bankaya yatır')
  })

  it('diğer hesap aktarımlarında genel etiketi korur', () => {
    expect(transferActionLabel(account('bank'), account('bank'))).toBe('Para aktar')
    expect(transferActionLabel(account('cash'), account('cash'))).toBe('Para aktar')
  })
})
