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
      <label className="block min-w-0 text-sm font-semibold text-foreground">
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full min-w-0 rounded-lg border border-input bg-card/80 px-3 py-2.5 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
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
          className="mt-2 inline-flex w-fit items-center rounded-full bg-success/12 px-3 py-1.5 text-xs font-bold text-success ring-1 ring-success/25 transition hover:bg-success/20"
        >
          Kategori önerisi: {suggestedOption?.label}
        </button>
      ) : null}
    </div>
  )
}
