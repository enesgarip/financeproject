import { Link } from 'react-router'
import { useForeignCardSms } from '../../app/useForeignCardSms'
import type { AccountReconciliation, Card } from '../../types/database'
import { buildReconciliationItems, latestReconciliationByCard } from '../../utils/reconciliation'

export function ForeignCardSmsNotice({ cards = [], reconciliations = [], healthCount = 0, subscriptionCount = 0 }: {
  cards?: Card[]
  reconciliations?: AccountReconciliation[]
  healthCount?: number
  subscriptionCount?: number
}) {
  const query = useForeignCardSms()
  const count = query.data?.rows.length ?? 0
  const differences = buildReconciliationItems(cards, latestReconciliationByCard(reconciliations)).filter(item => item.status === 'drift')
  const smsNeedsReview = count > 0 || query.isError || Boolean(query.data?.recoveryWarning)
  const topics = Number(smsNeedsReview) + Number(differences.length > 0) + Number(healthCount > 0) + Number(subscriptionCount > 0)
  if (!topics) return null
  return <section aria-label="İncelenecekler" className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm lg:col-span-12">
    <h2 className="font-semibold text-ink">İncelenecekler · {topics} başlık</h2>
    <ul className="mt-2 divide-y divide-line">
    {smsNeedsReview ? <li className="py-2">
    <p className="text-ink">{query.isError ? 'Dövizli SMS durumu doğrulanamadı.' : count ? `${count} dövizli işlemin kesin TL tutarı bekleniyor. Finansal toplamlar bu işlemleri içermiyor.` : 'Eski dövizli SMS kayıtlarının tamamı doğrulanamadı.'}</p>
    <Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/kartlar?section=kartlar#doviz-sms">Dövizli işlemleri incele →</Link>
    </li> : null}
    {differences.length > 0 ? <li className="py-2"><p>{differences.length} hesap veya kart karşılaştırmasında açık fark var.</p><Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/veri-sagligi">Hesap farklarını incele →</Link></li> : null}
    {healthCount > 0 ? <li className="py-2"><p>Hızlı veri kontrolünde {healthCount} bulgu var.</p><Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/veri-sagligi">Bulguları incele →</Link></li> : null}
    {subscriptionCount > 0 ? <li className="py-2"><p>{subscriptionCount} abonelik adayı inceleme bekliyor.</p><Link className="inline-flex min-h-11 items-center font-semibold text-primary" to="/odemeler?view=plans#abonelikler">Abonelik adaylarını incele →</Link></li> : null}
    </ul>
  </section>
}
