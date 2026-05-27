import { useMemo } from 'react'
import { expenseCategoryOptions, inferExpenseCategory } from '../../utils/categories'

type CategoryPickerProps = {
  label?: string
  value: string
  description: string
  onChange: (value: string) => void
}

export function CategoryPicker({ label = 'Kategori', value, description, onChange }: CategoryPickerProps) {
  const suggestedCategory = useMemo(() => inferExpenseCategory(description), [description])
  const suggestedOption = expenseCategoryOptions.find((option) => option.value === suggestedCategory)
  const showSuggestion = Boolean(suggestedOption && suggestedOption.value !== value)

  return (
    <div className="min-w-0">
      <label className="block min-w-0 text-sm font-medium text-stone-700 dark:text-stone-200">
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2.5 outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        >
          {expenseCategoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {showSuggestion ? (
        <button
          type="button"
          onClick={() => onChange(suggestedOption?.value ?? value)}
          className="mt-2 inline-flex w-fit items-center rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/70"
        >
          Kategori önerisi: {suggestedOption?.label}
        </button>
      ) : null}
    </div>
  )
}
