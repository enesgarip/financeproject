import { CrudPage, type FormField } from '../CrudPage'
import { LineGroup, LineRow, SectionEyebrow } from '../serit'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { PersonalTrackingEntry } from '../../types/database'
import { dateInputValue, formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { greaterThanTL, roundTL } from '../../utils/money'
import { summarizePersonalTracking } from '../../utils/personalTracking'

const fields: FormField[] = [
  { name: 'person_name', label: 'Kişi', type: 'text', required: true },
  { name: 'amount', label: 'Tutar (₺)', type: 'number', min: '0.01', step: '0.01', required: true },
  { name: 'occurred_on', label: 'Tarih', type: 'date', required: true },
  { name: 'note', label: 'Açıklama', type: 'textarea' },
]

export function PersonalTrackingPanel() {
  const { formatAmount } = useBalancePrivacy()
  return (
    <section aria-label="Sadece takip" className="space-y-4">
      <p className="text-sm leading-relaxed text-ink-muted">
        Geri beklemediğin ödemeleri kişi, tutar ve açıklamayla sakla. Bu kayıtlar borç, alacak,
        bakiye ve bütçe hesaplarına katılmaz; hesap veya kart hareketi oluşturmaz.
      </p>
      <CrudPage
        table="personal_tracking_entries"
        pageTitle="Sadece takip"
        addLabel="Takip kaydı ekle"
        formDescription="Bu kayıt yalnızca hatırlamak içindir; finansal hesaplarını etkilemez."
        fields={fields}
        emptyTitle="Henüz takip kaydı yok"
        emptyDescription="Birisi için yaptığın ve geri istemediğin ödemeleri burada saklayabilirsin."
        orderBy="occurred_on"
        orderAscending={false}
        getInitialValues={(row?: PersonalTrackingEntry) => ({
          person_name: row?.person_name ?? '',
          amount: row?.amount ?? '',
          occurred_on: row?.occurred_on ?? dateInputValue(new Date()),
          note: row?.note ?? '',
        })}
        validateForm={(formData) => {
          const errors: Record<string, string> = {}
          if (!String(formData.get('person_name') ?? '').trim()) errors.person_name = 'Kişi adını yaz.'
          const amount = parseNumber(formData.get('amount'))
          if (!Number.isFinite(amount) || !greaterThanTL(amount, 0)) errors.amount = 'Sıfırdan büyük bir tutar gir.'
          return errors
        }}
        mapForm={(formData, userId) => ({
          user_id: userId,
          person_name: String(formData.get('person_name') ?? '').trim().replace(/\s+/g, ' '),
          amount: roundTL(parseNumber(formData.get('amount'))),
          occurred_on: String(formData.get('occurred_on') ?? ''),
          note: String(formData.get('note') ?? '').trim() || null,
        })}
        renderTitle={(row) => row.person_name}
        renderSubtitle={(row) => formatDate(row.occurred_on)}
        renderDetails={(row) => [`Tutar: ${formatAmount(row.amount)}`]}
        listGridClassName="min-[760px]:grid-cols-1 xl:grid-cols-1"
        renderBeforeList={({ loading, rows }) => {
          if (loading || rows.length === 0) return null
          return (
            <div>
              <SectionEyebrow>Kişi başına toplam · sadece takip</SectionEyebrow>
              <LineGroup>
                {summarizePersonalTracking(rows).map((person) => (
                  <LineRow key={person.personName} title={person.personName}
                    subtitle={`${person.count} kayıt`} amount={person.total} />
                ))}
              </LineGroup>
            </div>
          )
        }}
      />
    </section>
  )
}
