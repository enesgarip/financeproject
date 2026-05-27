import { formatCurrency, parseNumber } from '../../utils/formatCurrency'

type MoneyInputProps = {
  label: string
  value: string
  onValueChange: (value: string) => void
  required?: boolean
  placeholder?: string
  className?: string
  onParsedChange?: (value: number) => void
}

export function MoneyInput({
  label,
  value,
  onValueChange,
  required,
  placeholder = '0.00',
  className = '',
  onParsedChange,
}: MoneyInputProps) {
  const parsedValue = parseNumber(value)

  function handleBlur() {
    if (!value.trim()) {
      onParsedChange?.(0)
      return
    }

    onValueChange(parsedValue > 0 ? String(parsedValue) : '')
    onParsedChange?.(parsedValue)
  }

  return (
    <label className={`block text-sm font-medium text-stone-700 dark:text-stone-200 ${className}`}>
      {label}
      <input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={handleBlur}
        type="text"
        inputMode="decimal"
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2.5 tabular-nums outline-none focus:border-emerald-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      />
      {parsedValue > 0 ? <span className="mt-1 block text-xs font-semibold text-muted-foreground">{formatCurrency(parsedValue)}</span> : null}
    </label>
  )
}
