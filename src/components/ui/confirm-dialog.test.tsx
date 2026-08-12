// @vitest-environment happy-dom
//
// ConfirmDialog'un a11y focus sözleşmesi (denetim 2026-08-12 §6). SimpleModal.test.tsx
// ile aynı desen: proje varsayılan test ortamı `node`, bu dosya pragma ile happy-dom'a
// geçer. Burada test edilen üç davranış, düzeltme öncesi EKSİKTİ:
//   1. kapanınca odağın tetikleyiciye dönmesi (hiç yoktu),
//   2. `loading` ile butonlar disabled olduğunda Tab döngüsünün yine kapsayıcıda
//      kalması (liste açılışta bir kez alındığı için ölü referanslara kuruluyordu),
//   3. Escape ile iptal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ConfirmDialog } from './confirm-dialog'

afterEach(cleanup)

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <ConfirmDialog
      open
      title="Kaydı sil"
      description="Bu kayıt kalıcı olarak silinecek."
      onCancel={() => {}}
      onConfirm={() => {}}
      {...props}
    />,
  )
}

function dialogFocusables() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="alertdialog"] button:not([disabled])'),
  )
}

describe('ConfirmDialog — a11y focus yönetimi', () => {
  it('açılınca odak diyaloğun içine taşınır', () => {
    renderDialog()
    const dialog = document.querySelector('[role="alertdialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog!.contains(document.activeElement)).toBe(true)
  })

  it('Escape onCancel çağırır', () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Tab son öğede döngüyü ilk öğeye sarar', () => {
    renderDialog()
    const focusables = dialogFocusables()
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })

  it('loading iken tüm butonlar disabled olsa da Tab diyaloğun dışına kaçmaz', () => {
    // Regresyon: focusable listesi açılışta BİR KEZ alınıyordu; `loading` gelip
    // butonlar disabled olduğunda döngü ölü referanslara kuruluyor ve Tab arka
    // plandaki sayfaya geçiyordu.
    const { rerender } = renderDialog()
    rerender(
      <ConfirmDialog
        open
        loading
        title="Kaydı sil"
        description="Bu kayıt kalıcı olarak silinecek."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(dialogFocusables()).toHaveLength(0)

    fireEvent.keyDown(document, { key: 'Tab' })
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('kapanınca odak tetikleyen öğeye geri döner', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { rerender } = renderDialog()
    expect(document.activeElement).not.toBe(trigger)

    rerender(
      <ConfirmDialog
        open={false}
        title="Kaydı sil"
        description="Bu kayıt kalıcı olarak silinecek."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
