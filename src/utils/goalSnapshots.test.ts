import { describe, expect, it } from 'vitest'
import { buildGoalSnapshotEntries } from './goalSnapshots'

type Row = Parameters<typeof buildGoalSnapshotEntries>[0][number]

function goal(overrides: Partial<Row> & Pick<Row, 'id'>): Row {
  return { status: 'active', current_amount: 0, ...overrides }
}

describe('buildGoalSnapshotEntries', () => {
  it('aktif hedeflerin türetilmiş tutarını hedef kimliğiyle eşler', () => {
    const entries = buildGoalSnapshotEntries([
      goal({ id: 'a', current_amount: 12500.5 }),
      goal({ id: 'b', current_amount: 0 }),
    ])
    expect(entries).toEqual([
      { goalId: 'a', amount: 12500.5 },
      { goalId: 'b', amount: 0 },
    ])
  })

  it('tamamlanmış hedefi fotoğraflamaz (tempo bitmiş işi ölçmez)', () => {
    const entries = buildGoalSnapshotEntries([
      goal({ id: 'a', status: 'completed', current_amount: 100000 }),
      goal({ id: 'b', current_amount: 5000 }),
    ])
    expect(entries).toEqual([{ goalId: 'b', amount: 5000 }])
  })

  it('negatif ya da sayı olmayan tutarı eler (DB check ile aynı çizgi)', () => {
    const entries = buildGoalSnapshotEntries([
      goal({ id: 'a', current_amount: -1 }),
      goal({ id: 'b', current_amount: Number.NaN }),
      goal({ id: 'c', current_amount: 750 }),
    ])
    expect(entries).toEqual([{ goalId: 'c', amount: 750 }])
  })

  it('boş listeye boş döner', () => {
    expect(buildGoalSnapshotEntries([])).toEqual([])
  })
})
