import type { Card } from '../types/database'

/** Favorileri öne alır; aynı favori durumundaki mevcut sıralamayı korur. */
export function favoritesFirst<T extends Pick<Card, 'is_favorite'>>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => Number(Boolean(right.row.is_favorite)) - Number(Boolean(left.row.is_favorite)) || left.index - right.index)
    .map(({ row }) => row)
}

export function favoriteAccounts(rows: readonly Card[]): Card[] {
  return rows.filter((row) => Boolean(row.is_favorite))
}
