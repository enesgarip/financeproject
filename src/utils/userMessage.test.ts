import { describe, expect, it } from 'vitest'
import { userMessage } from './userMessage'

describe('userMessage', () => {
  it('ham SQL ayrıntısını kullanıcıya göstermez', () => {
    expect(userMessage('new row violates check constraint cars_fuel_liters_check', '23514')).toContain('Girilen değerler geçersiz')
    expect(userMessage('permission denied for table cards', '42501')).toContain('Oturumunu yenileyip')
    expect(userMessage('duplicate key value violates unique constraint', '23505')).toContain('zaten var')
  })
  it('uygulamanın açıklayıcı hata mesajını korur', () => {
    expect(userMessage('Varlıklar okunamadı; işlem iptal edildi.', '42501')).toBe('Varlıklar okunamadı; işlem iptal edildi.')
  })
  it('ağ hatasını ve boş hatayı eyleme dönük gösterir', () => {
    expect(userMessage('Failed to fetch')).toContain('Bağlantını kontrol')
    expect(userMessage(undefined, undefined, 'Yeniden dene.')).toBe('Yeniden dene.')
  })
})
