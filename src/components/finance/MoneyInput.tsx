import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import { Input } from '../ui/input'

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
    <label className={`block text-sm font-semibold text-foreground ${className}`}>
      {label}
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={handleBlur}
        type="text"
        inputMode="decimal"
        required={required}
        placeholder={placeholder}
        className="mt-1 tabular-nums"
      />
      {parsedValue > 0 ? <span className="mt-1 block text-xs font-semibold text-muted-foreground">{formatCurrency(parsedValue)}</span> : null}
    </label>
  )
}
