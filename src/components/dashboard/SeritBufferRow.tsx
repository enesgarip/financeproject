import { Check, Pencil } from 'lucide-react'
import { useState } from 'react'
import { parseNumberStrict } from '../../utils/formatCurrency'
import { useSeritAmount } from '../serit'

/**
 * Güvenlik tamponunu düzenleyen satır. Eskiden SafeToSpendCard'ın dibindeki
 * kutuydu; kart kalkınca ayarın kendisi kaybolmasın diye Şerit'in kendi
 * biçiminde — kutu değil, çizgi — yeniden kuruldu.
 *
 * Tampon kahraman rakamdan düşüldüğü için buraya yakın durması gerekiyor:
 * kullanıcı "neden bu kadar az" sorusunun cevabını aynı bakışta görüyor.
 */
export function SeritBufferRow({ buffer, onChange }: { buffer: number; onChange: (value: number) => void }) {
  const format = useSeritAmount()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const money = format(buffer)

  function commit() {
    const value = parseNumberStrict(draft)
    if (!Number.isFinite(value) || value < 0) { setError('Geçerli ve negatif olmayan bir tutar gir.'); return }
    onChange(value)
    setError('')
    setEditing(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
      <span className="text-xs text-ink-muted">Güvenlik tamponu düşüldü</span>

      {editing ? (
        <span data-navigation-scope className="flex flex-wrap items-center justify-end gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(false)
            }}
            aria-label="Güvenlik tamponu tutarı"
            className="serit-num w-24 rounded-md border border-line-strong bg-raised px-2 py-1 text-right text-[13px] text-ink"
          />
          <button
            type="button"
            onClick={commit}
            aria-label="Tamponu kaydet"
            className="grid size-11 place-items-center rounded-md bg-primary text-primary-foreground"
          >
            <Check size={14} aria-hidden="true" />
          </button>
          {error ? <span role="alert" className="w-full text-xs text-destructive">{error}</span> : null}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(String(buffer))
            setEditing(true)
          }}
          className="serit-num inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-semibold text-ink transition-colors duration-[120ms] hover:bg-black/[.03] dark:hover:bg-white/[.04]"
        >
          {money.amount} {money.unit}
          <Pencil size={12} className="text-ink-faint" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
