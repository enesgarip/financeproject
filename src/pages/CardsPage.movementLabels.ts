import type { Card } from '../types/database'

export function transferActionLabel(source: Card | null, target?: Card) {
  if (!source || !target) return 'Para aktar'
  if (source.account_kind !== 'cash' && target.account_kind === 'cash') return 'Nakit çek'
  if (source.account_kind === 'cash' && target.account_kind !== 'cash') return 'Bankaya yatır'
  return 'Para aktar'
}
