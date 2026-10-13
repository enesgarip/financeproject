import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { assessWishlistIntent, type WishlistIntentAnswers } from '../utils/wishlistIntent'
import type { WishlistPlan } from '../utils/wishlistPlan'

const QUESTIONS = [
  { key: 'essential', text: 'Sağlık, iş, eğitim veya günlük yaşamın için temel bir işi karşılıyor mu?' },
  { key: 'alternative', text: 'Aynı işi gören, kullanabileceğin bir şey zaten var mı?' },
  { key: 'delayCost', text: 'Bir ay ertelersen somut bir sorun veya kayıp yaşar mısın?' },
] as const

export function WishlistIntentTest({ answers, onChange }: {
  answers: WishlistIntentAnswers
  onChange: (answers: WishlistIntentAnswers) => void
}) {
  const result = assessWishlistIntent(answers)
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">İstek mi, ihtiyaç mı?</h2>
        <p className="mt-1 text-xs text-ink-muted">Üç kısa soruyla düşün. Son karar sende; cevapların kaydedilmez.</p>
      </div>
      {QUESTIONS.map(({ key, text }) => (
        <fieldset key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <legend className="float-left w-full text-xs leading-relaxed text-ink sm:w-auto sm:max-w-[70%]">{text}</legend>
          <div className="flex shrink-0 gap-3">
            {[true, false].map((value) => (
              <label key={String(value)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="radio"
                  name={`intent-${key}`}
                  required
                  checked={answers[key] === value}
                  onChange={() => onChange({ ...answers, [key]: value })}
                  className="size-4 accent-primary"
                />
                {value ? 'Evet' : 'Hayır'}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div aria-live="polite" className="text-xs leading-relaxed text-ink-muted">
        {result ? <><p className="font-semibold text-ink">{result.label}</p><p>{result.reason}</p></> : 'Sonucu görmek için üç soruyu yanıtla.'}
      </div>
    </div>
  )
}

export function WishlistAssessment({ plan }: { plan: WishlistPlan }) {
  const { formatAmount } = useBalancePrivacy()
  const { impact } = plan
  const label = impact.verdict === 'zorlayici'
    ? 'Şu an alırsan zorlar'
    : impact.verdict === 'dikkat' ? 'Bütçeni sıkıştırabilir' : 'Plana göre uygun'
  return (
    <div className="space-y-1 text-xs leading-relaxed">
      <p className={`font-semibold ${impact.verdict === 'zorlayici' ? 'text-destructive' : impact.verdict === 'dikkat' ? 'text-warning' : 'text-ink'}`}>{label}</p>
      <p className="text-ink-muted">Alım sonrası bu ay harcanabilir: <span className="serit-num">{formatAmount(impact.safeToSpendAfter)}</span></p>
      <p className="text-ink-muted">{impact.reasons.slice(0, 2).join(' ')}</p>
      {!plan.affordableNow && plan.month ? <p className="text-ink-muted">Tahmini fiyatı ilk karşılayan ay: {plan.month.label}.</p> : null}
      {!plan.affordableNow && !plan.month ? <p className="text-ink-muted">Önümüzdeki 6 aylık planda bu tutara yer görünmüyor.</p> : null}
      {plan.goalMonths > 0 && plan.goalName ? <p className="text-ink-muted">{plan.goalName} hedefine ayıracağın yaklaşık {plan.goalMonths} aylık paya denk.</p> : null}
    </div>
  )
}
