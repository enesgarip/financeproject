import { Pencil, Plus, Target, Trash2, Trophy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { SimpleModal } from '../SimpleModal'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input, Select, Textarea } from '../ui/input'
import { Progress } from '../ui/progress'
import { useConfirmDialog } from '../ui/use-confirm-dialog'
import { deleteSavingsGoal, fetchSavingsGoalsRows, upsertSavingsGoalWithComponents } from '../../data/repositories/savingsGoalsRepo'
import type { InsertFor, SavingsGoal, SavingsGoalComponent, SavingsGoalValueType } from '../../types/database'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { useMarketRates } from '../../hooks/useMarketRates'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import {
  formatComponentAmount,
  formatSavingsGoalProgress,
  savingsGoalTargetReached,
  savingsGoalProgressRate,
  savingsGoalValueTypeLabel,
} from '../../utils/savingsGoal'
import { effectiveGoalValue, valueGoal } from '../../utils/valuation'

type ComponentDraft = {
  key: string
  label: string
  value_type: SavingsGoalComponent['value_type']
  target_amount: string
  current_amount: string
}

function newComponentDraft(partial?: Partial<ComponentDraft>): ComponentDraft {
  return {
    key: partial?.key ?? crypto.randomUUID(),
    label: partial?.label ?? '',
    value_type: partial?.value_type ?? 'gram_altin',
    target_amount: partial?.target_amount ?? '',
    current_amount: partial?.current_amount ?? '',
  }
}

function defaultCompositeDrafts() {
  return [newComponentDraft({ label: 'Gram altın', value_type: 'gram_altin' }), newComponentDraft({ label: 'Çeyrek altın', value_type: 'ceyrek_altin' })]
}

export function SavingsGoalsPanel() {
  const { formatAmount } = useBalancePrivacy()
  const { user } = useAuth()
  const { snapshot } = useMarketRates()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [components, setComponents] = useState<SavingsGoalComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [name, setName] = useState('')
  const [valueType, setValueType] = useState<SavingsGoalValueType>('TRY')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentAmount, setCurrentAmount] = useState('')
  const [estimatedValueTry, setEstimatedValueTry] = useState('')
  const [autoValued, setAutoValued] = useState(true)
  const [targetDate, setTargetDate] = useState('')
  const [status, setStatus] = useState<SavingsGoal['status']>('active')
  const [note, setNote] = useState('')
  const [componentDrafts, setComponentDrafts] = useState<ComponentDraft[]>(defaultCompositeDrafts())
  const [formError, setFormError] = useState('')

  const componentsByGoal = useMemo(() => {
    const map = new Map<string, SavingsGoalComponent[]>()
    for (const row of components) {
      map.set(row.goal_id, [...(map.get(row.goal_id) ?? []), row])
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.sort_order - b.sort_order)
    }
    return map
  }, [components])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    const result = await fetchSavingsGoalsRows()

    if (!result.ok) {
      setError(result.error.message ?? 'Birikim hedefleri yüklenemedi.')
      setGoals([])
      setComponents([])
    } else {
      setGoals(result.data.goals)
      if (result.data.componentsError) {
        setComponents([])
      } else {
        setComponents(result.data.components)
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  function openCreate() {
    setEditing(null)
    setName('')
    setValueType('TRY')
    setTargetAmount('')
    setCurrentAmount('')
    setEstimatedValueTry('')
    setAutoValued(true)
    setTargetDate('')
    setStatus('active')
    setNote('')
    setComponentDrafts(defaultCompositeDrafts())
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(goal: SavingsGoal) {
    const rows = componentsByGoal.get(goal.id) ?? []
    setEditing(goal)
    setName(goal.name)
    setValueType(goal.value_type)
    setTargetAmount(String(goal.target_amount))
    setCurrentAmount(String(goal.current_amount))
    setEstimatedValueTry(goal.estimated_value_try ? String(goal.estimated_value_try) : '')
    setAutoValued(goal.auto_valued)
    setTargetDate(goal.target_date ?? '')
    setStatus(goal.status)
    setNote(goal.note ?? '')
    setComponentDrafts(
      goal.value_type === 'composite' && rows.length > 0
        ? rows.map((row) =>
            newComponentDraft({
              key: row.id,
              label: row.label ?? '',
              value_type: row.value_type,
              target_amount: String(row.target_amount),
              current_amount: String(row.current_amount),
            }),
          )
        : defaultCompositeDrafts(),
    )
    setFormError('')
    setModalOpen(true)
  }

  async function handleDelete(goal: SavingsGoal) {
    const confirmed = await confirm({
      title: 'Hedefi sil',
      description: `"${goal.name}" hedefi ve bağlı bileşenleri silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (!confirmed) return

    const deleteResult = await deleteSavingsGoal(goal.id)
    if (!deleteResult.ok) {
      setError(deleteResult.error.message ?? 'Hedef silinemedi.')
      return
    }
    await loadData()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Hedef adı yazmalısın.')
      return
    }

    const isComposite = valueType === 'composite'
    const isGold = valueType === 'gram_altin' || valueType === 'ceyrek_altin'

    let parsedComponents: InsertFor<'savings_goal_components'>[] = []

    if (isComposite) {
      if (componentDrafts.length === 0) {
        setFormError('Karma hedefte en az bir bileşen olmalı.')
        return
      }

      const nextComponents: InsertFor<'savings_goal_components'>[] = []

      for (const [index, draft] of componentDrafts.entries()) {
        const target = parseNumber(draft.target_amount)
        const current = parseNumber(draft.current_amount)
        if (target <= 0) {
          setFormError(`${draft.label || 'Bileşen'} hedef miktarı 0 dan büyük olmalı.`)
          return
        }

        nextComponents.push({
          user_id: user.id,
          goal_id: '',
          label: draft.label.trim() || null,
          value_type: draft.value_type,
          target_amount: target,
          current_amount: current,
          sort_order: index,
        })
      }

      parsedComponents = nextComponents
    } else {
      if (parseNumber(targetAmount) <= 0) {
        setFormError('Hedef miktar 0 dan büyük olmalı.')
        return
      }
    }

    setSaving(true)
    setFormError('')

    try {
      const compositeTargetAmount = parsedComponents.length
      const compositeCurrentAmount = parsedComponents.filter(savingsGoalTargetReached).length
      const goalAutoValued = isGold && autoValued
      const liveGoalValue = goalAutoValued
        ? valueGoal({ value_type: valueType, current_amount: parseNumber(currentAmount) }, snapshot)
        : null
      const goalFields = {
        name: trimmedName,
        value_type: valueType,
        target_amount: isComposite ? compositeTargetAmount : parseNumber(targetAmount),
        current_amount: isComposite ? compositeCurrentAmount : parseNumber(currentAmount),
        estimated_value_try: goalAutoValued
          ? liveGoalValue ?? (estimatedValueTry.trim() ? parseNumber(estimatedValueTry) : null)
          : isGold && estimatedValueTry.trim()
            ? parseNumber(estimatedValueTry)
            : null,
        auto_valued: goalAutoValued,
        target_date: targetDate || null,
        status,
        note: note.trim() || null,
      }

      const result = await upsertSavingsGoalWithComponents({
        userId: user.id,
        editingGoal: editing,
        goalFields,
        components: parsedComponents,
        isComposite,
      })
      if (!result.ok) throw new Error(result.error.message)

      setModalOpen(false)
      await loadData()
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Kayıt sırasında hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  const activeGoals = goals.filter((g) => g.status === 'active')
  const completedGoals = goals.filter((g) => g.status === 'completed')

  return (
    <section className="space-y-4">
      <Card className="border-border/70 shadow-[var(--shadow-card)]">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Target size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">Birikim hedefleri</h2>
                <p className="text-sm text-muted-foreground">
                  {goals.length === 0
                    ? 'TL, altın veya karma hedef ekle.'
                    : `${activeGoals.length} aktif${completedGoals.length > 0 ? ` · ${completedGoals.length} tamamlandı` : ''}`}
                </p>
              </div>
            </div>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus size={16} />
              Ekle
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Hedefler yükleniyor...</p>
      ) : goals.length === 0 ? (
        <Card className="border border-dashed border-border/70 bg-muted/20 shadow-none">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/8 text-primary/60">
              <Target size={28} />
            </div>
            <p className="text-sm font-semibold text-foreground">Henüz birikim hedefi yok</p>
            <p className="text-xs text-muted-foreground">İlk hedefini ekleyerek birikimine yön ver.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 min-[520px]:grid-cols-2">
          {goals.map((goal) => {
            const rate = savingsGoalProgressRate(goal, components)
            const goalComponents = componentsByGoal.get(goal.id) ?? []
            const isCompleted = goal.status === 'completed'
            const circumference = 2 * Math.PI * 36
            const strokeOffset = circumference - (circumference * Math.min(rate, 100)) / 100

            return (
              <Card key={goal.id} className={`border-border/70 shadow-[var(--shadow-card)] transition-shadow hover:shadow-md ${isCompleted ? 'bg-success/4 ring-1 ring-success/20' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="relative flex size-20 shrink-0 items-center justify-center">
                      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
                        <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/40" />
                        <circle
                          cx="40" cy="40" r="36" fill="none"
                          strokeWidth="5" strokeLinecap="round"
                          stroke="currentColor"
                          className={isCompleted ? 'text-success' : rate >= 75 ? 'text-primary' : rate >= 40 ? 'text-amber-500' : 'text-primary/60'}
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeOffset}
                          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {isCompleted ? (
                          <Trophy size={18} className="text-success" />
                        ) : (
                          <span className="text-sm font-extrabold tabular-nums text-foreground">%{Math.round(rate)}</span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{goal.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {isCompleted ? (
                              <Badge variant="default" className="bg-success/15 text-success text-[10px] px-1.5 py-0">Tamamlandı</Badge>
                            ) : null}
                            {goal.value_type !== 'TRY' ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{savingsGoalValueTypeLabel(goal.value_type)}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-0.5">
                          <button type="button" onClick={() => openEdit(goal)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <Pencil size={14} />
                          </button>
                          <button type="button" onClick={() => void handleDelete(goal)} className="rounded-lg p-1.5 text-destructive/60 hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{formatSavingsGoalProgress(goal, goalComponents)}</p>
                      {goal.value_type !== 'TRY' && goal.value_type !== 'composite' && (goal.auto_valued || goal.estimated_value_try) ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {goal.auto_valued ? 'Güncel' : 'Tahmini'}: <span className="font-semibold tabular-nums text-foreground">{formatAmount(effectiveGoalValue(goal, snapshot))}</span>
                        </p>
                      ) : null}
                      {goal.target_date ? <p className="mt-0.5 text-[11px] text-muted-foreground">Hedef: {formatDate(goal.target_date)}</p> : null}
                    </div>
                  </div>
                  {goal.value_type === 'composite' && goalComponents.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                      {goalComponents.map((row) => {
                        const compRate = row.target_amount > 0 ? Math.min((row.current_amount / row.target_amount) * 100, 100) : 0
                        return (
                          <div key={row.id} className="flex items-center gap-2">
                            <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{row.label?.trim() || savingsGoalValueTypeLabel(row.value_type)}</span>
                            <Progress value={compRate} className="h-1 flex-1" color={compRate >= 100 ? 'success' : 'primary'} />
                            <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">
                              {formatComponentAmount(row, row.current_amount)}/{formatComponentAmount(row, row.target_amount)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {goal.note ? (
                    <p className="mt-2 truncate text-[11px] italic text-muted-foreground/70">{goal.note}</p>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SimpleModal title={editing ? 'Hedefi düzenle' : 'Hedef ekle'} open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium">
            Hedef adı
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" required />
          </label>
          <label className="block text-sm font-medium">
            Hedef türü
            <Select
              value={valueType}
              onChange={(e) => setValueType(e.target.value as SavingsGoalValueType)}
              className="mt-1"
            >
              <option value="TRY">Türk lirası (TRY)</option>
              <option value="gram_altin">Gram altın</option>
              <option value="ceyrek_altin">Çeyrek altın</option>
              <option value="composite">Karma (birden fazla)</option>
            </Select>
          </label>

          {valueType === 'composite' ? (
            <div className="space-y-3 rounded-lg bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">Örn. evlilik: 29 gram + 1 çeyrek ayrı satırlarda.</p>
              {componentDrafts.map((draft, index) => (
                <div key={draft.key} className="space-y-2 rounded-lg bg-card/80 p-2.5 ring-1 ring-border/70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Bileşen {index + 1}</span>
                    {componentDrafts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setComponentDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
                        className="text-xs font-semibold text-destructive"
                      >
                        Kaldır
                      </button>
                    ) : null}
                  </div>
                  <Input
                    value={draft.label}
                    onChange={(e) =>
                      setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, label: e.target.value } : row)))
                    }
                    placeholder="Etiket (ör. Gram)"
                    className="h-10 text-sm"
                  />
                  <Select
                    value={draft.value_type}
                    onChange={(e) =>
                      setComponentDrafts((rows) =>
                        rows.map((row) =>
                          row.key === draft.key ? { ...row, value_type: e.target.value as SavingsGoalComponent['value_type'] } : row,
                        ),
                      )
                    }
                    className="h-10 text-sm"
                  >
                    <option value="TRY">TRY</option>
                    <option value="gram_altin">Gram altın</option>
                    <option value="ceyrek_altin">Çeyrek altın</option>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={draft.current_amount}
                      onChange={(e) =>
                        setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, current_amount: e.target.value } : row)))
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Biriken"
                      className="h-10 text-sm"
                    />
                    <Input
                      value={draft.target_amount}
                      onChange={(e) =>
                        setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, target_amount: e.target.value } : row)))
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Hedef"
                      className="h-10 text-sm"
                      required
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setComponentDrafts((rows) => [...rows, newComponentDraft()])}
                className="text-sm font-semibold text-primary"
              >
                + Bileşen ekle
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">
                  Hedef miktar
                  <Input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} type="number" min="0" step="0.01" className="mt-1" required />
                </label>
                <label className="block text-sm font-medium">
                  Biriken miktar
                  <Input value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} type="number" min="0" step="0.01" className="mt-1" required />
                </label>
              </div>
              {valueType === 'gram_altin' || valueType === 'ceyrek_altin' ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium">
                    Değerleme
                    <Select value={autoValued ? 'auto' : 'manual'} onChange={(e) => setAutoValued(e.target.value === 'auto')} className="mt-1">
                      <option value="auto">Otomatik (canlı kur)</option>
                      <option value="manual">Manuel</option>
                    </Select>
                  </label>
                  {autoValued ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5 text-sm">
                      <span className="text-muted-foreground">Güncel değer: </span>
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        {(() => {
                          const live = valueGoal({ value_type: valueType, current_amount: parseNumber(currentAmount) }, snapshot)
                          return live === null ? 'Kur bekleniyor…' : formatAmount(live)
                        })()}
                      </span>
                    </div>
                  ) : (
                    <label className="block text-sm font-medium">
                      Tahmini değer (TRY)
                      <Input value={estimatedValueTry} onChange={(e) => setEstimatedValueTry(e.target.value)} type="number" min="0" step="0.01" className="mt-1" />
                    </label>
                  )}
                </div>
              ) : null}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Hedef tarih
              <Input value={targetDate} onChange={(e) => setTargetDate(e.target.value)} type="date" className="mt-1" />
            </label>
            <label className="block text-sm font-medium">
              Durum
              <Select value={status} onChange={(e) => setStatus(e.target.value as SavingsGoal['status'])} className="mt-1">
                <option value="active">Aktif</option>
                <option value="completed">Tamamlandı</option>
              </Select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Not
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" />
          </label>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </form>
      </SimpleModal>
      {confirmDialog}
    </section>
  )
}
