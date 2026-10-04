import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { favoriteAccounts, favoritesFirst } from './accountFavorites'

function card(id: string, isFavorite = false): Card {
  return { id, is_favorite: isFavorite } as Card
}

describe('hesap ve kart favorileri', () => {
  it('favorileri öne alırken iki grubun kendi sırasını korur', () => {
    expect(favoritesFirst([card('a'), card('b', true), card('c'), card('d', true)]).map((item) => item.id))
      .toEqual(['b', 'd', 'a', 'c'])
  })

  it('yalnız favori hesap ve kartları döndürür', () => {
    expect(favoriteAccounts([card('a'), card('b', true)]).map((item) => item.id)).toEqual(['b'])
  })
})
