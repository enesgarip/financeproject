import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useForeignCardSms } from '../../app/useForeignCardSms'
import { useAuth } from '../../auth/useAuth'
import type { AccountReconciliation, Card } from '../../types/database'
import { buildReconciliationItems, latestReconciliationByCard } from '../../utils/reconciliation'
import { Button } from '../ui/button'

type Props = {
  cards: Card[]
  reconciliations: AccountReconciliation[]
  healthIssueIds: string[]
  subscriptionIds: string[]
  onLastTopicReviewed: () => void
}

function readReviewedIds(storageKey: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function ForeignCardSmsNotice(props: Props) {
  const { user } = useAuth()
  return user ? <ReviewNotice key={user.id} storageKey={`denge:dashboard-reviewed-v1:${user.id}`} {...props} /> : null
}

function ReviewNotice({ cards, reconciliations, healthIssueIds, subscriptionIds, storageKey, onLastTopicReviewed }: Props & { storageKey: string }) {
  const [reviewedIds, setReviewedIds] = useState(() => readReviewedIds(storageKey))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const query = useForeignCardSms()
  const differenceIds = buildReconciliationItems(cards, latestReconciliationByCard(reconciliations))
    .flatMap(item => item.status === 'drift' && item.last ? [item.last.id] : [])
  const smsWarning = query.isError ? 'Dövizli SMS durumu doğrulanamadı.'
    : query.data?.recoveryWarning ? 'Eski dövizli SMS kayıtlarının tamamı doğrulanamadı.' : null
  const topics = [
    {
      id: 'sms',
      recordIds: query.data?.rows.map(row => row.id) ?? [],
      label: 'Dövizli işlemler',
      describe: () => `${query.data?.rows.length ?? 0} dövizli işlemin kesin TL tutarı bekleniyor. Finansal toplamlar bu işlemleri içermiyor.`,
      href: '/kartlar?section=kartlar#doviz-sms',
      link: 'Dövizli işlemleri incele',
      warning: smsWarning,
    },
    {
      id: 'reconciliation',
      recordIds: differenceIds,
      label: 'Hesap farkları',
      describe: (count: number) => `${count} hesap veya kart karşılaştırmasında açık fark var.`,
      href: '/veri-sagligi',
      link: 'Hesap farklarını incele',
    },
    {
      id: 'health',
      recordIds: healthIssueIds,
      label: 'Veri bulguları',
      describe: (count: number) => `Hızlı veri kontrolünde ${count} bulgu var.`,
      href: '/veri-sagligi',
      link: 'Bulguları incele',
    },
    {
      id: 'subscriptions',
      recordIds: subscriptionIds,
      label: 'Abonelik adayları',
      describe: (count: number) => `${count} abonelik adayı inceleme bekliyor.`,
      href: '/odemeler?view=plans#abonelikler',
      link: 'Abonelik adaylarını incele',
    },
  ].map(topic => {
    const keys = topic.recordIds.map(id => `${topic.id}:${id}`)
    const count = new Set(keys.filter(id => !reviewedIds.has(id))).size
    return { ...topic, keys, count }
  }).filter(topic => topic.count > 0 || topic.warning)

  function markReviewed(topic: typeof topics[number]) {
    const prefix = `${topic.id}:`
    const next = new Set([...reviewedIds, ...readReviewedIds(storageKey)].filter(id => !id.startsWith(prefix)))
    for (const key of topic.keys) next.add(key)
    try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* İnceleme bu sayfada hatırlanır. */ }
    if (topics.length === 1) onLastTopicReviewed()
    else headingRef.current?.focus({ preventScroll: true })
    setReviewedIds(next)
  }

  if (topics.length === 0) return null
  return (
    <section aria-label="İncelenecekler" className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm lg:col-span-12">
      <h2 ref={headingRef} tabIndex={-1} className="font-semibold text-ink">İncelenecekler · {topics.length} başlık</h2>
      <ul className="mt-2 divide-y divide-line">
        {topics.map(topic => (
          <li key={topic.id} className="flex flex-wrap items-start justify-between gap-x-3 py-2">
            <div>
              {topic.count > 0 && !(topic.id === 'sms' && query.isError) ? <p>{topic.describe(topic.count)}</p> : null}
              {topic.warning ? <p>{topic.warning}</p> : null}
              <Link className="inline-flex min-h-11 items-center font-semibold text-primary" to={topic.href}>{topic.link} →</Link>
            </div>
            {topic.warning ? null : (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                aria-label={`İncelendi olarak işaretle (${topic.label})`}
                onClick={() => markReviewed(topic)}
              >
                İncelendi
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
