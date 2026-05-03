import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
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
  type: 'text' | 'number' | 'date' | 'select' | 'textarea'
  required?: boolean
  step?: string
  min?: string
  options?: FieldOption[]
  visibleWhen?: {
    field: string
    value: string
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
  getCardClassName?: (row: RowFor<T>) => string
  getDetailClassName?: (row: RowFor<T>) => string
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
}: CrudPageProps<T>) {
  const { user } = useAuth()
  const [rows, setRows] = useState<RowFor<T>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RowFor<T> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [formValues, setFormValues] = useState<Record<string, string>>({})

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
        <p className="text-sm text-stone-500">{rows.length} kayıt</p>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={17} />
          {addLabel}
        </button>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <p className="rounded-lg bg-white p-4 text-sm text-stone-500">Kayıtlar yükleniyor...</p>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className={`rounded-lg border bg-white p-4 shadow-sm ${getCardClassName?.(row) ?? 'border-stone-200'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-stone-950">{renderTitle(row)}</h2>
                  {renderSubtitle ? (
                    <p className="mt-1 text-sm text-stone-500">{renderSubtitle(row)}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="grid size-9 place-items-center rounded-full text-stone-500 hover:bg-stone-100"
                    aria-label="Düzenle"
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    className="grid size-9 place-items-center rounded-full text-rose-600 hover:bg-rose-50"
                    aria-label="Sil"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {renderDetails(row).map((detail) => (
                  <div
                    key={detail}
                    className={`rounded-md px-3 py-2 text-stone-700 ${getDetailClassName?.(row) ?? 'bg-stone-50'}`}
                  >
                    {detail}
                  </div>
                ))}
              </dl>
              {'note' in row && row.note ? <p className="mt-3 text-sm text-stone-500">{row.note}</p> : null}
            </article>
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
            .filter((field) => !field.visibleWhen || formValues[field.visibleWhen.field] === field.visibleWhen.value)
            .map((field) => (
              <label key={field.name} className="block text-sm font-medium text-stone-700">
                {field.label}
                {field.type === 'select' ? (
                  <select
                    name={field.name}
                    required={field.required}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-3 outline-none focus:border-emerald-600"
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
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600"
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
                      className="w-full rounded-lg border border-stone-200 px-3 py-3 pr-11 outline-none focus:border-emerald-600"
                    />
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400"
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
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-3 outline-none focus:border-emerald-600"
                  />
                )}
              </label>
            ))}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </form>
      </SimpleModal>
    </section>
  )
}

function toFormValues(values: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
}
