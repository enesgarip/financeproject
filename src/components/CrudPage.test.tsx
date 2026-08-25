// @vitest-environment happy-dom
//
// CrudPage'in TanStack sözleşmesi: liste cache'ten gelir (navigasyonlar arası
// skeleton yok), `reload` helper'ı invalidate+refetch'tir, kayıt sonrası liste
// tazelenir, silme satırı ANINDA düşürür + arka planda tazeler, yükleme hatası
// Alert'e düşer, afterSave hatası modalı açık tutar.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SalaryHistory } from '../types/database'
import { CrudPage } from './CrudPage'

const mocks = vi.hoisted(() => ({
  fetchCrudRows: vi.fn(),
  saveCrudRow: vi.fn(),
  deleteCrudRow: vi.fn(),
}))

vi.mock('../data/repositories/crudRepo', () => ({
  fetchCrudRows: mocks.fetchCrudRows,
  saveCrudRow: mocks.saveCrudRow,
  deleteCrudRow: mocks.deleteCrudRow,
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

afterEach(cleanup)

function salaryRow(id: string, title: string): Partial<SalaryHistory> {
  return { id, title, amount: 100, effective_date: '2026-08-01', note: null, created_at: '2026-08-25T00:00:00Z' }
}

function makeClient() {
  // staleTime Infinity: cache'ten okumayı deterministik kanıtlamak için.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
}

function renderCrud(client: QueryClient, extraProps: Record<string, unknown> = {}) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CrudPage
          table="salary_history"
          addLabel="Kayıt ekle"
          fields={[{ name: 'title', label: 'Başlık', type: 'text' }]}
          emptyTitle="Henüz kayıt yok"
          emptyDescription="Ekle"
          getInitialValues={() => ({ title: '' })}
          mapForm={() => ({ user_id: 'user-1', title: 'Yeni kayıt', amount: 5 }) as never}
          renderTitle={(row) => (row as SalaryHistory).title}
          renderDetails={() => []}
          {...extraProps}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CrudPage — TanStack veri sözleşmesi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchCrudRows.mockResolvedValue({ ok: true, data: [salaryRow('r1', 'Maaş kaydı')] })
    mocks.saveCrudRow.mockResolvedValue({ ok: true, data: salaryRow('r2', 'Yeni kayıt') })
    mocks.deleteCrudRow.mockResolvedValue({ ok: true, data: undefined })
  })

  it('listeyi sorgudan çizer; ikinci mount cache’ten anında gelir (tek fetch)', async () => {
    const client = makeClient()
    const first = renderCrud(client)
    expect(await screen.findByText('Maaş kaydı')).toBeTruthy()
    expect(mocks.fetchCrudRows).toHaveBeenCalledExactlyOnceWith('salary_history', 'created_at', false)
    first.unmount()

    renderCrud(client)
    // Cache'ten senkron render: skeleton'a düşmeden satır hemen var.
    expect(screen.getByText('Maaş kaydı')).toBeTruthy()
    expect(mocks.fetchCrudRows).toHaveBeenCalledOnce()
  })

  it('helpers.reload invalidate+refetch yapar ve refetch bitince çözülür', async () => {
    const client = makeClient()
    let reloadFn: (() => Promise<void>) | null = null
    renderCrud(client, {
      renderBeforeList: ({ reload }: { reload: () => Promise<void> }) => {
        reloadFn = reload
        return null
      },
    })
    await screen.findByText('Maaş kaydı')

    mocks.fetchCrudRows.mockResolvedValue({ ok: true, data: [salaryRow('r1', 'Güncel kayıt')] })
    await reloadFn!()
    expect(mocks.fetchCrudRows).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByText('Güncel kayıt')).toBeTruthy())
  })

  it('kaydet: saveCrudRow → modal kapanır → liste tazelenir', async () => {
    const client = makeClient()
    renderCrud(client)
    await screen.findByText('Maaş kaydı')

    fireEvent.click(screen.getAllByRole('button', { name: 'Kayıt ekle' })[0])
    fireEvent.submit(screen.getByRole('button', { name: 'Kaydet' }).closest('form')!)

    await waitFor(() => expect(mocks.saveCrudRow).toHaveBeenCalledOnce())
    expect(mocks.saveCrudRow.mock.calls[0][0]).toBe('salary_history')
    await waitFor(() => expect(mocks.fetchCrudRows).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Yeni kayıt bilgileri')).toBeNull()
  })

  it('afterSave hatası modalı açık tutar ve mesajı gösterir', async () => {
    const client = makeClient()
    renderCrud(client, {
      afterSave: () => {
        throw new Error('Takip işlemi patladı')
      },
    })
    await screen.findByText('Maaş kaydı')

    fireEvent.click(screen.getAllByRole('button', { name: 'Kayıt ekle' })[0])
    fireEvent.submit(screen.getByRole('button', { name: 'Kaydet' }).closest('form')!)

    expect(await screen.findByText('Takip işlemi patladı')).toBeTruthy()
    expect(screen.getByText('Yeni kayıt bilgileri')).toBeTruthy()
  })

  it('sil: satır anında düşer, deleteCrudRow çağrılır, arka plan refetch gelir', async () => {
    const client = makeClient()
    renderCrud(client)
    await screen.findByText('Maaş kaydı')

    // Arka plan refetch'i silinmiş durumu döndürsün (gerçekte DB'den düşmüştür).
    mocks.fetchCrudRows.mockResolvedValue({ ok: true, data: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Maaş kaydı işlemleri' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sil' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))

    await waitFor(() => expect(mocks.deleteCrudRow).toHaveBeenCalledExactlyOnceWith('salary_history', 'r1'))
    await waitFor(() => expect(screen.queryByText('Maaş kaydı')).toBeNull())
    // Eski desenin aksine silme de listeyi tazeler (türetilmiş veri bayatlamaz).
    await waitFor(() => expect(mocks.fetchCrudRows).toHaveBeenCalledTimes(2))
  })

  it('yükleme hatası Alert olarak görünür', async () => {
    mocks.fetchCrudRows.mockResolvedValue({ ok: false, error: { message: 'Kayıtlar yüklenemedi: RLS' } })
    renderCrud(makeClient())
    expect(await screen.findByText('Kayıtlar yüklenemedi: RLS')).toBeTruthy()
  })
})
