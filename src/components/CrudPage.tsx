import { CalendarDays, MoreVertical, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import type { InsertFor, RowFor, TableName, UpdateFor } from '../types/database'
import { EmptyState } from './EmptyState'
import { SimpleModal } from './SimpleModal'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'

type FieldOption = {
  label: string
  value: string
}

type FormErrors = Record<string, string>
type SaveAction = 'create' | 'update'

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
  pageTitle?: string
  fields: FormField[]
  emptyTitle: string
  emptyDescription: string
  orderBy?: keyof RowFor<T> & string
  orderAscending?: boolean
  getInitialValues: (row?: RowFor<T>) => Record<string, string | number>
  mapForm: (formData: FormData, userId: string, editing: RowFor<T> | null) => InsertFor<T> | UpdateFor<T>
  validateForm?: (formData: FormData, values: Record<string, string>, editing: RowFor<T> | null) => FormErrors
  afterSave?: (row: RowFor<T>, action: SaveAction, helpers: { reload: () => Promise<void>; setError: (message: string) => void }) => Promise<void> | void
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
  renderMenuActions?: (row: RowFor<T>, helpers: { reload: () => Promise<void>; setError: (message: string) => void; rows: RowFor<T>[]; closeMenu: () => void }) => ReactNode
  renderExtra?: (row: RowFor<T>, helpers: { reload: () => Promise<void>; setError: (message: string) => void; rows: RowFor<T>[] }) => ReactNode
  renderBeforeList?: (helpers: { loading: boolean; rows: RowFor<T>[]; reload: () => Promise<void>; setError: (message: string) => void }) => ReactNode
}

export function CrudPage<T extends TableName>({
  table,
  addLabel,
  pageTitle,
  fields,
  emptyTitle,
  emptyDescription,
  orderBy = 'created_at' as keyof RowFor<T> & string,
  orderAscending,
  getInitialValues,
  mapForm,
  validateForm,
  afterSave,
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
  renderMenuActions,
  renderExtra,
  renderBeforeList,
}: CrudPageProps<T>) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<RowFor<T>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RowFor<T> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const visibleFields = fields.filter((field) => isFieldVisible(field, formValues))
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const rowMeta = useMemo(() => {
    const map = new Map<string, { title: string; subtitle: string; details: string[]; note: string; searchText: string }>()

    for (const row of rows) {
      const title = renderTitle(row)
      const subtitle = renderSubtitle?.(row) ?? ''
      const details = renderDetails(row)
      const note = 'note' in row && row.note ? String(row.note) : ''
      map.set(row.id, {
        title,
        subtitle,
        details,
        note,
        searchText: [title, subtitle, ...details, note].join(' ').toLocaleLowerCase('tr-TR'),
      })
    }

    return map
  }, [renderDetails, renderSubtitle, renderTitle, rows])
  const visibleRows = useMemo(
    () => (normalizedQuery ? rows.filter((row) => rowMeta.get(row.id)?.searchText.includes(normalizedQuery)) : rows),
    [normalizedQuery, rowMeta, rows],
  )
  const groupedVisibleRows = useMemo(() => groupRows(visibleRows, groupBy), [groupBy, visibleRows])

  useEffect(() => {
    function handleClickOutside() {
      setMenuOpenId(null)
    }

    if (menuOpenId) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [menuOpenId])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from(table as never)
      .select('*')
      .order(orderBy, { ascending: orderAscending ?? (orderBy.includes('date') || orderBy.includes('day')) })

    if (loadError) setError(loadError.message)
    setRows((data ?? []) as unknown as RowFor<T>[])
    setLoading(false)
  }, [orderAscending, orderBy, table])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows()
  }, [loadRows])

  const openCreate = useCallback(() => {
    setEditing(null)
    setFormValues(toFormValues(getInitialValues()))
    setFormErrors({})
    setFormError('')
    setModalOpen(true)
  }, [getInitialValues])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('new') !== '1') return

    const openTimer = window.setTimeout(() => {
      openCreate()
      params.delete('new')
      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : '',
        },
        { replace: true },
      )
    }, 0)

    return () => window.clearTimeout(openTimer)
  }, [location.pathname, location.search, navigate, openCreate])

  function openEdit(row: RowFor<T>) {
    setEditing(row)
    setFormValues(toFormValues(getInitialValues(row)))
    setFormErrors({})
    setFormError('')
    setModalOpen(true)
  }

  function updateFormValue(name: string, value: string) {
    setFormValues((current) => ({ ...current, [name]: value }))
    setFormErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
    setFormError('')
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

    const formData = new FormData(event.currentTarget)
    const validationErrors = {
      ...validateFields(visibleFields, formData),
      ...(validateForm?.(formData, formValues, editing) ?? {}),
    }
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors)
      setFormError('Lütfen zorunlu alanları ve hatalı değerleri kontrol et.')
      return
    }

    setSaving(true)
    setError('')
    setFormError('')
    const payload = mapForm(formData, user.id, editing)
    const action: SaveAction = editing ? 'update' : 'create'

    const response = editing
      ? await supabase
          .from(table as never)
          .update(payload as never)
          .eq('id', editing.id)
          .select()
          .single()
      : await supabase.from(table as never).insert(payload as never).select().single()
    const savedResponse = response as unknown as { data: unknown; error: { message: string } | null }

    if (savedResponse.error) {
      setError(savedResponse.error.message)
      setSaving(false)
      return
    }

    if (savedResponse.data) {
      try {
        await afterSave?.(savedResponse.data as RowFor<T>, action, { reload: loadRows, setError })
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Kayıt sonrası işlem tamamlanamadı.')
        setSaving(false)
        return
      }
    }

    setModalOpen(false)
    setEditing(null)
    setFormErrors({})
    setSaving(false)
    await loadRows()
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-lg border border-border/75 bg-card p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-foreground">{pageTitle ?? addLabel}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {normalizedQuery ? `${visibleRows.length} / ${rows.length} kayıt gösteriliyor` : `${rows.length} kayıt bulundu`}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kayıtlarda ara"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/15"
              />
            </label>
            <Button type="button" onClick={openCreate} className="h-10 gap-2 px-4">
              <Plus data-icon="inline-start" />
              {addLabel}
            </Button>
          </div>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {renderBeforeList ? renderBeforeList({ loading, rows, reload: loadRows, setError }) : null}

      {loading ? (
        <div className="grid gap-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : visibleRows.length === 0 ? (
        <EmptyState title="Eşleşen kayıt yok" description="Arama metnini temizleyerek tüm kayıtları tekrar görebilirsin." />
      ) : (
        <div className="flex flex-col gap-5">
          {groupedVisibleRows.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-3">
              {groupBy ? (
                <div className="flex items-center gap-3 px-1 py-1">
                  <h2
                    className={cn('shrink-0 text-xs font-black uppercase text-muted-foreground', getGroupClassName?.(group))}
                  >
                    {group}
                  </h2>
                  <span className="h-px flex-1 bg-gradient-to-r from-border via-border/60 to-transparent" />
                </div>
              ) : null}
              <div className="flex flex-col gap-3">
                {items.map((row) => {
                  const meta = rowMeta.get(row.id)
                  const title = meta?.title ?? renderTitle(row)
                  const subtitle = meta?.subtitle ?? renderSubtitle?.(row) ?? ''
                  const details = meta?.details ?? renderDetails(row)
                  const note = meta?.note ?? ('note' in row && row.note ? String(row.note) : '')

                  return (
                    <article
                      key={row.id}
                      style={getCardStyle?.(row, rows)}
                      className={cn(
                        'rounded-lg border bg-card p-4 shadow-[0_8px_26px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:shadow-black/20 min-[390px]:p-5',
                        getCardClassName?.(row, rows) ?? 'border-border/75',
                      )}
                    >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-black text-foreground">{title}</h2>
                      {subtitle ? (
                        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                      ) : null}
                    </div>
                    <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpenId(menuOpenId === row.id ? null : row.id)
                          }}
                          className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Menü"
                        >
                          <MoreVertical size={18} />
                        </button>
                        {menuOpenId === row.id && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-border bg-popover py-1 shadow-lg">
                            {renderMenuActions ? renderMenuActions(row, { reload: loadRows, setError, rows, closeMenu: () => setMenuOpenId(null) }) : null}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setMenuOpenId(null)
                                openEdit(row)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                            >
                              <Pencil size={14} />
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
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
                  {renderRowActions ? (
                    <div className="mt-3 flex flex-wrap gap-2">{renderRowActions(row, { reload: loadRows, setError, rows })}</div>
                  ) : null}
                  <dl className="mt-4 grid grid-cols-1 gap-2 text-sm min-[390px]:grid-cols-2">
                    {details.map((detail) => (
                      <div
                        key={detail}
                        style={getDetailStyle?.(row, rows)}
                        className={cn(
                          'min-w-0 break-words rounded-lg px-3 py-2.5 text-foreground/85',
                          getDetailClassName?.(row, rows) ?? 'bg-muted/55',
                        )}
                      >
                        {detail}
                      </div>
                    ))}
                  </dl>
                  {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}
                  {renderExtra ? renderExtra(row, { reload: loadRows, setError, rows }) : null}
                </article>
                  )
                })}
            </div>
            </section>
          ))}
        </div>
      )}

      <SimpleModal
        title={editing ? 'Kaydı düzenle' : addLabel}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {formError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{formError}</p> : null}
          {visibleFields.map((field) => {
            const fieldError = formErrors[field.name]
            const fieldBorder = fieldError
              ? 'border-destructive focus:border-destructive'
              : 'border-input focus:border-ring'

            return (
              <label key={field.name} className="block text-sm font-semibold text-foreground">
                <span>
                  {field.label}
                  {field.required ? <span className="text-rose-500"> *</span> : null}
                </span>
                {field.type === 'select' ? (
                  <select
                    name={field.name}
                    required={field.required}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    aria-invalid={Boolean(fieldError)}
                    className={`mt-1 w-full rounded-lg border bg-background px-3 py-3 outline-none transition focus:ring-3 focus:ring-ring/15 ${fieldBorder}`}
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
                    aria-invalid={Boolean(fieldError)}
                    className={`mt-1 w-full rounded-lg border bg-background px-3 py-3 outline-none transition focus:ring-3 focus:ring-ring/15 ${fieldBorder}`}
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
                      aria-invalid={Boolean(fieldError)}
                      className={`min-w-0 max-w-full appearance-none rounded-lg border bg-background px-3 py-3 pr-11 text-base outline-none transition [color-scheme:light] focus:ring-3 focus:ring-ring/15 dark:[color-scheme:dark] ${fieldBorder}`}
                    />
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                ) : field.type === 'day' ? (
                  <div className="relative mt-1">
                    <select
                      name={field.name}
                      required={field.required}
                      value={formValues[field.name] ?? ''}
                      onChange={(event) => updateFormValue(field.name, event.target.value)}
                      aria-invalid={Boolean(fieldError)}
                      className={`w-full appearance-none rounded-lg border bg-background px-3 py-3 pr-11 outline-none transition focus:ring-3 focus:ring-ring/15 ${fieldBorder}`}
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
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
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
                    aria-invalid={Boolean(fieldError)}
                    className={`mt-1 w-full rounded-lg border bg-background px-3 py-3 outline-none transition focus:ring-3 focus:ring-ring/15 ${fieldBorder}`}
                  />
                )}
                {fieldError ? <span className="mt-1 block text-xs font-medium text-rose-600 dark:text-rose-300">{fieldError}</span> : null}
              </label>
            )
          })}
          <Button
            type="submit"
            disabled={saving}
            className="sticky bottom-0 z-10 h-11 w-full shadow-[0_-10px_24px_rgba(255,255,255,0.9)] dark:shadow-[0_-10px_24px_rgba(12,10,9,0.9)] sm:static sm:shadow-none"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </form>
      </SimpleModal>

    </section>
  )
}

function toFormValues(values: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
}

function isFieldVisible(field: FormField, values: Record<string, string>) {
  if (!field.visibleWhen) return true

  const currentValue = values[field.visibleWhen.field]
  return Array.isArray(field.visibleWhen.value)
    ? field.visibleWhen.value.includes(currentValue)
    : currentValue === field.visibleWhen.value
}

function validateFields(fields: FormField[], formData: FormData) {
  const errors: FormErrors = {}

  for (const field of fields) {
    const rawValue = String(formData.get(field.name) ?? '').trim()
    if (field.required && !rawValue) {
      errors[field.name] = 'Bu alan zorunlu.'
      continue
    }

    if (field.type === 'number' && rawValue) {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) {
        errors[field.name] = 'Geçerli bir sayı gir.'
        continue
      }

      if (field.min !== undefined && value < Number(field.min)) {
        errors[field.name] = `En az ${field.min} olmalı.`
      }
    }
  }

  return errors
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
