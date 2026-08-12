// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { HealthIssue } from './DataHealth.logic'

vi.mock('../components/SimpleModal', () => ({
  SimpleModal: ({
    children,
    open,
    title,
  }: {
    children: ReactNode
    open: boolean
    title: string
  }) => open ? <section aria-label={title}>{children}</section> : null,
}))

vi.mock('../components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('../components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { FixAllModal, HealthIssueCard } from './DataHealthPage.components'
import { MAX_SAFE_REPAIR_BATCH_SIZE } from './DataHealthPage.actions'

afterEach(cleanup)

function issue(
  overrides: Partial<HealthIssue> & Pick<HealthIssue, 'id' | 'area' | 'kind'>,
): HealthIssue {
  return {
    severity: 'warning',
    title: 'Test bulgusu',
    description: 'Test açıklaması',
    details: [],
    fixable: false,
    ...overrides,
  }
}

function renderIssueCard(target: HealthIssue) {
  const onFix = vi.fn()
  const onPayIssue = vi.fn()
  const onReviewIssue = vi.fn()

  render(
    <MemoryRouter>
      <HealthIssueCard
        issue={target}
        fixingId={null}
        undoing={false}
        onFix={onFix}
        onPayIssue={onPayIssue}
        onReviewIssue={onReviewIssue}
        onSnooze={vi.fn()}
      />
    </MemoryRouter>,
  )

  return { onFix, onPayIssue, onReviewIssue }
}

describe('HealthIssueCard resolution actions', () => {
  it.each([
    issue({
      id: 'card-ledger-drift-card-1',
      area: 'Kartlar',
      kind: 'cardLedgerDrift',
      title: 'Kart borcu sapması',
      fixable: true,
      payload: { cardId: 'card-1', nextDebtAmount: 125 },
    }),
    issue({
      id: 'budget-month-budget-1',
      area: 'Bütçeler',
      kind: 'budgetMonth',
      title: 'Bütçe ayı sapması',
      fixable: true,
      payload: { budgetId: 'budget-1', updates: { month: '2026-08-01' } },
    }),
  ])('renders a real fix button for $kind', (target) => {
    const { onFix } = renderIssueCard(target)
    const button = screen.getByRole('button', {
      name: target.kind === 'cardLedgerDrift' ? 'Borcu hareketlerden hesapla' : 'Bütçe ayını hizala',
    })

    fireEvent.click(button)
    expect(onFix).toHaveBeenCalledWith(target)
  })

  it('renders the guided payment action and keeps the statement route', () => {
    const target = issue({
      id: 'card-overdue-statement-statement-1',
      area: 'Kartlar',
      kind: 'cardOverduePayment',
      title: 'Vadesi geçmiş ekstre',
      payload: { cardId: 'card-1', statementArchiveId: 'statement-1' },
    })
    const { onPayIssue } = renderIssueCard(target)

    fireEvent.click(screen.getByRole('button', { name: 'Ödeme çekmecesini aç' }))
    expect(onPayIssue).toHaveBeenCalledWith(target)
    expect(screen.getByRole('link', { name: 'Ekstreleri aç' }).getAttribute('href')).toBe(
      '/kartlar?section=ekstreler',
    )
  })

  it.each([
    [
      issue({
        id: 'card-scheduled-debt-card-1',
        area: 'Kartlar',
        kind: 'cardScheduledDebt',
        title: 'Borç ve taksit farkı',
      }),
      'Kayıtları karşılaştır',
      '/kartlar?section=islemler',
    ],
    [
      issue({
        id: 'budget-zero-budget-1',
        area: 'Bütçeler',
        kind: 'manual',
        title: 'Sıfır bütçe',
      }),
      'Bilgiyi incele',
      '/odemeler/hedefler',
    ],
  ] satisfies Array<[HealthIssue, string, string]>)('renders an owner route for $kind', (target, label, href) => {
    renderIssueCard(target)
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href)
  })

  it('does not expose a legacy write button when resolution policy is manual', () => {
    const target = issue({
      id: 'card-limit-over-group-1',
      area: 'Kartlar',
      kind: 'manual',
      title: 'Kart limiti uyuşmazlığı',
      fixable: true,
      fixLabel: 'Eski düzeltmeyi uygula',
    })
    const { onFix } = renderIssueCard(target)

    expect(screen.queryByRole('button', { name: 'Eski düzeltmeyi uygula' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Kayıtları karşılaştır' }).getAttribute('href')).toBe(
      '/kartlar?section=kartlar',
    )
    expect(onFix).not.toHaveBeenCalled()
  })

  it('does not present a mutation preview after a financial issue is demoted to review', () => {
    const target = issue({
      id: 'card-type-fields-card-1',
      area: 'Kartlar',
      kind: 'cardTypeFields',
      title: 'Kart türü alanları karışmış',
      fixable: true,
      payload: {
        cardId: 'card-1',
        updates: { debt_amount: 0 },
        expectedUpdatedAt: '2026-08-03T00:00:00.000Z',
      },
    })

    renderIssueCard(target)

    expect(screen.queryByText('Düzeltme önizlemesi')).toBeNull()
    expect(screen.getByRole('link', { name: 'Kayıtları karşılaştır' })).toBeTruthy()
  })

  it('opens the in-page comparison action for duplicate candidates', () => {
    const target = issue({
      id: 'card-expense-duplicate-exact-expense-1-expense-2',
      area: 'Kartlar',
      kind: 'duplicateTransactionCandidate',
      title: 'Tekrarlanan kayıt adayları',
      payload: { ids: ['expense-1', 'expense-2'], duplicateLevel: 'same_fingerprint' },
    })
    const { onReviewIssue } = renderIssueCard(target)

    fireEvent.click(screen.getByRole('button', { name: 'Harcamaları karşılaştır' }))
    expect(onReviewIssue).toHaveBeenCalledWith(target)
    expect(screen.getByRole('link', { name: 'Kart işlemleri ekranını aç' })).toBeTruthy()
  })
})

describe('FixAllModal safe repair preview', () => {
  it('shows every safe issue with source truth and atomic audit guarantees', () => {
    const safeIssues = Array.from({ length: 6 }, (_, index) => issue({
      id: `card-ledger-drift-card-${index + 1}`,
      area: 'Kartlar',
      kind: 'cardLedgerDrift',
      title: `Güvenli çözüm ${index + 1}`,
      fixable: true,
      payload: { cardId: `card-${index + 1}`, nextDebtAmount: 100 + index },
    }))

    render(
      <FixAllModal
        open
        onClose={vi.fn()}
        safeIssues={safeIssues}
        repairCount={safeIssues.length}
        fixingId={null}
        undoing={false}
        onConfirm={vi.fn()}
      />,
    )

    for (const target of safeIssues) {
      expect(screen.getByText(target.title)).toBeTruthy()
    }
    expect(screen.getAllByText(/Kaynak: Değişmez kart borç hareketlerinin kuruş toplamı/)).toHaveLength(6)
    expect(screen.getByText(/finans verisine hiç dokunulmaz/).textContent).toContain(
      'kalıcı denetim fişine yazılır',
    )
  })

  it('explains that repairs beyond the server cap require a fresh next preview', () => {
    render(
      <FixAllModal
        open
        onClose={vi.fn()}
        safeIssues={[]}
        repairCount={100}
        remainingRepairCount={7}
        fixingId={null}
        undoing={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText(/Kalan 7 çözüm/).textContent).toContain(
      'güncel veriden yeniden önizlenir',
    )
  })

  it('tur başına üst sınırı sabitten yazar (metin sabitle ayrışmasın)', () => {
    render(
      <FixAllModal
        open
        onClose={vi.fn()}
        safeIssues={[]}
        repairCount={MAX_SAFE_REPAIR_BATCH_SIZE}
        remainingRepairCount={3}
        fixingId={null}
        undoing={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText(/Kalan 3 çözüm/).textContent).toContain(
      `en fazla ${MAX_SAFE_REPAIR_BATCH_SIZE} çözüm`,
    )
  })
})

describe('HealthIssueCard kalıcılık ve detay listesi', () => {
  it('geçici gizlemeyi kalıcı kapatmadan ayırt edilir biçimde etiketler', () => {
    const onDismiss = vi.fn()
    const onSnooze = vi.fn()
    render(
      <MemoryRouter>
        <HealthIssueCard
          issue={issue({ id: 'card-missing-days-card-1', area: 'Kartlar', kind: 'manual' })}
          fixingId={null}
          undoing={false}
          onFix={vi.fn()}
          onSnooze={onSnooze}
          onDismiss={onDismiss}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bu görünümde gizle' }))
    expect(onSnooze).toHaveBeenCalledWith('card-missing-days-card-1')
    fireEvent.click(screen.getByRole('button', { name: 'Bu doğru, kalıcı kapat' }))
    expect(onDismiss).toHaveBeenCalledWith('card-missing-days-card-1')
    expect(screen.getByText(/geçicidir/).textContent).toContain('tüm cihazlarda kalıcıdır')
  })

  it('birebir aynı iki detay satırını da basar (key çakışması yok)', () => {
    render(
      <MemoryRouter>
        <HealthIssueCard
          issue={issue({
            id: 'card-expense-duplicate-exact-a-b',
            area: 'Kartlar',
            kind: 'duplicateTransactionCandidate',
            details: ['Aynı satır', 'Aynı satır'],
          })}
          fixingId={null}
          undoing={false}
          onFix={vi.fn()}
          onSnooze={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('Aynı satır')).toHaveLength(2)
  })
})
