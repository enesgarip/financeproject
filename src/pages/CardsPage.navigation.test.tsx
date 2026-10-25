// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../types/database'
import { useCardSectionNavigation } from './CardsPage.hooks'
import { CardSectionNav } from './CardsPage.sections'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
const account = { id: 'account-1', card_type: 'banka_karti' } as Card
const credit = { id: 'credit-1', card_type: 'kredi_karti' } as Card

function Harness() {
  const navigation = useCardSectionNavigation()
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output aria-label="Adres">{location.search}</output>
    <output aria-label="Seçim">{navigation.section}:{navigation.selectedCardId}:{navigation.panel}</output>
    <button onClick={() => navigation.openCardDetails(account)}>Hesap aç</button>
    <button onClick={() => navigation.openCardDetails(credit)}>Kart aç</button>
    <button onClick={() => navigation.openPanel('taksitler')}>Taksit göster</button>
    <button onClick={() => navigation.openPanel('provizyon')}>Provizyon göster</button>
    <button onClick={() => navigation.openPanel('manuel')}>Harcama ekle</button>
    <button onClick={navigation.backToList}>Listeye dön</button>
    <button onClick={() => navigate(-1)}>Tarayıcı geri</button>
    {navigation.panel ? <section id="kart-bilgi-dokumu">{navigation.panel}</section> : null}
  </>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })

describe('hesap ve kart ayrıntısı navigasyonu', () => {
  it.each([false, true])('dokunulan dökümü görünür konuma kaydırır; hareketi azalt tercihi: %s', (reducedMotion) => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reducedMotion } as MediaQueryList)
    render(<MemoryRouter initialEntries={['/kartlar?section=kartlar']}><Harness /></MemoryRouter>)
    expect(scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Taksit göster'))
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('kart-bilgi-dokumu'))
    fireEvent.click(screen.getByText('Provizyon göster'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Provizyon göster'))
    expect(document.getElementById('kart-bilgi-dokumu')).toBeNull()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Harcama ekle'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('doğrudan döküm bağlantısını açarken veya kapatırken konumu değiştirmez', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(<MemoryRouter initialEntries={['/kartlar?section=kartlar&panel=taksitler']}><Harness /></MemoryRouter>)
    expect(document.getElementById('kart-bilgi-dokumu')).not.toBeNull()
    fireEvent.click(screen.getByText('Taksit göster'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it.each(['/kartlar', '/kartlar?section=bilinmeyen'])('varsayılan olarak hesapları açar: %s', (url) => {
    render(<MemoryRouter initialEntries={[url]}><Harness /></MemoryRouter>)
    expect(screen.getByLabelText('Seçim').textContent).toBe('hesaplar::')
  })

  it.each(['kartlar', 'ozet', 'islemler'])('açık ve eski kredi kartı bağlantısını korur: %s', (section) => {
    render(<MemoryRouter initialEntries={[`/kartlar?section=${section}`]}><Harness /></MemoryRouter>)
    expect(screen.getByLabelText('Seçim').textContent).toBe(`kartlar::${section === 'islemler' ? 'donem' : ''}`)
  })

  it('hesap ayrıntısından döndüğünde bölüm, URL ve kaydırma konumunu korur', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 420 })
    render(<MemoryRouter initialEntries={['/kartlar?section=hesaplar']}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByText('Hesap aç'))
    expect(screen.getByLabelText('Seçim').textContent).toBe('hesaplar:account-1:')
    fireEvent.click(screen.getByText('Taksit göster'))
    fireEvent.click(screen.getByText('Listeye dön'))
    expect(screen.getByLabelText('Adres').textContent).toBe('?section=hesaplar')
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'instant' })
  })

  it('tarayıcı geri düğmesi kart ayrıntısını kapatır; döküm değişikliği ayrı geçmiş oluşturmaz', () => {
    render(<MemoryRouter initialEntries={['/kartlar']}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByText('Kart aç'))
    fireEvent.click(screen.getByText('Taksit göster'))
    expect(screen.getByLabelText('Seçim').textContent).toBe('kartlar:credit-1:taksitler')
    fireEvent.click(screen.getByText('Tarayıcı geri'))
    expect(screen.getByLabelText('Adres').textContent).toBe('')
  })

  it('doğrudan ayrıntı bağlantısından aynı bölümün listesine döner', () => {
    render(<MemoryRouter initialEntries={['/kartlar?section=hesaplar&card=account-1']}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByText('Listeye dön'))
    expect(screen.getByLabelText('Adres').textContent).toBe('?section=hesaplar')
  })

  it('eski ekstre bağlantısını menü sekmesi oluşturmadan döküme yönlendirir', () => {
    render(<MemoryRouter initialEntries={['/kartlar?section=ekstreler']}><Harness /></MemoryRouter>)
    expect(screen.getByLabelText('Seçim').textContent).toBe('kartlar::ekstreler')
  })
})


it('hesaplar seçimini ilk sırada gösterir ve kredi kartlarına geçiş sağlar', () => {
  const onSelect = vi.fn()
  render(<CardSectionNav section="hesaplar" onSelect={onSelect} counts={{ hesaplar: 2, kartlar: 3 }} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons[0].textContent).toContain('Hesaplar ve nakit')
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
  expect(buttons[1].textContent).toContain('Kredi kartları')
  fireEvent.click(buttons[1])
  expect(onSelect).toHaveBeenCalledWith('kartlar')
})
