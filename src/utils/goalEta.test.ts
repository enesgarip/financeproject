import { describe, expect, it } from 'vitest'
import { buildGoalEta, buildGoalTempo } from './goalEta'

const TODAY = new Date('2026-08-25T12:00:00')

function snap(goalId: string, date: string, amount: number) {
  return { goal_id: goalId, snapshot_date: date, amount }
}

describe('buildGoalTempo', () => {
  it('uç noktalardan aylık tempoyu türetir; delikli seri sorun değil', () => {
    const tempo = buildGoalTempo(
      [
        snap('g1', '2026-06-15', 100000),
        snap('g1', '2026-07-20', 118000), // aradaki nokta uçları değiştirmez
        snap('g1', '2026-08-24', 135000),
        snap('g2', '2026-06-15', 999999), // başka hedef
      ],
      'g1',
      TODAY,
    )
    expect(tempo).not.toBeNull()
    expect(tempo!.spanDays).toBe(70)
    expect(tempo!.monthlyDelta).toBe(15220) // 35000/70*30,44
  })

  it('kısa süre ya da tek aya sıkışan örnekle konuşmaz', () => {
    const shortSpan = [snap('g1', '2026-08-01', 100), snap('g1', '2026-08-24', 200)]
    expect(buildGoalTempo(shortSpan, 'g1', TODAY)).toBeNull()

    // 46 gün ama pencere dışı eski nokta elenince tek nokta kalır.
    const outsideWindow = [snap('g1', '2026-04-01', 100), snap('g1', '2026-08-24', 200)]
    expect(buildGoalTempo(outsideWindow, 'g1', TODAY)).toBeNull()
  })

  it('düşüşte negatif tempo verir (dürüst tespit)', () => {
    const tempo = buildGoalTempo(
      [snap('g1', '2026-06-15', 135000), snap('g1', '2026-08-24', 100000)],
      'g1',
      TODAY,
    )
    expect(tempo!.monthlyDelta).toBeLessThan(0)
  })
})

describe('buildGoalEta', () => {
  const tempo = { monthlyDelta: 15000, spanDays: 70 }

  it('kalan / tempo ile bitiş ayını ve plan kıyasını verir', () => {
    const eta = buildGoalEta({ target_date: '2027-06-30' }, 145000, tempo, TODAY)
    expect(eta).not.toBeNull()
    expect(eta!.months).toBe(10) // ceil(145000/15000)
    expect(eta!.etaLabel).toBe('Haziran 2027')
    expect(eta!.deltaMonthsVsTarget).toBe(0) // planla uyumlu
  })

  it('plan kıyası: erken bitiş pozitif (önde), geç bitiş negatif (geride)', () => {
    expect(buildGoalEta({ target_date: '2027-09-30' }, 145000, tempo, TODAY)!.deltaMonthsVsTarget).toBe(3)
    expect(buildGoalEta({ target_date: '2027-03-31' }, 145000, tempo, TODAY)!.deltaMonthsVsTarget).toBe(-3)
  })

  it('temposuz/negatif tempoda ve ulaşılmış hedefte tarih uydurmaz', () => {
    expect(buildGoalEta({ target_date: null }, 100, null, TODAY)).toBeNull()
    expect(buildGoalEta({ target_date: null }, 100, { monthlyDelta: -500, spanDays: 60 }, TODAY)).toBeNull()
    expect(buildGoalEta({ target_date: null }, 0, tempo, TODAY)).toBeNull()
  })

  it('10 yılı aşan ufukta susar (tahmin, fal değil)', () => {
    expect(buildGoalEta({ target_date: null }, 2000000, { monthlyDelta: 100, spanDays: 60 }, TODAY)).toBeNull()
  })
})
