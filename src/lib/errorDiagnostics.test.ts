import { describe, expect, it } from 'vitest'
import { diagnosticException, diagnosticRoute, diagnosticText, diagnosticUrl } from './errorDiagnostics'

describe('teşhis verisi sınırı', () => {
  it('adres sorgusunu, parolayı ve dinamik yol kimliklerini taşımaz', () => {
    expect(diagnosticUrl('https://alice:secret@example.com/rest/v1/cards?select=*&apikey=secret#token')).toBe('https://example.com/rest/v1/cards')
    expect(diagnosticRoute('/kartlar/11111111-1111-4111-8111-111111111111?amount=999')).toBe('/kartlar/:param')
    expect(diagnosticUrl('https://example.com/assets/Dashboard-abcd.js:1:99?token=abc')).toBe('https://example.com/assets/Dashboard-abcd.js:1:99')
    expect(diagnosticUrl('data:text/javascript,secret')).toBe('[data]')
  })
  it('mesajdaki yaygın sırları ve finansal tanımlayıcıları maskeler', () => {
    const text = diagnosticText('Bearer secret password=foo alice@example.com 12345678901 123,45 TL https://alice:pw@host.test/x?access_token=leak')
    for (const secret of ['secret', '=foo', 'alice', '12345678901', '123,45', 'access_token', ':pw']) expect(text).not.toContain(secret)
    expect(text).toContain('[tutar]')
    expect(diagnosticText('{"password":"leak","access_token":"token-value"} sb_secret_superprivate')).not.toMatch(/leak|token-value|superprivate/)
  })
  it('cause zincirini ve AggregateError ayrıntısını döngüye girmeden saklar', () => {
    const cause = new Error('Ağ erişimi yok')
    const error = new AggregateError([new Error('İkinci hata')], 'İşlem başarısız', { cause })
    expect(diagnosticException(error)).toMatchObject({ message: 'AggregateError: İşlem başarısız', causes: ['Error: Ağ erişimi yok', 'Error: İkinci hata'] })
    const cyclic: { message: string; cause?: unknown } = { message: 'Döngü' }
    cyclic.cause = cyclic
    expect(diagnosticException(cyclic).causes).toEqual([])
  })
  it('nesne payloadını veya hatalı getterları serileştirmez', () => {
    expect(JSON.stringify(diagnosticException({ message: 'Hata', body: { password: 'leak' }, balance: 12345 }))).not.toContain('leak')
    expect(diagnosticException({ get message() { throw new Error('getter') } }).message).toBe('Bilinmeyen hata')
    expect(diagnosticText('x'.repeat(9000), 100)).toHaveLength(100)
  })
  it('kaynak haritası için altı haneli sütunu korur, Postgres satır değerini maskeler', () => {
    expect(diagnosticText('at https://app.test/assets/a.js:1:123456')).toBe('at https://app.test/assets/a.js:1:123456')
    expect(diagnosticText('Key (title)=(Alice) already exists. Failing row contains (secret, 500)')).not.toMatch(/Alice|secret|500/)
  })
})
