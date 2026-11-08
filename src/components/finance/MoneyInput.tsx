import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { parseNumberStrict } from '../../utils/formatCurrency'
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
  const { formatAmount } = useBalancePrivacy()
  const parsedValue = parseNumberStrict(value)

  function handleBlur() {
    if (!value.trim()) {
      onParsedChange?.(0)
      return
    }

    if (!Number.isFinite(parsedValue) || parsedValue < 0) return
    // Virgül, üç ondalık hanenin binlik nokta diye tekrar yorumlanmasını önler.
    onValueChange(String(parsedValue).replace('.', ','))
    onParsedChange?.(parsedValue)
  }

  return (
    <label className={`block text-sm font-semibold text-ink ${className}`}>
      {label}
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={handleBlur}
        type="text"
        inputMode="decimal"
        required={required}
        placeholder={placeholder}
        className="mt-1 min-h-11 tabular-nums"
      />
      {parsedValue > 0 ? <span className="mt-1 block text-xs font-semibold text-ink-muted">{formatAmount(parsedValue)}</span> : null}
    </label>
  )
}
