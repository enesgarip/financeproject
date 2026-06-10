import { useEffect, useMemo, useRef } from 'react'
import { type CategoryMemory, expenseCategoryOptions, explainExpenseCategory } from '../../utils/categories'

type CategoryPickerProps = {
  label?: string
  value: string
  description: string
  onChange: (value: string) => void
  /** Learned (description → category) lookup from the user's past expenses. */
  memory?: CategoryMemory
  /** When true, the suggested category is auto-filled until the user picks one by hand. */
  autoApply?: boolean
}

function suggestionReason(source: 'memory-exact' | 'memory-partial' | 'keyword', match: string) {
  if (source === 'keyword') return `"${match}" anahtar kelimesi eşleşti`
  return `daha önce "${match}" kaydını böyle kategorilendirdin`
}

export function CategoryPicker({ label = 'Kategori', value, description, onChange, memory, autoApply = false }: CategoryPickerProps) {
  const suggestion = useMemo(() => explainExpenseCategory(description, memory), [description, memory])
  const suggestedCategory = suggestion?.category ?? null
  const suggestedOption = expenseCategoryOptions.find((option) => option.value === suggestedCategory)

  // Track whether the user has chosen a category by hand. Reset when the field
  // is cleared (a new entry), so auto-fill kicks back in for the next expense.
  const manuallyChosen = useRef(false)
  const trimmed = description.trim()

  useEffect(() => {
    if (!trimmed) manuallyChosen.current = false
  }, [trimmed])

  useEffect(() => {
    if (!autoApply || manuallyChosen.current) return
    if (suggestedCategory && suggestedCategory !== value) onChange(suggestedCategory)
  }, [autoApply, suggestedCategory, value, onChange])

  const showSuggestion = Boolean(suggestedOption && suggestedOption.value !== value)

  return (
    <div className="min-w-0">
      <label className="block min-w-0 text-sm font-semibold text-foreground">
        {label}
        <select
          value={value}
          onChange={(event) => {
            manuallyChosen.current = true
            onChange(event.target.value)
          }}
          className="mt-1 w-full min-w-0 rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
        >
          {expenseCategoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {showSuggestion && suggestion ? (
        <button
          type="button"
          onClick={() => {
            manuallyChosen.current = true
            onChange(suggestion.category)
          }}
          className="mt-2 block w-full rounded-lg bg-success/8 px-3 py-2 text-left text-xs font-semibold text-success ring-1 ring-success/20 transition hover:bg-success/15"
        >
          Öneri: {suggestedOption?.label} — {suggestionReason(suggestion.source, suggestion.match)}. Uygulamak için dokun.
        </button>
      ) : null}
      {value && suggestion && suggestion.category === value ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Neden {value}? {suggestionReason(suggestion.source, suggestion.match)}. Değiştirirsen bundan sonra senin seçimin önerilir.
        </p>
      ) : null}
    </div>
  )
}
