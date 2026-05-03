import { CalendarDays, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { InsertFor, RowFor, TableName, UpdateFor } from '../types/database'
import { EmptyState } from './EmptyState'
import { SimpleModal } from './SimpleModal'

type FieldOption = {
  label: string
  value: string
}

export type FormField = {
  name: string
  label: string
  type: 'text' | 'number' | 'date' | 'day' | 'select' | 'textarea'
  required?: boolean
  step?: string
  min?: string
  options?: FieldOption[]
  visibleWhen?: {
    field: string
    value: string | string[]
  }
}

type CrudPageProps<T extends TableName> = {
  table: T
  addLabel: string
  fields: FormField[]
  emptyTitle: string
  emptyDescription: string
  orderBy?: keyof RowFor<T> & string
  getInitialValues: (row?: RowFor<T>) => Record<string, string | number>
  mapForm: (formData: FormData, userId: string) => InsertFor<T> | UpdateFor<T>
  renderTitle: (row: RowFor<T>) => string
  renderSubtitle?: (row: RowFor<T>) => string
  renderDetails: (row: RowFor<T>) => string[]
  getCardClassName?: (row: RowFor<T>, rows: RowFor<T>[]) => string
  getDetailClassName?: (row: RowFor<T>, rows: RowFor<T>[]) => string
  getCardStyle?: (row: RowFor<T>, rows: RowFor<T>[]) => CSSProperties
  getDetailStyle?: (row: RowFor<T>, rows: RowFor<T>[]) => CSSProperties
  groupBy?: (row: RowFor<T>) => string
  getGroupClassName?: (group: string) => string
  renderRowActions?: (row: RowFor<T>, helpers: { reload: () => Promise<void>; setError: (message: string) => void; rows: RowFor<T>[] }) => ReactNode
}

export function CrudPage<T extends TableName>({
  table,
  addLabel,
  fields,
  emptyTitle,
  emptyDescription,
  orderBy = 'created_at' as keyof RowFor<T> & string,
  getInitialValues,
  mapForm,
  renderTitle,
  renderSubtitle,
  renderDetails,
  getCardClassName,
  getDetailClassName,
  getCardStyle,
  getDetailStyle,
  groupBy,
  getGroupClassName,
  renderRowActions,
}: CrudPageProps<T>) {
  const { user } = useAuth()
  const [rows, setRows] = useState<RowFor<T>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RowFor<T> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from(table as never)
      .select('*')
      .order(orderBy, { ascending: orderBy.includes('date') || orderBy.includes('day') })

    if (loadError) setError(loadError.message)
    setRows((data ?? []) as unknown as RowFor<T>[])
    setLoading(false)
  }, [orderBy, table])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows()
  }, [loadRows])

  function openCreate() {
    setEditing(null)
    setFormValues(toFormValues(getInitialValues()))
    setModalOpen(true)
  }

  function openEdit(row: RowFor<T>) {
    setEditing(row)
    setFormValues(toFormValues(getInitialValues(row)))
    setModalOpen(true)
  }

  function updateFormValue(name: string, value: string) {
    setFormValues((current) => ({ ...current, [name]: value }))
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm('Bu kaydı silmek istiyor musun?')
    if (!confirmed) return

    const { error: deleteError } = await supabase.from(table as never).delete().eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setRows((current) => current.filter((row) => row.id !== id))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    setSaving(true)
    setError('')
    const payload = mapForm(new FormData(event.currentTarget), user.id)

    const response = editing
      ? await supabase
          .from(table as never)
          .update(payload as never)
          .eq('id', editing.id)
          .select()
          .single()
      : await supabase.from(table as never).insert(payload as never).select().single()

    if (response.error) {
      setError(response.error.message)
      setSaving(false)
      return
    }

    setModalOpen(false)
    setEditing(null)
    setSaving(false)
    await loadRows()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-500 dark:text-stone-400">{rows.length} kayıt</p>
        <button
          type="button"
          onClick={openCreate}
          className="hidden items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm sm:inline-flex"
        >
          <Plus size={17} />
          {addLabel}
        </button>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <p className="rounded-lg bg-white p-4 text-sm text-stone-500 dark:bg-stone-900 dark:text-stone-400">Kayıtlar yükleniyor...</p>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="space-y-5">
          {groupRows(rows, groupBy).map(({ group, items }) => (
            <section key={group} className="space-y-3">
              {groupBy ? (
                <h2
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${getGroupClassName?.(group) ?? 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200'}`}
                >
                  {group}
                </h2>
              ) : null}
              {items.map((row) => (
                <article
                  key={row.id}
                  style={getCardStyle?.(row, rows)}
                  className={`rounded-xl border bg-white p-3 shadow-md transition-all hover:shadow-lg hover:-translate-y-0.5 dark:bg-stone-900 min-[390px]:p-4 ${getCardClassName?.(row, rows) ?? 'border-stone-200 dark:border-stone-800'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold text-stone-950 dark:text-stone-50">{renderTitle(row)}</h2>
                      {renderSubtitle ? (
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{renderSubtitle(row)}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {renderRowActions ? (
                        <div className="flex flex-wrap gap-2">{renderRowActions(row, { reload: loadRows, setError, rows })}</div>
                      ) : null}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setMenuOpenId(menuOpenId === row.id ? null : row.id)}
                          className="grid size-9 place-items-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                          aria-label="Menü"
                        >
                          <MoreVertical size={18} />
                        </button>
                        {menuOpenId === row.id && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpenId(null)
                                openEdit(row)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                            >
                              <Pencil size={14} />
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuOpenId(null)
                                void handleDelete(row.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 size={14} />
                              Sil
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-1 gap-2 text-sm min-[390px]:grid-cols-2">
                    {renderDetails(row).map((detail) => (
                      <div
                        key={detail}
                        style={getDetailStyle?.(row, rows)}
                        className={`min-w-0 break-words rounded-lg px-3 py-2.5 text-stone-700 dark:text-stone-200 ${getDetailClassName?.(row, rows) ?? 'bg-stone-50 dark:bg-stone-800'}`}
                      >
                        {detail}
                      </div>
                    ))}
                  </dl>
                  {'note' in row && row.note ? <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{row.note}</p> : null}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      <SimpleModal
        title={editing ? 'Kaydı düzenle' : addLabel}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields
            .filter(
              (field) =>
                !field.visibleWhen ||
                (Array.isArray(field.visibleWhen.value)
                  ? field.visibleWhen.value.includes(formValues[field.visibleWhen.field])
                  : formValues[field.visibleWhen.field] === field.visibleWhen.value),
            )
            .map((field) => (
              <label key={field.name} className="block text-sm font-medium text-stone-700 dark:text-stone-200">
                {field.label}
                {field.type === 'select' ? (
                  <select
                    name={field.name}
                    required={field.required}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    name={field.name}
                    rows={3}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  />
                ) : field.type === 'date' ? (
                  <div className="relative mt-1">
                    <input
                      name={field.name}
                      type="date"
                      required={field.required}
                      value={formValues[field.name] ?? ''}
                      onClick={(event) => event.currentTarget.showPicker?.()}
                      onFocus={(event) => event.currentTarget.showPicker?.()}
                      onChange={(event) => updateFormValue(field.name, event.target.value)}
                      className="w-full rounded-lg border border-stone-200 px-3 py-3 pr-11 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    />
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                    />
                  </div>
                ) : field.type === 'day' ? (
                  <div className="relative mt-1">
                    <select
                      name={field.name}
                      required={field.required}
                      value={formValues[field.name] ?? ''}
                      onChange={(event) => updateFormValue(field.name, event.target.value)}
                      className="w-full appearance-none rounded-lg border border-stone-200 bg-white px-3 py-3 pr-11 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    >
                      <option value="">Gün seç</option>
                      {Array.from({ length: 31 }, (_, index) => {
                        const day = String(index + 1)
                        return (
                          <option key={day} value={day}>
                            Her ayın {day}. günü
                          </option>
                        )
                      })}
                    </select>
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                    />
                  </div>
                ) : (
                  <input
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    min={field.min}
                    step={field.step}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  />
                )}
              </label>
            ))}
          <button
            type="submit"
            disabled={saving}
            className="sticky bottom-0 z-10 w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_-10px_24px_rgba(255,255,255,0.9)] disabled:opacity-60 dark:shadow-[0_-10px_24px_rgba(12,10,9,0.9)] sm:static sm:shadow-none"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </SimpleModal>

      <button
        type="button"
        onClick={openCreate}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.4rem)] right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 active:scale-[0.98] sm:hidden"
      >
        <Plus size={18} />
        Ekle
      </button>
    </section>
  )
}

function toFormValues(values: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
}

function groupRows<T>(rows: T[], groupBy?: (row: T) => string) {
  if (!groupBy) return [{ group: 'all', items: rows }]

  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groupBy(row)
    groups.set(group, [...(groups.get(group) ?? []), row])
  }

  return Array.from(groups, ([group, items]) => ({ group, items }))
}
