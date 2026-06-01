import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { SimpleModal } from '../SimpleModal'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { Progress } from '../ui/progress'
import { supabase } from '../../lib/supabase'
import type { InsertFor, SavingsGoal, SavingsGoalComponent, SavingsGoalValueType, UpdateFor } from '../../types/database'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import {
  formatComponentAmount,
  formatSavingsGoalProgress,
  savingsGoalProgressRate,
  savingsGoalValueTypeLabel,
} from '../../utils/savingsGoal'

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

    const [goalsResult, componentsResult] = await Promise.all([
      supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
      supabase.from('savings_goal_components').select('*').order('sort_order', { ascending: true }),
    ])

    if (goalsResult.error) {
      setError(goalsResult.error.message)
      setGoals([])
      setComponents([])
    } else {
      setGoals((goalsResult.data ?? []) as SavingsGoal[])
      if (componentsResult.error) {
        setComponents([])
      } else {
        setComponents((componentsResult.data ?? []) as SavingsGoalComponent[])
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
    if (!window.confirm(`"${goal.name}" hedefini silmek istiyor musun?`)) return

    const { error: deleteError } = await supabase.from('savings_goals').delete().eq('id', goal.id)
    if (deleteError) {
      setError(deleteError.message)
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
      const compositeCurrentAmount = parsedComponents.filter((row) => row.current_amount + 0.01 >= row.target_amount).length
      const goalFields = {
        name: trimmedName,
        value_type: valueType,
        target_amount: isComposite ? compositeTargetAmount : parseNumber(targetAmount),
        current_amount: isComposite ? compositeCurrentAmount : parseNumber(currentAmount),
        estimated_value_try: isGold && estimatedValueTry.trim() ? parseNumber(estimatedValueTry) : null,
        target_date: targetDate || null,
        status,
        note: note.trim() || null,
      }

      let goalId = editing?.id

      if (editing) {
        const { error: updateError } = await supabase
          .from('savings_goals')
          .update({ ...goalFields, updated_at: new Date().toISOString() } satisfies UpdateFor<'savings_goals'>)
          .eq('id', editing.id)
        if (updateError) throw new Error(updateError.message)
      } else {
        const { data, error: insertError } = await supabase
          .from('savings_goals')
          .insert({ user_id: user.id, ...goalFields } satisfies InsertFor<'savings_goals'>)
          .select('id')
          .single()
        if (insertError || !data) throw new Error(insertError?.message ?? 'Hedef kaydedilemedi.')
        goalId = data.id
      }

      if (!goalId) throw new Error('Hedef kimliği oluşturulamadı.')

      if (isComposite) {
        await supabase.from('savings_goal_components').delete().eq('goal_id', goalId)
        const { error: componentError } = await supabase.from('savings_goal_components').insert(
          parsedComponents.map((row) => ({ ...row, goal_id: goalId })),
        )
        if (componentError) throw new Error(componentError.message)
      } else if (editing?.value_type === 'composite') {
        await supabase.from('savings_goal_components').delete().eq('goal_id', goalId)
      }

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
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          <Plus size={16} />
          Hedef ekle
        </button>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Hedefler yükleniyor...</p>
      ) : goals.length === 0 ? (
        <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
          <CardContent className="p-4 text-sm text-muted-foreground">Henüz birikim hedefi yok.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {goals.map((goal) => {
            const rate = savingsGoalProgressRate(goal, components)
            const goalComponents = componentsByGoal.get(goal.id) ?? []

            return (
              <Card key={goal.id} className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
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
                      {goal.estimated_value_try && goal.value_type !== 'TRY' && goal.value_type !== 'composite' ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">Tahmini: {formatCurrency(goal.estimated_value_try)}</p>
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
                      <button type="button" onClick={() => openEdit(goal)} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-800">
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(goal)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">
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
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" required />
          </label>
          <label className="block text-sm font-medium">
            Hedef türü
            <select
              value={valueType}
              onChange={(e) => setValueType(e.target.value as SavingsGoalValueType)}
              className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="TRY">Türk lirası (TRY)</option>
              <option value="gram_altin">Gram altın</option>
              <option value="ceyrek_altin">Çeyrek altın</option>
              <option value="composite">Karma (birden fazla)</option>
            </select>
          </label>

          {valueType === 'composite' ? (
            <div className="space-y-3 rounded-xl bg-amber-50/70 p-3 dark:bg-amber-950/25">
              <p className="text-xs font-medium text-amber-950 dark:text-amber-100">Örn. evlilik: 29 gram + 1 çeyrek ayrı satırlarda.</p>
              {componentDrafts.map((draft, index) => (
                <div key={draft.key} className="space-y-2 rounded-lg bg-white/80 p-2.5 dark:bg-stone-900/80">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Bileşen {index + 1}</span>
                    {componentDrafts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setComponentDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
                        className="text-xs text-rose-600"
                      >
                        Kaldır
                      </button>
                    ) : null}
                  </div>
                  <input
                    value={draft.label}
                    onChange={(e) =>
                      setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, label: e.target.value } : row)))
                    }
                    placeholder="Etiket (ör. Gram)"
                    className="w-full rounded-lg border px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
                  />
                  <select
                    value={draft.value_type}
                    onChange={(e) =>
                      setComponentDrafts((rows) =>
                        rows.map((row) =>
                          row.key === draft.key ? { ...row, value_type: e.target.value as SavingsGoalComponent['value_type'] } : row,
                        ),
                      )
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
                  >
                    <option value="TRY">TRY</option>
                    <option value="gram_altin">Gram altın</option>
                    <option value="ceyrek_altin">Çeyrek altın</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={draft.current_amount}
                      onChange={(e) =>
                        setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, current_amount: e.target.value } : row)))
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Biriken"
                      className="rounded-lg border px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
                    />
                    <input
                      value={draft.target_amount}
                      onChange={(e) =>
                        setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, target_amount: e.target.value } : row)))
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Hedef"
                      className="rounded-lg border px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
                      required
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setComponentDrafts((rows) => [...rows, newComponentDraft()])}
                className="text-sm font-semibold text-emerald-700"
              >
                + Bileşen ekle
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium">
                  Hedef miktar
                  <input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" required />
                </label>
                <label className="block text-sm font-medium">
                  Biriken miktar
                  <input value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" required />
                </label>
              </div>
              {valueType === 'gram_altin' || valueType === 'ceyrek_altin' ? (
                <label className="block text-sm font-medium">
                  Tahmini değer (TRY)
                  <input value={estimatedValueTry} onChange={(e) => setEstimatedValueTry(e.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" />
                </label>
              ) : null}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Hedef tarih
              <input value={targetDate} onChange={(e) => setTargetDate(e.target.value)} type="date" className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" />
            </label>
            <label className="block text-sm font-medium">
              Durum
              <select value={status} onChange={(e) => setStatus(e.target.value as SavingsGoal['status'])} className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900">
                <option value="active">Aktif</option>
                <option value="completed">Tamamlandı</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Not
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900" />
          </label>
          {formError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{formError}</p> : null}
          <button type="submit" disabled={saving} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </SimpleModal>
    </section>
  )
}
