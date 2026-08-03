// @vitest-environment happy-dom
//
// SimpleModal'ın a11y focus sözleşmesi (F-02, denetim 2026-08-02). Proje varsayılan
// test ortamı `node`; bu dosya üstteki pragma ile happy-dom'a geçer, böylece
// document.activeElement / focus() / keydown davranışı test edilebilir. Diğer
// util testleri DOM'suz node ortamında kalır.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SimpleModal } from './SimpleModal'

afterEach(cleanup)

function Body() {
  return (
    <>
      <input aria-label="Tutar" />
      <button type="button">Kaydet</button>
    </>
  )
}

function dialogFocusables() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input'),
  )
}

describe('SimpleModal — a11y focus yönetimi', () => {
  it('açılınca focus modalın içine taşınır', () => {
    render(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    // Section (tabIndex=-1) veya içindeki bir öğe odaklı olmalı.
    expect(dialog!.contains(document.activeElement)).toBe(true)
  })

  it('Escape tuşu onClose çağırır', () => {
    const onClose = vi.fn()
    render(
      <SimpleModal title="Test" open onClose={onClose}>
        <Body />
      </SimpleModal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab son öğede döngüyü ilk öğeye sarar (focus trap)', () => {
    render(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    const focusables = dialogFocusables()
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })

  it('Shift+Tab ilk öğede döngüyü son öğeye sarar', () => {
    render(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    const focusables = dialogFocusables()
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('yeniden render (yeni onClose referansı) input focus\'unu çalmaz — mobil klavye bug\'ı', () => {
    // Regresyon: çağıranlar inline `onClose={() => ...}` verir (her render'da yeni
    // referans). Focus effect'i onClose'a bağlıyken her tuş vuruşunda yeniden kurulup
    // section.focus() ile odağı input'tan alıyordu → mobilde klavye kapanıyordu.
    const { rerender } = render(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    const input = dialogFocusables().find((el) => el.tagName === 'INPUT')!
    input.focus()
    expect(document.activeElement).toBe(input)

    // Kullanıcının yazması gibi: parent yeni bir onClose referansıyla yeniden render olur.
    rerender(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    // Focus input'ta KALMALI (aksi halde mobilde klavye kapanırdı).
    expect(document.activeElement).toBe(input)
  })

  it('kapanınca focus tetikleyen öğeye geri döner', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { rerender } = render(
      <SimpleModal title="Test" open onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    expect(document.activeElement).not.toBe(trigger)

    rerender(
      <SimpleModal title="Test" open={false} onClose={() => {}}>
        <Body />
      </SimpleModal>,
    )
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
