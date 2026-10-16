// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import type { PersonalTrackingEntry } from '../../types/database'
import { PersonalTrackingPanel } from './PersonalTrackingPanel'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), remove: vi.fn() }))
vi.mock('../../data/repositories/crudRepo', () => ({
  fetchCrudRows: mocks.fetch, saveCrudRow: mocks.save, deleteCrudRow: mocks.remove,
}))
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const entry: PersonalTrackingEntry = {
  id: 'track-1', user_id: 'user-1', created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  person_name: 'Kardeşim', amount: 2500.25, occurred_on: '2026-10-13', note: 'Tamir',
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <BalancePrivacyProvider><PersonalTrackingPanel /></BalancePrivacyProvider>
  </MemoryRouter></QueryClientProvider>)
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.fetch.mockResolvedValue({ ok: true, data: [] })
  mocks.save.mockResolvedValue({ ok: true, data: entry })
  mocks.remove.mockResolvedValue({ ok: true, data: undefined })
})

describe('Sadece takip formu ve listesi', () => {
  it('ekleme, düzenleme ve silme sonrası kişi toplamını yeniler; yalnız takip tablosuna yazar', async () => {
    mount()
    await screen.findByText('Henüz takip kaydı yok')
    fireEvent.click(screen.getAllByRole('button', { name: 'Takip kaydı ekle' })[0])
    fireEvent.change(screen.getByLabelText(/^Kişi/), { target: { value: ' Kardeşim ' } })
    fireEvent.change(screen.getByLabelText(/^Tutar/), { target: { value: '2500.25' } })
    fireEvent.change(screen.getByLabelText(/^Tarih/), { target: { value: '2026-10-13' } })
    fireEvent.change(screen.getByLabelText('Açıklama'), { target: { value: ' Tamir ' } })
    mocks.fetch.mockResolvedValue({ ok: true, data: [entry] })
    fireEvent.submit(screen.getByRole('button', { name: 'Kaydet' }).closest('form')!)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('personal_tracking_entries', {
      user_id: 'user-1', person_name: 'Kardeşim', amount: 2500.25, occurred_on: '2026-10-13', note: 'Tamir',
    }, null))
    await screen.findByText('Kişi başına toplam · sadece takip')
    expect(screen.getByText('2.500,25 ₺', { selector: 'dd' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Tahsilat kaydet|Ödeme kaydet|1 ay ertele/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Kardeşim işlemleri' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Düzenle' }))
    expect((screen.getByLabelText('Açıklama') as HTMLTextAreaElement).value).toBe('Tamir')
    fireEvent.change(screen.getByLabelText(/^Tutar/), { target: { value: '3000.50' } })
    mocks.fetch.mockResolvedValue({ ok: true, data: [{ ...entry, amount: 3000.5 }] })
    fireEvent.submit(screen.getByRole('button', { name: 'Kaydet' }).closest('form')!)
    await screen.findByText('3.000,50 ₺', { selector: 'dd' })
    expect(mocks.save).toHaveBeenLastCalledWith('personal_tracking_entries', expect.objectContaining({ amount: 3000.5 }), entry.id)

    fireEvent.click(screen.getByRole('button', { name: 'Kardeşim işlemleri' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sil' }))
    mocks.fetch.mockResolvedValue({ ok: true, data: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await screen.findByText('Henüz takip kaydı yok')
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('personal_tracking_entries', entry.id)
    expect(mocks.fetch.mock.calls.every(([table]) => table === 'personal_tracking_entries')).toBe(true)
  })

  it('boş ad ve sıfır tutarı kaydetmez', async () => {
    mount()
    await screen.findByText('Henüz takip kaydı yok')
    fireEvent.click(screen.getAllByRole('button', { name: 'Takip kaydı ekle' })[0])
    fireEvent.change(screen.getByLabelText(/^Kişi/), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/^Tutar/), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Kaydet' }).closest('form')!)
    expect(await screen.findByText('Kişi adını yaz.')).toBeTruthy()
    expect(screen.getByText('Sıfırdan büyük bir tutar gir.')).toBeTruthy()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('gizlilik modunda hem kayıt tutarını hem kişi toplamını maskeler', async () => {
    window.localStorage.setItem('financeproject.balancePrivacy', 'hidden')
    mocks.fetch.mockResolvedValue({ ok: true, data: [entry] })
    mount()
    await screen.findByText('Kişi başına toplam · sadece takip')
    expect(screen.getByText('••••', { selector: 'dd' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('2.500,25')
  })
})
