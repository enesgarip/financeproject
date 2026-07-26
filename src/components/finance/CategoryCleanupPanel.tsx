import { Loader2, Tags } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { fetchUncategorizedExpenses, updateCardExpenseCategory } from '../../data/repositories/cardsRepo'
import { invalidateCategoryMemory } from '../../hooks/useCategoryMemory'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { CardExpense } from '../../types/database'
import { expenseCategories } from '../../utils/categories'
import { formatDate } from '../../utils/date'
import { sumTL } from '../../utils/money'
import { normalizeSearchText } from '../../utils/searchText'

/**
 * "Diğer"de kalan harcamaları satıcı bazında gruplayıp tek seçimle
 * kategorilendirir. Kaydedilen kategori aynı satıcının TÜM Diğer kayıtlarına
 * uygulanır ve kategori hafızası (useCategoryMemory) tazelendiği için sonraki
 * import/hızlı-harcama önerileri de bu düzeltmeden öğrenir — Diğer oranını
 * kalıcı olarak eritmenin yolu budur.
 */

const FETCH_LIMIT = 200
const MAX_GROUPS = 12

type MerchantGroup = {
  key: string
  label: string
  ids: string[]
  total: number
  lastDate: string
}

function groupByMerchant(rows: CardExpense[]): MerchantGroup[] {
  const groups = new Map<string, { label: string; ids: string[]; amounts: number[]; lastDate: string }>()
  for (const row of rows) {
    const key = normalizeSearchText(row.description)
    if (!key) continue
    const group = groups.get(key)
    if (group) {
      group.ids.push(row.id)
      group.amounts.push(row.amount)
      if (row.spent_at > group.lastDate) group.lastDate = row.spent_at
    } else {
      groups.set(key, { label: row.description.trim(), ids: [row.id], amounts: [row.amount], lastDate: row.spent_at })
    }
  }
  return Array.from(groups.entries())
    .map(([key, group]) => ({ key, label: group.label, ids: group.ids, total: sumTL(group.amounts), lastDate: group.lastDate }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_GROUPS)
}

export function CategoryCleanupPanel({ onChanged }: { onChanged?: () => void }) {
  const { formatAmount } = useBalancePrivacy()
  const [rows, setRows] = useState<CardExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [savedCount, setSavedCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchUncategorizedExpenses(FETCH_LIMIT)
    if (result.ok) {
      setRows(result.data)
      setError('')
    } else {
      setRows([])
      setError(result.error.message ?? 'Kategorisiz harcamalar yüklenemedi.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const groups = useMemo(() => groupByMerchant(rows), [rows])
  const options = expenseCategories.filter((category) => category !== 'Diğer')

  const handleSave = useCallback(
    async (group: MerchantGroup) => {
      const category = selections[group.key]
      if (!category) return
      setSavingKey(group.key)
      setError('')
      for (const id of group.ids) {
        const result = await updateCardExpenseCategory(id, category)
        if (!result.ok) {
          setError(result.error.message ?? 'Kategori güncellenemedi.')
          setSavingKey(null)
          return
        }
      }
      // Hafıza tazelenir → import/hızlı harcama önerileri bu düzeltmeden öğrenir.
      invalidateCategoryMemory()
      setSavedCount((count) => count + group.ids.length)
      setRows((current) => current.filter((row) => !group.ids.includes(row.id)))
      setSavingKey(null)
      onChanged?.()
    },
    [selections, onChanged],
  )

  if (!loading && groups.length === 0 && savedCount === 0 && !error) return null

  return (
    <SurfaceCard className="border-info/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tags size={17} />
              Kategorisiz harcamalar
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              "Diğer"de kalan satıcılara kategori ver; aynı satıcının tüm kayıtlarına uygulanır ve sonraki importlar bunu öğrenir.
            </p>
          </div>
          <Badge variant="secondary">{rows.length} kayıt</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {error ? <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{error}</p> : null}
        {loading ? (
          <p className="flex items-center gap-2 rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Harcamalar yükleniyor...
          </p>
        ) : null}
        {!loading && groups.length === 0 ? (
          <p className="rounded-xl bg-success/8 p-3 text-sm font-medium text-success">
            {savedCount > 0 ? `${savedCount} harcama kategorilendi — hepsi bu kadar. 🎉` : 'Kategorisiz harcama kalmadı.'}
          </p>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className="rounded-xl bg-muted/45 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{group.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.ids.length} kayıt · {formatAmount(group.total)} · son: {formatDate(group.lastDate)}
                </p>
              </div>
              <select
                value={selections[group.key] ?? ''}
                onChange={(event) => setSelections((current) => ({ ...current, [group.key]: event.target.value }))}
                aria-label={`${group.label} için kategori`}
                className="min-h-9 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Kategori seç...</option>
                {options.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleSave(group)}
                disabled={!selections[group.key] || savingKey !== null}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm disabled:opacity-50 hover:bg-primary/90"
              >
                {savingKey === group.key ? <Loader2 size={13} className="animate-spin" /> : null}
                Kaydet
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </SurfaceCard>
  )
}
