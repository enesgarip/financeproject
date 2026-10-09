// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../types/database'
import { useCardSectionNavigation } from './CardsPage.hooks'

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
    <button onClick={navigation.backToList}>Listeye dön</button>
    <button onClick={() => navigate(-1)}>Tarayıcı geri</button>
  </>
}

afterEach(cleanup)
beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })

describe('hesap ve kart ayrıntısı navigasyonu', () => {
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
