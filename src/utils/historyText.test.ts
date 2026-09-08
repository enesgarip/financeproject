import { describe, expect, it } from 'vitest'
import { turkishizeHistoryText } from './historyText'

describe('turkishizeHistoryText', () => {
  it('SQL geçmiş notlarındaki ASCII kelimeleri Türkçeleştirir', () => {
    expect(turkishizeHistoryText('Araç kasko yenileme odendi')).toBe('Araç kasko yenileme ödendi')
    expect(turkishizeHistoryText('Bonus Gold kredi kartina harcama olarak islendi. Vade: 2026-09-28')).toBe(
      'Bonus Gold kredi kartına harcama olarak işlendi. Vade: 2026-09-28',
    )
    expect(turkishizeHistoryText('Birikim hesabindan Vadesiz TL hesabina aktarildi.')).toBe(
      'Birikim hesabından Vadesiz TL hesabına aktarıldı.',
    )
    expect(turkishizeHistoryText('Pesin kart harcamasi.')).toBe('Peşin kart harcaması.')
  })

  it('bilinmeyen kelimeye ve zaten Türkçe metne dokunmaz; boşu boş döner', () => {
    expect(turkishizeHistoryText('MIGROS ATASEHIR')).toBe('MIGROS ATASEHIR')
    expect(turkishizeHistoryText('Bonus Gold ekstresi ödendi')).toBe('Bonus Gold ekstresi ödendi')
    expect(turkishizeHistoryText(null)).toBe('')
  })
})
