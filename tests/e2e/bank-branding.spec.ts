import { expect, test } from '@playwright/test'
import { bankBrandGradient, getBankBrand } from '../../src/utils/bankBranding'

test('known Turkish banks resolve to a matched brand with a short code', () => {
  const garanti = getBankBrand('Garanti BBVA')
  expect(garanti.matched).toBe(true)
  expect(garanti.code).toBe('GA')

  const akbank = getBankBrand('akbank axess')
  expect(akbank.matched).toBe(true)
  expect(akbank.code).toBe('AK')

  // Eşleşme normalize edilmiş (büyük/küçük harf duyarsız) çalışmalı.
  expect(getBankBrand('İŞ BANKASI').code).toBe('İŞ')
  expect(getBankBrand('Yapı Kredi').code).toBe('YK')
})

test('unknown banks fall back to a generated, deterministic monogram', () => {
  const brand = getBankBrand('Acme Test Bankası')
  expect(brand.matched).toBe(false)
  expect(brand.code).toBe('AT')
  // Aynı girdi her zaman aynı rengi vermeli (deterministik).
  expect(getBankBrand('Acme Test Bankası').color).toBe(brand.color)
})

test('empty bank name produces a safe placeholder badge', () => {
  const brand = getBankBrand('')
  expect(brand.matched).toBe(false)
  expect(brand.code).toBe('₺')
})

test('brand gradient is a usable CSS background image string', () => {
  const gradient = bankBrandGradient('Garanti')
  expect(gradient.startsWith('linear-gradient(')).toBe(true)
  expect(gradient).toContain('#')
})
