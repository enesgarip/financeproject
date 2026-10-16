// @vitest-environment happy-dom
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DeferredDetails } from './deferred-details'

afterEach(cleanup)

it('ilk açılışa kadar çocuğu kurmaz, kapanıp açılınca formu ve yüklemeyi korur', () => {
  const load = vi.fn()
  function Panel() {
    useEffect(load, [])
    return <input aria-label="Not" defaultValue="" />
  }
  const { container } = render(<DeferredDetails summary="Ayrıntılar"><Panel /></DeferredDetails>)
  const details = container.querySelector('details')!
  expect(load).not.toHaveBeenCalled()
  details.open = true
  fireEvent(details, new Event('toggle'))
  fireEvent.change(screen.getByLabelText('Not'), { target: { value: 'Taslak' } })
  details.open = false
  fireEvent(details, new Event('toggle'))
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect((screen.getByLabelText('Not') as HTMLInputElement).value).toBe('Taslak')
  expect(load).toHaveBeenCalledTimes(1)
})

it('doğrudan açık gelen ledger ayrıntısını hemen kurar', () => {
  render(<DeferredDetails summary="Hareketler" defaultOpen><p>Ledger</p></DeferredDetails>)
  expect(screen.getByText('Ledger')).toBeTruthy()
})
