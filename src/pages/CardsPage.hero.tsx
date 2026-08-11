/**
 * `/kartlar` alt sekmelerinin kahraman rakamı.
 *
 * Şerit'in 2. kuralı her ekranın tek bir soruyu cevaplamasını ister; bu sayfa
 * dört sekme taşıdığı için soru sekmeye göre değişir. "Özet" sekmesinde rakam
 * zaten `AccountHubPanel`'de (likit toplam), o yüzden burada çizilmez.
 */
import { Link } from 'react-router'
import type { Card, CardStatementArchive } from '../types/database'
import type { CardSection } from './CardsPage.sections'
import { formatDate } from '../utils/date'
import { formatPercent } from '../utils/formatCurrency'
import { daysUntil } from '../utils/date'
import { sumTL } from '../utils/money'
import { totalCreditLimit } from '../utils/financeSummary'
import { HeroNumber, SERIT_TEXT } from '../components/serit'

export function CardsSectionHero({
  section,
  rows,
  statements,
}: {
  section: CardSection
  rows: Card[]
  statements: CardStatementArchive[]
}) {
  const creditCards = rows.filter((row) => row.card_type === 'kredi_karti')
  if (section === 'ozet' || creditCards.length === 0) return null

  if (section === 'kartlar') {
    const debt = sumTL(creditCards.map((card) => card.debt_amount))
    // Ortak limit grubu kart başına TOPLANMAZ (çift sayım); grup başına max —
    // kontrol merkeziyle aynı kaynak (denetim 2026-08-12 K12).
    const limit = totalCreditLimit(creditCards)
    const usage = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0
    return (
      <HeroNumber
        label="Toplam kart borcu"
        value={debt}
        progress={limit > 0 ? usage : undefined}
        progressTone={usage >= 80 ? 'danger' : usage >= 55 ? 'warning' : 'brand'}
        description={
          limit > 0 ? (
            <>
              {creditCards.length} kredi kartı · limit kullanımı{' '}
              <span className="serit-num font-semibold text-ink">{formatPercent(usage)}</span>
            </>
          ) : (
            `${creditCards.length} kredi kartı`
          )
        }
      />
    )
  }

  if (section === 'islemler') {
    // "Dönem içi" = ekstresi henüz kesilmemiş harcama; bu sekmede eklenen her
    // harcamanın düştüğü kova bu, kahraman rakam da o yüzden bu.
    const current = sumTL(creditCards.map((card) => card.current_period_spending))
    const provision = sumTL(creditCards.map((card) => card.provision_amount ?? 0))
    return (
      <HeroNumber
        label="Dönem içi harcama"
        value={current}
        description={
          provision > 0 ? (
            <>
              Ekstresi kesilmemiş tutar · ayrıca{' '}
              <span className="serit-num font-semibold" style={{ color: SERIT_TEXT.info }}>
                {provision.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ₺
              </span>{' '}
              provizyon bekliyor
            </>
          ) : (
            'Ekstresi henüz kesilmemiş tutar'
          )
        }
      />
    )
  }

  // section === 'ekstreler'
  const open = statements.filter((statement) => statement.status === 'open' && statement.statement_debt_amount > 0)
  const due = sumTL(open.map((statement) => statement.statement_debt_amount))
  const nearest = open
    .filter((statement) => statement.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0]
  const remaining = nearest?.due_date ? daysUntil(nearest.due_date) : null

  return (
    <HeroNumber
      label="Ödenecek ekstre"
      value={due}
      tone={remaining !== null && remaining < 0 ? 'danger' : 'ink'}
      description={
        open.length === 0 ? (
          <>
            Açık ekstre yok — kesim geldiğinde burada görünür.{' '}
            <Link to="/borclar/kartlar" className="font-semibold" style={{ color: SERIT_TEXT.brand }}>
              Kart borcu →
            </Link>
          </>
        ) : (
          <>
            {open.length} açık ekstre
            {nearest?.due_date ? (
              <>
                {' '}· en yakın son ödeme{' '}
                <span
                  className="font-semibold"
                  style={{ color: remaining !== null && remaining < 0 ? SERIT_TEXT.danger : SERIT_TEXT.ink }}
                >
                  {formatDate(nearest.due_date)}
                </span>
              </>
            ) : null}
          </>
        )
      }
    />
  )
}
