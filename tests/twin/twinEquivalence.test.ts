import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { projectCardDebtKurus, projectCardSplit, type CardLedgerEvent } from '../../src/utils/cardLedger'
import { clampCardBreakdown, projectLoanSummary } from '../../src/utils/financeSummary'
import { toKurus } from '../../src/utils/money'

/**
 * SQL↔TS ikiz diferansiyel harness'i (mühendislik turu ④).
 *
 * Trigger↔TS ikiz eşdeğerliği bugüne dek konvansiyonla korunuyordu: iki taraf
 * AYRI example testlerle sınanır, hizalama elle yapılırdı. Burada yerel gerçek
 * Postgres'e rastgele (seed'i loglanan, TWIN_SEED ile tekrar üretilebilir)
 * yazma dizileri uygulanır; her adımda GERÇEK trigger çıktısı (kolonlar +
 * card_ledger olayları) TS ikizlerine verilip kuruş düzeyinde birebir eşitlik
 * beklenir. Bir trigger migration'ı ikizden saparsa (K4'ün FOR EACH STATEMENT
 * yeniden yazımı gibi) deploy'dan önce burada kırmızı yanar.
 *
 * KAPI: TWIN_DB=1 + yerel Supabase (migration + seed'in 11111111-… kullanıcısı)
 * ister — normal `test:unit` koşusunda SKIP edilir (quality job docker'sız).
 * Çalıştırma: `npm run db:test:twins` (CI Supabase job'ı da koşar — Ş13'ün
 * "skip'li canlı test sessizce çürür" dersi bu kablolamayla kapanır).
 */

const ENABLED = process.env.TWIN_DB === '1'
const SEED = Number(process.env.TWIN_SEED ?? Math.floor(Math.random() * 2 ** 31))
const CARD_OPS = 30
const USER = '11111111-1111-1111-1111-111111111111'
const CARD = 'f7000000-0000-4000-8000-0000000000e1'
const LOAN = 'f7000000-0000-4000-8000-0000000000e2'

// mulberry32 — deterministik PRNG (karşı örnek seed'le tekrar üretilir).
let state = SEED >>> 0
function rand(): number {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const money = (maxTL: number) => Math.round(rand() * maxTL * 100) / 100

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_financeproject', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

function cleanup(): void {
  try {
    psql(`delete from public.cards where id = '${CARD}'; delete from public.loans where id = '${LOAN}';`)
  } catch {
    /* temizlik en-iyi-çaba */
  }
}

type StoredCardRow = {
  debt_amount: number
  statement_debt_amount: number
  current_period_spending: number
  provision_amount: number
}

describe.runIf(ENABLED)(`SQL↔TS ikiz eşdeğerliği (seed ${SEED})`, () => {
  // Docker-exec psql turları test başına ~20 sn sürer — DB'li harness'in doğası.
  it('kart: rastgele yazma dizisinde clamp + ledger + split ikizleri kuruş-birebir', { timeout: 120_000 }, () => {
    cleanup()
    psql(`insert into public.cards (id, user_id, bank_name, card_name, card_type, credit_limit, debt_amount, statement_debt_amount, current_period_spending, provision_amount)
          values ('${CARD}', '${USER}', 'Twin Bank', 'Twin Karti', 'kredi_karti', 500000, 0, 0, 0, 0)`)

    for (let op = 1; op <= CARD_OPS; op += 1) {
      const debt = money(30_000)
      // Kovalar bilerek bazen borcu AŞAR — clamp trigger'ı (ve TS ikizi) tam
      // bu durumda sınanır.
      const statement = money(debt * 1.3 + 100)
      const current = money(debt * 1.3 + 100)
      const provision = money(debt * 1.3 + 100)
      const label = `op ${op} (debt=${debt} s=${statement} c=${current} p=${provision}, seed ${SEED})`

      psql(`update public.cards set debt_amount = ${debt}, statement_debt_amount = ${statement}, current_period_spending = ${current}, provision_amount = ${provision} where id = '${CARD}'`)

      const row = JSON.parse(
        psql(`select to_jsonb(t) from (select debt_amount, statement_debt_amount, current_period_spending, provision_amount from public.cards where id = '${CARD}') t`),
      ) as StoredCardRow
      const twin = clampCardBreakdown(debt, statement, current, provision)
      expect.soft(toKurus(row.statement_debt_amount), `clamp statement ${label}`).toBe(toKurus(twin.statement))
      expect.soft(toKurus(row.current_period_spending), `clamp current ${label}`).toBe(toKurus(twin.current))
      expect(toKurus(row.provision_amount), `clamp provision ${label}`).toBe(toKurus(twin.provision))

      const events = JSON.parse(
        psql(`select coalesce(json_agg(e order by occurred_at, id), '[]') from (select card_id, kind, amount_kurus, occurred_at, id, statement_delta_kurus, current_delta_kurus, provision_delta_kurus from public.card_ledger where card_id = '${CARD}') e`),
      ) as CardLedgerEvent[]
      expect(projectCardDebtKurus(events), `ledger borç projeksiyonu ${label} (${events.length} olay)`).toBe(
        toKurus(row.debt_amount),
      )
      const split = projectCardSplit(events)
      expect(split.complete, `yeni kartın olayları tam-delta olmalı ${label}`).toBe(true)
      expect.soft(toKurus(split.statement), `split statement ${label}`).toBe(toKurus(row.statement_debt_amount))
      expect.soft(toKurus(split.current), `split current ${label}`).toBe(toKurus(row.current_period_spending))
      expect(toKurus(split.provision), `split provision ${label}`).toBe(toKurus(row.provision_amount))
    }
  })

  it('kredi: taksit planı + rastgele ödenmiş önek sonrası özet = TS projeksiyonu', { timeout: 120_000 }, () => {
    const installmentCount = 6 + Math.floor(rand() * 12)
    psql(`insert into public.loans (id, user_id, bank_name, loan_name, total_amount, remaining_amount, monthly_payment, installment_day, remaining_installments, status)
          values ('${LOAN}', '${USER}', 'Twin Bank', 'Twin Kredi', 0, 0, 0, 5, 0, 'active')`)
    for (let i = 1; i <= installmentCount; i += 1) {
      const amount = money(9_000) + 1
      const monthPart = String(((i - 1) % 12) + 1).padStart(2, '0')
      const year = 2027 + Math.floor((i - 1) / 12)
      psql(`insert into public.loan_installments (user_id, loan_id, installment_no, due_date, amount, status) values ('${USER}', '${LOAN}', ${i}, '${year}-${monthPart}-05', ${amount}, 'bekliyor')`)
    }
    // RPC'nin sıra guard'ına saygı: ödemeler baştan itibaren rastgele bir ÖNEK.
    const paidPrefix = Math.floor(rand() * (installmentCount + 1))
    if (paidPrefix > 0) {
      psql(`update public.loan_installments set status = 'ödendi', paid_at = now() where loan_id = '${LOAN}' and installment_no <= ${paidPrefix}`)
    }

    const loanRow = JSON.parse(
      psql(`select to_jsonb(t) from (select remaining_amount, remaining_installments, status from public.loans where id = '${LOAN}') t`),
    ) as { remaining_amount: number; remaining_installments: number; status: string }
    const installments = JSON.parse(
      psql(`select coalesce(json_agg(i), '[]') from (select amount, status from public.loan_installments where loan_id = '${LOAN}') i`),
    ) as { amount: number; status: 'bekliyor' | 'ödendi' }[]
    const twin = projectLoanSummary(installments)
    const label = `taksit ${installmentCount}, ödenen önek ${paidPrefix}, seed ${SEED}`

    expect.soft(toKurus(loanRow.remaining_amount), `kalan tutar ${label}`).toBe(toKurus(twin.remainingAmount))
    expect.soft(loanRow.remaining_installments, `kalan adet ${label}`).toBe(twin.remainingInstallments)
    expect(loanRow.status, `durum ${label}`).toBe(twin.status)

    cleanup()
  })
})
