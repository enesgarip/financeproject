import { expect, it } from 'vitest'
import { appFeatures, featureFavoritesKey, parseFeatureFavorites, searchFeatures } from './featureDiscovery'

it('Türkçe karakter ve büyük harf farklarında aynı özelliği bulur', () => {
  for (const query of ['ALTIN', 'Altın', 'altin', ' altın ']) expect(searchFeatures(query).map(feature => feature.id)).toContain('gold')
  for (const query of ['zekat', 'ZEKÂT']) expect(searchFeatures(query).map(feature => feature.id)).toContain('zakat')
  expect(searchFeatures('ISTEMCI HATASI').map(feature => feature.id)).toContain('client-errors')
})

it('özelliğin adını bilmeden amaç ve eş anlamlı kelimelerle bulunur; bütün kelimeler eşleşir', () => {
  expect(searchFeatures('her ay altin').map(feature => feature.id)).toContain('monthly-goals')
  expect(searchFeatures('findeks').map(feature => feature.id)).toContain('credit-score')
  expect(searchFeatures('para gönder').map(feature => feature.id)).toContain('transfer')
  expect(searchFeatures('aylık hedef bilinmeyenkelime')).toEqual([])
  expect(searchFeatures('Kredi notum')[0].id).toBe('credit-score')
})

it('arama boşsa bütün rehberi, bilinmeyen aramada boş sonuç döndürür', () => {
  expect(searchFeatures(' \n ')).toBe(appFeatures)
  expect(searchFeatures('xxxolmayanözellik')).toEqual([])
  expect(new Set(appFeatures.map(feature => feature.id)).size).toBe(appFeatures.length)
  expect(appFeatures.every(feature => feature.to.startsWith('/') && !feature.to.startsWith('//'))).toBe(true)
})

it('bozuk yerel favorileri reddeder, kaldırılmış özellikleri ayıklar ve tekilleştirir', () => {
  for (const value of [null, '{bozuk', '{}', 'null', '1']) expect(parseFeatureFavorites(value)).toEqual([])
  expect(parseFeatureFavorites('["gold",null,"gold",5,"removed","notifications"]')).toEqual(['gold', 'notifications'])
  expect(featureFavoritesKey('user-a')).not.toBe(featureFavoritesKey('user-b'))
})
