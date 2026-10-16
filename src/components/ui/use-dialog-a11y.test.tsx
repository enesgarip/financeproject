// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useDialogA11y } from './use-dialog-a11y'

afterEach(cleanup)

function Menu() {
  const [open, setOpen] = useState(false)
  const ref = useDialogA11y<HTMLDivElement>(open, () => setOpen(false))
  return <><button onClick={() => setOpen(true)}>Menüyü aç</button>{open ? <div ref={ref} role="dialog" tabIndex={-1}>
    <button>İlk işlem</button>
    <details><summary>Diğer işlemler</summary><button>Gizli işlem</button></details>
  </div> : null}</>
}

it('kapalı ayrıntıların öğeleri odak döngüsüne girmez; açılınca erişilir', () => {
  render(<Menu />)
  fireEvent.click(screen.getByText('Menüyü aç'))
  const first = screen.getByText('İlk işlem')
  first.focus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByText('Diğer işlemler'))
  screen.getByText('Diğer işlemler').parentElement!.setAttribute('open', '')
  first.focus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByText('Gizli işlem'))
})

it('Escape menüyü kapatıp odağı tetikleyiciye geri verir', () => {
  render(<Menu />)
  const trigger = screen.getByText('Menüyü aç')
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
