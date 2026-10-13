import type { PersonalTrackingEntry } from '../types/database'
import { sumTL } from './money'

/** Yalnız bilgi amaçlı toplam; finansal pozisyon/nakit akışı girdisi değildir. */
export function summarizePersonalTracking(rows: Pick<PersonalTrackingEntry, 'person_name' | 'amount'>[]) {
  const people = new Map<string, { personName: string; amounts: number[] }>()
  for (const row of rows) {
    const name = row.person_name.trim().replace(/\s+/g, ' ')
    const key = name.toLocaleLowerCase('tr-TR')
    const person = people.get(key) ?? { personName: name, amounts: [] }
    person.amounts.push(row.amount)
    people.set(key, person)
  }
  return [...people.values()]
    .map(({ personName, amounts }) => ({ personName, count: amounts.length, total: sumTL(amounts) }))
    .sort((a, b) => a.personName.localeCompare(b.personName, 'tr'))
}
