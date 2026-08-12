// @vitest-environment happy-dom
//
// Toast aciliyet sözleşmesi (denetim 2026-08-12 §6): HEPSİ `role="alert"` +
// `aria-live="assertive"` idi, yani "Kaydedildi" gibi bir bilgi ekran okuyucunun
// o an okuduğu cümleyi kesiyordu. Artık yalnız error/warning keser.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ToastProvider, useToast } from './toast'

afterEach(cleanup)

function Trigger({ type }: { type: 'success' | 'info' | 'warning' | 'error' }) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast({ type, title: 'Mesaj' })}>
      aç
    </button>
  )
}

function renderToast(type: 'success' | 'info' | 'warning' | 'error') {
  const view = render(
    <ToastProvider>
      <Trigger type={type} />
    </ToastProvider>,
  )
  // `fireEvent` şart: ham `.click()` React'in state güncellemesini `act` dışında
  // bırakıyor ve toast hiç render edilmiyor.
  fireEvent.click(view.getByText('aç'))
  return view
}

describe('ToastItem — aciliyet rolleri', () => {
  it('error assertive alert olarak duyurulur', () => {
    renderToast('error')
    const node = document.querySelector('[aria-atomic="true"]')!
    expect(node.getAttribute('role')).toBe('alert')
    expect(node.getAttribute('aria-live')).toBe('assertive')
  })

  it('warning assertive kalır', () => {
    renderToast('warning')
    const node = document.querySelector('[aria-atomic="true"]')!
    expect(node.getAttribute('aria-live')).toBe('assertive')
  })

  it('success polite status olur (okumayı kesmez)', () => {
    renderToast('success')
    const node = document.querySelector('[aria-atomic="true"]')!
    expect(node.getAttribute('role')).toBe('status')
    expect(node.getAttribute('aria-live')).toBe('polite')
  })

  it('info polite status olur', () => {
    renderToast('info')
    const node = document.querySelector('[aria-atomic="true"]')!
    expect(node.getAttribute('role')).toBe('status')
    expect(node.getAttribute('aria-live')).toBe('polite')
  })
})
