import { CalendarDays, MoreVertical, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import type { InsertFor, RowFor, TableName, UpdateFor } from '../types/database'
import { EmptyState } from './EmptyState'
import { FormSection } from './finance/FinanceUI'
import { SimpleModal } from './SimpleModal'
import { Alert } from './ui/alert'
import { Button } from './ui/button'
import { ConfirmDialog } from './ui/confirm-dialog'
import { Input, Select, Textarea } from './ui/input'
import { Skeleton } from './ui/skeleton'

type FieldOption = {
  label: string
  value: string
}

type FormErrors = Record<string, string>
type SaveAction = 'create' | 'update'

type RowMeta = {
  title: string
  subtitle: string
  details: string[]
  note: string
  searchText: string
}

/** Extra data threaded into a form so computed fields can react to it (e.g. live market rates). */
export type FieldContext = unknown

export type FieldVisibility =
  | { field: string; value: string | string[] }
  | ((values: Record<string, string>) => boolean)

export type FormField = {
  name: string
  label: string
  type: 'text' | 'number' | 'date' | 'day' | 'select' | 'textarea' | 'computed'
  required?: boolean
  step?: string
  min?: string
  options?: FieldOption[]
  visibleWhen?: FieldVisibility
  /** type 'computed': derive a read-only value from current form values + context. */
  compute?: (values: Record<string, string>, context: FieldContext) => number | null
  /** type 'computed': format the derived value for display (defaults to String). */
  formatComputed?: (value: number | null) => string
  /** Optional helper line rendered under the field. */
  hint?: (values: Record<string, string>, context: FieldContext) => string | null
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
  mapForm: (formData: FormData, userId: string, editing: RowFor<T> | null, context: FieldContext) => InsertFor<T> | UpdateFor<T>
  /** Arbitrary context (e.g. live market rates) forwarded to computed fields and mapForm. */
  fieldContext?: FieldContext
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
  renderCard?: (
    row: RowFor<T>,
    helpers: {
      meta: RowMeta
      reload: () => Promise<void>
      setError: (message: string) => void
      rows: RowFor<T>[]
      menu: ReactNode
      rowActions: ReactNode
    },
  ) => ReactNode
  renderBeforeList?: (helpers: { loading: boolean; rows: RowFor<T>[]; reload: () => Promise<void>; setError: (message: string) => void }) => ReactNode
  renderAfterList?: (helpers: { loading: boolean; rows: RowFor<T>[]; reload: () => Promise<void>; setError: (message: string) => void }) => ReactNode
  /** false ise dahili kayıt listesi (kart ızgarası) gizlenir; sayfa içi sekmeler için kullanılır. */
  showList?: boolean
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
  fieldContext,
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
  renderCard,
  renderBeforeList,
  renderAfterList,
  showList = true,
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
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const visibleFields = fields.filter((field) => isFieldVisible(field, formValues))
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const rowMeta = useMemo(() => {
    const map = new Map<string, RowMeta>()

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

  async function confirmDelete() {
    if (!deleteId) return

    setDeleting(true)
    const { error: deleteError } = await supabase.from(table as never).delete().eq('id', deleteId)
    if (deleteError) {
      setError(deleteError.message)
      setDeleting(false)
      return
    }
    setRows((current) => current.filter((row) => row.id !== deleteId))
    setDeleteId(null)
    setDeleting(false)
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
    const payload = mapForm(formData, user.id, editing, fieldContext)
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
    <section className="flex flex-col gap-5">
      <div className="finance-hero-panel relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-info to-warning opacity-80" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground">{pageTitle ?? addLabel}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {normalizedQuery ? `${visibleRows.length} / ${rows.length} kayıt gösteriliyor` : `${rows.length} kayıt bulundu`}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(14rem,18rem)_auto] sm:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kayıtlarda ara"
                className="pl-9 text-sm"
              />
            </label>
            <Button type="button" onClick={openCreate} className="h-11 gap-2 px-4">
              <Plus data-icon="inline-start" />
              {addLabel}
            </Button>
          </div>
        </div>
      </div>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {renderBeforeList ? renderBeforeList({ loading, rows, reload: loadRows, setError }) : null}

      {!showList ? null : loading ? (
        <div className="grid gap-3 min-[760px]:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="rounded-2xl border border-border/50 bg-card p-4 shadow-[var(--shadow-card)] min-[390px]:p-5">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-3 h-3.5 w-1/2" />
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Skeleton className="h-14 rounded-xl" />
                <Skeleton className="h-14 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button type="button" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              {addLabel}
            </Button>
          }
        />
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
              <div className="grid gap-3 min-[760px]:grid-cols-2 xl:grid-cols-3">
                {items.map((row) => {
                  const meta = rowMeta.get(row.id)
                  const title = meta?.title ?? renderTitle(row)
                  const subtitle = meta?.subtitle ?? renderSubtitle?.(row) ?? ''
                  const details = meta?.details ?? renderDetails(row)
                  const note = meta?.note ?? ('note' in row && row.note ? String(row.note) : '')
                  const resolvedMeta: RowMeta = {
                    title,
                    subtitle,
                    details,
                    note,
                    searchText: meta?.searchText ?? [title, subtitle, ...details, note].join(' ').toLocaleLowerCase('tr-TR'),
                  }
                  const rowMenu = (
                    <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpenId(menuOpenId === row.id ? null : row.id)
                          }}
                          className="grid size-10 place-items-center rounded-lg border border-border/70 bg-background/55 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          aria-label="Menu"
                        >
                          <MoreVertical size={18} />
                        </button>
                        {menuOpenId === row.id && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-elevated)]">
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
                                setDeleteId(row.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 size={14} />
                              Sil
                            </button>
                          </div>
                        )}
                    </div>
                  )
                  const rowActions = renderRowActions ? (
                    <div className="mt-3 flex flex-wrap gap-2">{renderRowActions(row, { reload: loadRows, setError, rows })}</div>
                  ) : null

                  if (renderCard) {
                    return (
                      <div key={row.id} className="min-w-0">
                        {renderCard(row, { meta: resolvedMeta, reload: loadRows, setError, rows, menu: rowMenu, rowActions })}
                      </div>
                    )
                  }

                  return (
                    <article
                      key={row.id}
                      style={getCardStyle?.(row, rows)}
                      className={cn(
                        'min-w-0 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)] dark:ring-1 dark:ring-white/[0.04] min-[390px]:p-5',
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
                          className="grid size-10 place-items-center rounded-lg border border-border/70 bg-background/55 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          aria-label="Menü"
                        >
                          <MoreVertical size={18} />
                        </button>
                        {menuOpenId === row.id && (
                          <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-elevated)]">
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
                                setDeleteId(row.id)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
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
                    {details.map((detail) => {
                      const parsedDetail = splitDetail(detail)

                      return (
                        <div
                          key={detail}
                          style={getDetailStyle?.(row, rows)}
                          className={cn(
                            'min-w-0 rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5',
                            getDetailClassName?.(row, rows) ?? 'bg-muted/40',
                          )}
                        >
                          {parsedDetail ? (
                            <>
                              <dt className="finance-label truncate">{parsedDetail.label}</dt>
                              <dd className="mt-1 break-words font-mono text-sm font-bold leading-snug text-foreground">{parsedDetail.value}</dd>
                            </>
                          ) : (
                            <span className="break-words text-sm font-semibold text-foreground/85">{detail}</span>
                          )}
                        </div>
                      )
                    })}
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

      {!loading && rows.length > 0 && renderAfterList ? renderAfterList({ loading, rows, reload: loadRows, setError }) : null}

      <SimpleModal
        title={editing ? 'Kaydı düzenle' : addLabel}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <FormSection
            title={editing ? 'Kayıt bilgileri' : 'Yeni kayıt bilgileri'}
            description="Zorunlu alanları doldur; para ve tarih alanları finans hesaplamalarına doğrudan yansır."
          >
          {visibleFields.map((field) => {
            const fieldError = formErrors[field.name]
            const hintText = field.hint?.(formValues, fieldContext) ?? null

            return (
              <label key={field.name} className={cn('block text-sm font-semibold text-foreground', field.type === 'textarea' && 'sm:col-span-2')}>
                <span>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </span>
                {field.type === 'select' ? (
                  <Select
                    name={field.name}
                    required={field.required}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    aria-invalid={Boolean(fieldError)}
                    className="mt-1"
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : field.type === 'textarea' ? (
                  <Textarea
                    name={field.name}
                    rows={3}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    aria-invalid={Boolean(fieldError)}
                    className="mt-1"
                  />
                ) : field.type === 'date' ? (
                  <div className="relative mt-1">
                    <Input
                      name={field.name}
                      type="date"
                      required={field.required}
                      value={formValues[field.name] ?? ''}
                      onClick={(event) => event.currentTarget.showPicker?.()}
                      onFocus={(event) => event.currentTarget.showPicker?.()}
                      onChange={(event) => updateFormValue(field.name, event.target.value)}
                      aria-invalid={Boolean(fieldError)}
                      className="max-w-full pr-11"
                    />
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                ) : field.type === 'day' ? (
                  <div className="relative mt-1">
                    <Select
                      name={field.name}
                      required={field.required}
                      value={formValues[field.name] ?? ''}
                      onChange={(event) => updateFormValue(field.name, event.target.value)}
                      aria-invalid={Boolean(fieldError)}
                      className="appearance-none pr-11"
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
                    </Select>
                    <CalendarDays
                      aria-hidden="true"
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                ) : field.type === 'computed' ? (
                  <div className="mt-1 flex min-h-[2.5rem] items-center rounded-xl border border-dashed border-border bg-muted/40 px-3 text-sm font-mono font-semibold tabular-nums text-foreground">
                    {(field.formatComputed ?? defaultFormatComputed)(field.compute?.(formValues, fieldContext) ?? null)}
                  </div>
                ) : (
                  <Input
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    min={field.min}
                    step={field.step}
                    value={formValues[field.name] ?? ''}
                    onChange={(event) => updateFormValue(field.name, event.target.value)}
                    aria-invalid={Boolean(fieldError)}
                    className="mt-1"
                  />
                )}
                {fieldError ? <span className="mt-1 block text-xs font-medium text-destructive">{fieldError}</span> : null}
                {hintText ? <span className="mt-1 block text-xs text-muted-foreground">{hintText}</span> : null}
              </label>
            )
          })}
          </FormSection>
          <Button
            type="submit"
            disabled={saving}
            className="sticky bottom-0 z-10 h-12 w-full shadow-[0_-10px_24px_rgba(255,255,255,0.9)] dark:shadow-[0_-10px_24px_rgba(12,10,9,0.9)] sm:static sm:shadow-none"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </form>
      </SimpleModal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Kaydı sil"
        description="Bu kayıt kalıcı olarak silinecek. İşlemi onaylamadan önce doğru kaydı seçtiğinden emin ol."
        confirmLabel="Sil"
        variant="destructive"
        loading={deleting}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
      />

    </section>
  )
}

function toFormValues(values: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))
}

function defaultFormatComputed(value: number | null) {
  return value === null ? '—' : String(value)
}

function isFieldVisible(field: FormField, values: Record<string, string>) {
  if (!field.visibleWhen) return true
  if (typeof field.visibleWhen === 'function') return field.visibleWhen(values)

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

function splitDetail(detail: string) {
  const separatorIndex = detail.indexOf(':')
  if (separatorIndex <= 0) return null

  return {
    label: detail.slice(0, separatorIndex).trim(),
    value: detail.slice(separatorIndex + 1).trim(),
  }
}
