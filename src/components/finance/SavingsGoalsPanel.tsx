import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { useMarketRates } from '../../hooks/useMarketRates'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
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

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Birikim hedefleri</h2>
          <p className="text-sm text-muted-foreground">TL, altın veya karma hedef (ör. gram + çeyrek).</p>
        </div>
        <Button
          type="button"
          onClick={openCreate}
        >
          <Plus size={16} />
          Hedef ekle
        </Button>
      </div>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Hedefler yükleniyor...</p>
      ) : goals.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
          <CardContent className="p-4 text-sm text-muted-foreground">Henüz birikim hedefi yok.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {goals.map((goal) => {
            const rate = savingsGoalProgressRate(goal, components)
            const goalComponents = componentsByGoal.get(goal.id) ?? []

            return (
              <Card key={goal.id} className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-bold text-foreground">{goal.name}</p>
                        <Badge variant={goal.status === 'completed' ? 'default' : 'secondary'}>
                          {goal.status === 'active' ? 'Aktif' : 'Tamamlandı'}
                        </Badge>
                        {goal.value_type !== 'TRY' ? (
                          <Badge variant="outline">{savingsGoalValueTypeLabel(goal.value_type)}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatSavingsGoalProgress(goal, goalComponents)}</p>
                      {goal.value_type !== 'TRY' && goal.value_type !== 'composite' && (goal.auto_valued || goal.estimated_value_try) ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {goal.auto_valued ? 'Güncel' : 'Tahmini'}: {formatCurrency(effectiveGoalValue(goal, snapshot))}
                        </p>
                      ) : null}
                      {goal.target_date ? <p className="mt-0.5 text-xs text-muted-foreground">Hedef tarih: {formatDate(goal.target_date)}</p> : null}
                      {goal.value_type === 'composite' && goalComponents.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {goalComponents.map((row) => (
                            <li key={row.id} className="text-xs text-muted-foreground">
                              {row.label?.trim() || savingsGoalValueTypeLabel(row.value_type)}: {formatComponentAmount(row, row.current_amount)} /{' '}
                              {formatComponentAmount(row, row.target_amount)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => openEdit(goal)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(goal)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <Progress value={rate} className="mt-3 h-1.5" />
                  <p className="mt-1 text-right text-xs text-muted-foreground">%{Math.round(rate)}</p>
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
                          return live === null ? 'Kur bekleniyor…' : formatCurrency(live)
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
