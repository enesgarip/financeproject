import { Link2, Pencil, Plus, Target, Trash2, Trophy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { SimpleModal } from '../SimpleModal'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input, Select, Textarea } from '../ui/input'
import { Progress } from '../ui/progress'
import { useConfirmDialog } from '../ui/use-confirm-dialog'
import {
  deleteSavingsGoal,
  fetchSavingsGoalsRows,
  upsertSavingsGoalWithComponents,
  type SavingsGoalComponentInput,
  type SavingsGoalSourceInput,
} from '../../data/repositories/savingsGoalsRepo'
import type {
  Asset,
  Card as FinanceCard,
  SavingsGoal,
  SavingsGoalComponent,
  SavingsGoalSource,
  SavingsGoalValueType,
} from '../../types/database'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { KASA_BUCKETS_QUERY_KEY, useKasaBuckets } from '../../hooks/useSafeToSpend'
import { contributeToGoalBucket, insertKasaBucket, updateKasaBucket } from '../../data/repositories/kasaBucketsRepo'
import { bucketForGoal, buildGoalBucketPlan } from '../../utils/goalBucket'
import { useMarketRates } from '../../hooks/useMarketRates'
import { useStockPrices } from '../../hooks/useStockPrices'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import {
  goalSourceLabel,
  goalSourceOptions,
  goalSourceToken,
  parseGoalSourceToken,
  resolveGoalSources,
  resolveSavingsGoalRows,
  suggestGoalSource,
  type GoalSourceRefs,
  type GoalSourceSuggestion,
} from '../../utils/goalSources'
import {
  formatComponentAmount,
  formatSavingsGoalAmount,
  formatSavingsGoalProgress,
  savingsGoalProgressRate,
  savingsGoalValueTypeLabel,
} from '../../utils/savingsGoal'
import { buildSavingsCashflowAdvice, buildSavingsSuggestion } from '../../utils/savingsSuggestion'
import { valuationConfidence } from '../../utils/dataConfidence'
import { effectiveGoalValueWithSource, valueGoal } from '../../utils/valuation'
import { ConfidenceBadge } from '../ui/confidence-badge'
import { MoneyInput } from './MoneyInput'

type ComponentDraft = {
  key: string
  /** Kayıtlı satırın kimliği; NULL = yeni bileşen. Bağlı kaynağın hayatta kalması buna bağlı. */
  id: string | null
  label: string
  value_type: SavingsGoalComponent['value_type']
  target_amount: string
  current_amount: string
}

/** Formdaki "yeni kova" seçeneği; gerçek bir kova id'siyle çakışmasın diye sabit. */
const NEW_BUCKET = '__new__'

/**
 * Formdaki tek takip kaynağı. `ownerKey` null ise hedefin kendisine, dolu ise o
 * anahtara sahip bileşene bağlıdır (kaydetmede sıra numarasına çevrilir).
 */
type SourceDraft = {
  key: string
  ownerKey: string | null
  token: string
}

function newComponentDraft(partial?: Partial<ComponentDraft>): ComponentDraft {
  return {
    key: partial?.key ?? crypto.randomUUID(),
    id: partial?.id ?? null,
    label: partial?.label ?? '',
    value_type: partial?.value_type ?? 'gram_altin',
    target_amount: partial?.target_amount ?? '',
    current_amount: partial?.current_amount ?? '',
  }
}

/**
 * Bir satırın (hedef ya da bileşen) takip kaynaklarını düzenler.
 *
 * Kaynak seçiliyken "biriken" alanı gösterilmez: tutar kaynaktan türetilir,
 * elle girilen ikinci bir sayı tutmak ekranda hangisinin doğru olduğunu
 * belirsizleştirirdi.
 */
function GoalSourceEditor({
  drafts,
  valueType,
  refs,
  formatUnit,
  onAdd,
  onRemove,
}: {
  drafts: SourceDraft[]
  valueType: Exclude<SavingsGoalValueType, 'composite'>
  refs: GoalSourceRefs
  formatUnit: (amount: number) => string
  onAdd: (token: string) => void
  onRemove: (key: string) => void
}) {
  const options = useMemo(() => goalSourceOptions(refs, valueType), [refs, valueType])
  const groups = useMemo(() => [...new Set(options.map((option) => option.group))], [options])
  const used = new Set(drafts.map((draft) => draft.token))

  const parsed = drafts.map((draft) => parseGoalSourceToken(draft.token)).filter((row) => row !== null)
  const preview = resolveGoalSources(parsed, valueType, refs)

  return (
    <div className="space-y-2">
      {drafts.length > 0 ? (
        <ul className="space-y-1.5">
          {drafts.map((draft) => {
            const source = parseGoalSourceToken(draft.token)
            return (
              <li key={draft.key} className="flex items-center gap-2 rounded-lg bg-raised px-2.5 py-2 ring-1 ring-line-strong">
                <Link2 size={14} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {source ? goalSourceLabel(source, refs) : 'Bilinmeyen kaynak'}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(draft.key)}
                  className="tap-target shrink-0 text-xs font-semibold text-destructive"
                >
                  Kaldır
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <Select
        value=""
        aria-label="Takip kaynağı ekle"
        onChange={(event) => {
          if (event.target.value) onAdd(event.target.value)
        }}
        className="h-10 text-sm"
      >
        <option value="">+ Kaynak ekle…</option>
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((option) => option.group === group && !used.has(option.token))
              .map((option) => (
                <option key={option.token} value={option.token}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>

      {drafts.length > 0 ? (
        <p className="text-xs text-ink-muted">
          Şu anki değer: <span className="font-semibold tabular-nums text-ink">{formatUnit(preview.amount)}</span>
        </p>
      ) : null}

      {preview.missing.length > 0 ? (
        <p className="text-xs font-medium text-warning">{preview.missing.length} kaynak bulunamadı (silinmiş olabilir).</p>
      ) : null}
      {preview.unusable.length > 0 ? (
        <p className="text-xs font-medium text-warning">
          {preview.unusable.length} kaynak bu hedef biriminde kullanılamıyor ve toplama katılmıyor.
        </p>
      ) : null}
    </div>
  )
}

function defaultCompositeDrafts() {
  return [newComponentDraft({ label: 'Gram altın', value_type: 'gram_altin' }), newComponentDraft({ label: 'Çeyrek altın', value_type: 'ceyrek_altin' })]
}

export function SavingsGoalsPanel({
  monthlySurplus,
  assets = [],
  cards = [],
}: { monthlySurplus?: number; assets?: Asset[]; cards?: FinanceCard[] } = {}) {
  const { formatAmount } = useBalancePrivacy()
  const { user } = useAuth()
  const { snapshot } = useMarketRates()
  const { confirm, confirmDialog } = useConfirmDialog()
  const bucketsQuery = useKasaBuckets()
  const stockPrices = useStockPrices(assets.map((asset) => asset.symbol))
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [components, setComponents] = useState<SavingsGoalComponent[]>([])
  const [sources, setSources] = useState<SavingsGoalSource[]>([])
  const [sourceDrafts, setSourceDrafts] = useState<SourceDraft[]>([])
  /** Öneriyi uygularken hangi hedefin beklediği (butonu kilitler). */
  const [linkingGoalId, setLinkingGoalId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [name, setName] = useState('')
  const [valueType, setValueType] = useState<SavingsGoalValueType>('TRY')
  const [targetAmount, setTargetAmount] = useState('')
  const [currentAmount, setCurrentAmount] = useState('')
  const [estimatedValueTry, setEstimatedValueTry] = useState('')
  const [autoValued, setAutoValued] = useState(true)
  const [targetDate, setTargetDate] = useState('')
  const [status, setStatus] = useState<SavingsGoal['status']>('active')
  const [note, setNote] = useState('')
  const [componentDrafts, setComponentDrafts] = useState<ComponentDraft[]>(defaultCompositeDrafts())
  const [formError, setFormError] = useState('')
  /** Formdaki kasa kovası seçimi: '' = yok, NEW_BUCKET = hedef adıyla yeni kova, aksi hâlde kova id'si. */
  const [bucketChoice, setBucketChoice] = useState('')
  /** "Bu ay ayır" basılan hedef (butonu kilitler). */
  const [contributingGoalId, setContributingGoalId] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const buckets = bucketsQuery.data

  const refs = useMemo<GoalSourceRefs>(
    () => ({ assets, cards, buckets: buckets ?? [], snapshot, stockPrices }),
    [assets, cards, buckets, snapshot, stockPrices],
  )

  /**
   * Ekranda gösterilen satırlar TÜRETİLMİŞ olanlardır: kaynağa bağlı hedefin
   * biriken tutarı DB'de değil burada hesaplanır (bkz. utils/goalSources.ts).
   * Aşağıdaki tüm hesaplar (ilerleme, aylık gerekli, tamamlandı rozeti) bu
   * satırları okur; ham `goals`/`components` yalnız düzenleme formunu doldurur.
   */
  const resolved = useMemo(
    () => resolveSavingsGoalRows(goals, components, sources, refs),
    [goals, components, sources, refs],
  )

  /**
   * "Bunu bağlayayım mı?" önerileri. Elle girilen tutar bir kaynağın toplamına
   * çok yakınsa kullanıcı aslında o kaynağı elle kopyalıyordur; özelliği
   * keşfetmesini beklemek yerine söylüyoruz. Yalnız kaynağı OLMAYAN aktif
   * hedefler için — bağlı olan zaten güncel.
   */
  const suggestionByGoal = useMemo(() => {
    const linkedGoalIds = new Set(sources.map((source) => source.goal_id))
    const map = new Map<string, GoalSourceSuggestion>()
    for (const goal of goals) {
      if (goal.status !== 'active' || linkedGoalIds.has(goal.id)) continue
      const suggestion = suggestGoalSource(goal, refs)
      if (suggestion) map.set(goal.id, suggestion)
    }
    return map
  }, [goals, sources, refs])

  const componentsByGoal = useMemo(() => {
    const map = new Map<string, SavingsGoalComponent[]>()
    for (const row of resolved.components) {
      map.set(row.goal_id, [...(map.get(row.goal_id) ?? []), row])
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.sort_order - b.sort_order)
    }
    return map
  }, [resolved.components])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    const result = await fetchSavingsGoalsRows()

    if (!result.ok) {
      setError(result.error.message ?? 'Birikim hedefleri yüklenemedi.')
      setGoals([])
      setComponents([])
      setSources([])
    } else {
      setGoals(result.data.goals)
      setComponents(result.data.componentsError ? [] : result.data.components)
      // Kaynaklar okunamadıysa bağlı hedefin tutarı türetilemez; sessizce 0
      // göstermek yerine kullanıcıya söyle (bağsız hedefler etkilenmez).
      setSources(result.data.sourcesError ? [] : result.data.sources)
      if (result.data.sourcesError) {
        setError(result.data.sourcesError.message ?? 'Hedef takip kaynakları yüklenemedi.')
      }
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  function openCreate() {
    setEditing(null)
    setName('')
    setValueType('TRY')
    setTargetAmount('')
    setCurrentAmount('')
    setEstimatedValueTry('')
    setAutoValued(true)
    setTargetDate('')
    setStatus('active')
    setNote('')
    setComponentDrafts(defaultCompositeDrafts())
    setSourceDrafts([])
    setBucketChoice('')
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(goal: SavingsGoal) {
    const rows = componentsByGoal.get(goal.id) ?? []
    setEditing(goal)
    setName(goal.name)
    setValueType(goal.value_type)
    setTargetAmount(String(goal.target_amount))
    setCurrentAmount(String(goal.current_amount))
    setEstimatedValueTry(goal.estimated_value_try ? String(goal.estimated_value_try) : '')
    setAutoValued(goal.auto_valued)
    setTargetDate(goal.target_date ?? '')
    setStatus(goal.status)
    setNote(goal.note ?? '')
    setComponentDrafts(
      goal.value_type === 'composite' && rows.length > 0
        ? rows.map((row) =>
            newComponentDraft({
              key: row.id,
              id: row.id,
              label: row.label ?? '',
              value_type: row.value_type,
              target_amount: String(row.target_amount),
              current_amount: String(row.current_amount),
            }),
          )
        : defaultCompositeDrafts(),
    )
    // Bileşen taslaklarının anahtarı kayıtlı satır id'sidir; kaynak da aynı
    // id'yi taşıdığı için sahiplik eşleşmesi ek eşlemeye gerek kalmadan kurulur.
    setSourceDrafts(
      sources
        .filter((source) => source.goal_id === goal.id)
        .map((source) => ({ key: source.id, ownerKey: source.component_id, token: goalSourceToken(source) })),
    )
    setBucketChoice(buckets ? (bucketForGoal(goal.id, buckets)?.id ?? '') : '')
    setFormError('')
    setModalOpen(true)
  }

  /**
   * Hedefin kova bağını forma göre kurar/koparır. Hedef RPC'siyle aynı
   * transaction'da DEĞİL (ayrı tablo): hedef yazıldıktan sonra çalışır ve
   * düşerse hedef kaydı korunur, kullanıcıya uyarı gider.
   */
  async function syncGoalBucket(goalId: string, goalName: string): Promise<string | null> {
    const current = buckets ? bucketForGoal(goalId, buckets) : null

    if (bucketChoice === '') {
      if (!current) return null
      const result = await updateKasaBucket(current.id, { goal_id: null })
      return result.ok ? null : (result.error.message ?? 'Kova bağı kaldırılamadı.')
    }

    if (bucketChoice === NEW_BUCKET) {
      if (!user) return null
      const result = await insertKasaBucket({
        user_id: user.id,
        name: goalName,
        reserved_amount: 0,
        sort_order: (buckets?.length ?? 0) + 1,
        note: null,
        goal_id: goalId,
      })
      return result.ok ? null : (result.error.message ?? 'Kova oluşturulamadı.')
    }

    if (current?.id === bucketChoice) return null

    // Önce eski bağı kopar: hedef başına tek kova (DB'de unique index).
    if (current) {
      const unlink = await updateKasaBucket(current.id, { goal_id: null })
      if (!unlink.ok) return unlink.error.message ?? 'Eski kova bağı kaldırılamadı.'
    }
    const result = await updateKasaBucket(bucketChoice, { goal_id: goalId })
    return result.ok ? null : (result.error.message ?? 'Kova bağlanamadı.')
  }

  /** Plan kadar kovaya ayırır; harcanabilir tutar bu andan sonra gerçekten azalır. */
  async function contributeToGoal(goalId: string, bucketId: string, amount: number) {
    setContributingGoalId(goalId)
    const result = await contributeToGoalBucket(bucketId, amount)
    setContributingGoalId(null)

    if (!result.ok) {
      setError(result.error.message ?? 'Kovaya ayrılamadı.')
      return
    }
    await queryClient.invalidateQueries({ queryKey: KASA_BUCKETS_QUERY_KEY })
  }

  /** Öneriyi tek tıkla uygular: hedefin alanlarına dokunmadan kaynağı bağlar. */
  async function applySuggestedSource(goal: SavingsGoal, token: string) {
    if (!user) return
    const parsed = parseGoalSourceToken(token)
    if (!parsed) return

    setLinkingGoalId(goal.id)
    const result = await upsertSavingsGoalWithComponents({
      userId: user.id,
      editingGoal: goal,
      goalFields: {
        name: goal.name,
        value_type: goal.value_type,
        target_amount: goal.target_amount,
        current_amount: goal.current_amount,
        // Bağlı hedefte saklanan tahmini değer bayat kalır; canlı hesaplanır.
        estimated_value_try: null,
        auto_valued: goal.auto_valued,
        target_date: goal.target_date,
        status: goal.status,
        note: goal.note,
      },
      components: [],
      sources: [
        {
          component_index: null,
          kind: parsed.kind,
          asset_id: parsed.asset_id,
          asset_category: parsed.asset_category,
          card_id: parsed.card_id,
          bucket_id: parsed.bucket_id,
          sort_order: 0,
        },
      ],
      isComposite: false,
    })
    setLinkingGoalId(null)

    if (!result.ok) {
      setError(result.error.message ?? 'Hedef kaynağa bağlanamadı.')
      return
    }
    await loadData()
  }

  async function handleDelete(goal: SavingsGoal) {
    const confirmed = await confirm({
      title: 'Hedefi sil',
      description: `"${goal.name}" hedefi ve bağlı bileşenleri silinecek. Bu işlem geri alınamaz.`,
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (!confirmed) return

    const deleteResult = await deleteSavingsGoal(goal.id)
    if (!deleteResult.ok) {
      setError(deleteResult.error.message ?? 'Hedef silinemedi.')
      return
    }
    await loadData()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Hedef adı yazmalısın.')
      return
    }

    const isComposite = valueType === 'composite'
    const isGold = valueType === 'gram_altin' || valueType === 'ceyrek_altin'

    let parsedComponents: SavingsGoalComponentInput[] = []

    if (isComposite) {
      if (componentDrafts.length === 0) {
        setFormError('Karma hedefte en az bir bileşen olmalı.')
        return
      }

      const nextComponents: SavingsGoalComponentInput[] = []

      for (const [index, draft] of componentDrafts.entries()) {
        const target = parseNumber(draft.target_amount)
        // Kaynağa bağlı bileşende biriken tutar türetilir; elle gelen değer
        // yazılmaz (0 gönderilir, RPC de aynısını zorlar).
        const current = sourceDrafts.some((source) => source.ownerKey === draft.key)
          ? 0
          : parseNumber(draft.current_amount)
        if (target <= 0) {
          setFormError(`${draft.label || 'Bileşen'} hedef miktarı 0’dan büyük olmalı.`)
          return
        }

        nextComponents.push({
          id: draft.id,
          label: draft.label.trim() || null,
          value_type: draft.value_type,
          target_amount: target,
          current_amount: current,
          sort_order: index,
        })
      }

      parsedComponents = nextComponents
    } else {
      if (parseNumber(targetAmount) <= 0) {
        setFormError('Hedef miktar 0’dan büyük olmalı.')
        return
      }
    }

    const goalLinked = !isComposite && sourceDrafts.some((source) => source.ownerKey === null)

    const sourcesPayload: SavingsGoalSourceInput[] = []
    for (const [index, draft] of sourceDrafts.entries()) {
      const parsed = parseGoalSourceToken(draft.token)
      if (!parsed) continue

      let componentIndex: number | null = null
      if (isComposite) {
        componentIndex = componentDrafts.findIndex((component) => component.key === draft.ownerKey)
        // Sahibi kaldırılmış bileşen olan kaynak hedefe DÜŞMEZ, atılır.
        if (componentIndex < 0) continue
      } else if (draft.ownerKey !== null) {
        continue
      }

      sourcesPayload.push({
        component_index: componentIndex,
        kind: parsed.kind,
        asset_id: parsed.asset_id,
        asset_category: parsed.asset_category,
        card_id: parsed.card_id,
        bucket_id: parsed.bucket_id,
        sort_order: index,
      })
    }

    setSaving(true)
    setFormError('')

    try {
      // Bağlı hedefte biriken tutar (ve dolayısıyla TL karşılığı) türetilir;
      // saklanan tahmini değer bayat kalacağı için yazılmaz — ekran canlı
      // hesabı gösterir (bkz. goalSources.ts + valuationRepo'nun bağlı hedefleri
      // otomatik değerlemeden dışlaması).
      const goalAutoValued = isGold && autoValued
      const liveGoalValue = goalAutoValued && !goalLinked
        ? valueGoal({ value_type: valueType, current_amount: parseNumber(currentAmount) }, snapshot)
        : null
      const goalFields = {
        name: trimmedName,
        value_type: valueType,
        // Karma hedefte sayaçları (bileşen sayısı / hedefine ulaşan bileşen
        // sayısı) upsert_savings_goal bileşenlerin kendisinden türetir; buradan
        // gönderilen değer yok sayılır. Aynı hesabı ikinci kez burada tutmak
        // ana satırın bileşenlerden ayrışmasının yoluydu (Faz D2). Kayıt sonrası
        // loadData() zaten sunucudaki doğru sayacı geri getiriyor.
        target_amount: isComposite ? 0 : parseNumber(targetAmount),
        current_amount: isComposite || goalLinked ? 0 : parseNumber(currentAmount),
        estimated_value_try: goalLinked
          ? null
          : goalAutoValued
            ? liveGoalValue ?? (estimatedValueTry.trim() ? parseNumber(estimatedValueTry) : null)
            : isGold && estimatedValueTry.trim()
              ? parseNumber(estimatedValueTry)
              : null,
        auto_valued: goalAutoValued,
        target_date: targetDate || null,
        status,
        note: note.trim() || null,
      }

      const result = await upsertSavingsGoalWithComponents({
        userId: user.id,
        editingGoal: editing,
        goalFields,
        components: parsedComponents,
        sources: sourcesPayload,
        isComposite,
      })
      if (!result.ok) throw new Error(result.error.message)

      // Kova bağı ayrı tabloda; hedef yazıldıktan SONRA kurulur. Düşerse hedef
      // kaydı korunur ve kullanıcı "hiç kaydolmadı" sanmasın diye uyarı görür.
      const bucketError = valueType === 'TRY' ? await syncGoalBucket(result.data, trimmedName) : null
      if (bucketError) {
        setError(`Hedef kaydedildi ama kasa kovası bağlanamadı: ${bucketError}`)
      }
      await queryClient.invalidateQueries({ queryKey: KASA_BUCKETS_QUERY_KEY })

      setModalOpen(false)
      await loadData()
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Kayıt sırasında hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  const goalSourceDrafts = sourceDrafts.filter((draft) => draft.ownerKey === null)
  const goalIsLinked = valueType !== 'composite' && goalSourceDrafts.length > 0

  /**
   * Formdaki hedefin kaynaklardan gelen miktarı. Altın hedefinde TL önizlemesi
   * de buradan hesaplanır; elle girilen (ve bağlıyken boş kalan) alandan değil.
   */
  const goalSourceAmount = useMemo(() => {
    if (valueType === 'composite') return 0
    const parsed = goalSourceDrafts.map((draft) => parseGoalSourceToken(draft.token)).filter((row) => row !== null)
    return resolveGoalSources(parsed, valueType, refs).amount
    // goalSourceDrafts her render'da yeniden türetiliyor; kimliği değil içeriği önemli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDrafts, valueType, refs])

  const formCurrentAmount = goalIsLinked ? goalSourceAmount : parseNumber(currentAmount)

  function addSourceDraft(ownerKey: string | null, token: string) {
    setSourceDrafts((rows) => [...rows, { key: crypto.randomUUID(), ownerKey, token }])
  }

  function removeSourceDraft(key: string) {
    setSourceDrafts((rows) => rows.filter((row) => row.key !== key))
  }

  const visibleGoals = resolved.goals
  const activeGoals = visibleGoals.filter((g) => g.status === 'active')
  const completedGoals = visibleGoals.filter((g) => g.status === 'completed')

  // Aktif TRY hedeflerinin toplam aylık gerekliğini bu ayki harcanabilirle (surplus)
  // kıyaslayıp "ayır / kısıtlı ayır / ara ver" önerir. Surplus geçilmezse gösterilmez.
  const savingsAdvice = useMemo(() => {
    if (monthlySurplus === undefined) return null
    const totalNeeded = visibleGoals
      .filter((g) => g.status === 'active' && g.value_type === 'TRY')
      .reduce((total, g) => total + (buildSavingsSuggestion(g).monthlyNeeded ?? 0), 0)
    return buildSavingsCashflowAdvice(totalNeeded, monthlySurplus)
  }, [visibleGoals, monthlySurplus])

  return (
    <section className="space-y-4">
      <Card className="border-line-strong">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Target size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Birikim hedefleri</h2>
                <p className="text-sm text-ink-muted">
                  {visibleGoals.length === 0
                    ? 'TL, altın veya karma hedef ekle.'
                    : `${activeGoals.length} aktif${completedGoals.length > 0 ? ` · ${completedGoals.length} tamamlandı` : ''}`}
                </p>
              </div>
            </div>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus size={16} />
              Ekle
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {savingsAdvice ? (
        <div
          className={`rounded-xl border p-3 text-sm font-medium ${
            savingsAdvice.tone === 'success'
              ? 'border-success/25 bg-success/8 text-success'
              : savingsAdvice.tone === 'warning'
                ? 'border-warning/25 bg-warning/10 text-warning'
                : 'border-destructive/25 bg-destructive/8 text-destructive'
          }`}
        >
          {savingsAdvice.kind === 'pause'
            ? 'Bu ay nakit akışı gergin; hedeflere ara vermek güvenli.'
            : savingsAdvice.kind === 'partial'
              ? `Bu ay hedeflere ancak ${formatAmount(savingsAdvice.affordable)} ayırabilirsin (gereken ${formatAmount(savingsAdvice.needed)}).`
              : savingsAdvice.extra > 0
                ? `Bu ay gereken ${formatAmount(savingsAdvice.needed)} ayrılıp ${formatAmount(savingsAdvice.extra)} fazladan biriktirilebilir.`
                : `Bu ay hedeflere gereken ${formatAmount(savingsAdvice.needed)} rahatça ayırabilirsin.`}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Hedefler yükleniyor...</p>
      ) : visibleGoals.length === 0 ? (
        <Card className="border border-dashed border-line-strong bg-page shadow-none">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/8 text-primary/60">
              <Target size={28} />
            </div>
            <p className="text-sm font-semibold text-ink">Henüz birikim hedefi yok</p>
            <p className="text-xs text-ink-muted">İlk hedefini ekleyerek birikimine yön ver.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 min-[520px]:grid-cols-2">
          {visibleGoals.map((goal) => {
            const rate = savingsGoalProgressRate(goal, resolved.components)
            const goalComponents = componentsByGoal.get(goal.id) ?? []
            const isCompleted = goal.status === 'completed'
            // Kaynak bağlı satırların türetme sonucu: rozet + "kaynak bulunamadı"
            // uyarısı için. Karma hedefte bağ bileşenlerde olur.
            const goalResolution = resolved.goalResolutions.get(goal.id)
            const componentResolutions = goalComponents
              .map((component) => resolved.componentResolutions.get(component.id))
              .filter((resolution) => resolution !== undefined)
            const linkedResolutions = goalResolution ? [goalResolution, ...componentResolutions] : componentResolutions
            const missingSourceCount = linkedResolutions.reduce((total, resolution) => total + resolution.missing.length, 0)
            const circumference = 2 * Math.PI * 36
            const strokeOffset = circumference - (circumference * Math.min(rate, 100)) / 100

            return (
              <Card key={goal.id} className={`border-line-strong transition-shadow  ${isCompleted ? 'bg-success/4 ring-1 ring-success/20' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="relative flex size-20 shrink-0 items-center justify-center">
                      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
                        <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="5" className="text-track" />
                        <circle
                          cx="40" cy="40" r="36" fill="none"
                          strokeWidth="5" strokeLinecap="round"
                          stroke="currentColor"
                          className={isCompleted ? 'text-success' : rate >= 75 ? 'text-primary' : rate >= 40 ? 'text-warning' : 'text-primary/60'}
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeOffset}
                          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {isCompleted ? (
                          <Trophy size={18} className="text-success" />
                        ) : (
                          <span className="text-sm font-extrabold tabular-nums text-ink">%{Math.round(rate)}</span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-ink">{goal.name}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {isCompleted ? (
                              <Badge variant="default" className="bg-success/15 text-success text-[10px] px-1.5 py-0">Tamamlandı</Badge>
                            ) : null}
                            {goal.value_type !== 'TRY' ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{savingsGoalValueTypeLabel(goal.value_type)}</Badge>
                            ) : null}
                            {linkedResolutions.length > 0 ? (
                              <Badge variant="outline" className="flex items-center gap-1 border-primary/30 text-primary text-[10px] px-1.5 py-0">
                                <Link2 size={10} />
                                Varlıklardan
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        {/* Sil düzenlemenin yanında; hedefler birbirinin görünür
                            alanını örtmesin diye gerçek boyut + net aralık. */}
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(goal)}
                            aria-label={`${goal.name} hedefini düzenle`}
                            className="tap-target grid size-9 place-items-center rounded-lg text-ink-muted hover:bg-black/[.03] dark:hover:bg-white/[.04] hover:text-ink"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(goal)}
                            aria-label={`${goal.name} hedefini sil`}
                            className="tap-target grid size-9 place-items-center rounded-lg text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold tabular-nums text-ink-muted">{formatSavingsGoalProgress(goal, goalComponents)}</p>
                      {missingSourceCount > 0 ? (
                        <p className="mt-0.5 text-[11px] font-medium text-warning">
                          {missingSourceCount} takip kaynağı bulunamadı; tutar eksik olabilir.
                        </p>
                      ) : null}
                      {(() => {
                        const plan = buildGoalBucketPlan(goal, buckets ? bucketForGoal(goal.id, buckets) : null, sources)
                        if (!plan) return null
                        const busy = contributingGoalId === goal.id
                        return (
                          <div className="mt-1.5 rounded-lg bg-raised px-2 py-1.5 ring-1 ring-line-strong">
                            <p className="text-[11px] text-ink-muted">
                              Kasada ayrılan:{' '}
                              <span className="font-semibold tabular-nums text-ink">{formatAmount(plan.reserved)}</span>
                              {plan.contributedThisMonth ? <span className="text-success"> · bu ay ayrıldı</span> : null}
                            </p>
                            {plan.monthlyNeeded > 0 ? (
                              <div className="mt-1 flex items-center gap-2">
                                <span className="min-w-0 flex-1 text-[11px] text-ink-muted">
                                  {plan.contributedThisMonth ? 'Bu ayın planı' : 'Bu ay ayrılacak'}:{' '}
                                  <span className="font-semibold tabular-nums text-ink">{formatAmount(plan.monthlyNeeded)}</span>
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void contributeToGoal(goal.id, plan.bucket.id, plan.monthlyNeeded)}
                                  className="tap-target shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
                                >
                                  {busy ? 'Ayrılıyor…' : plan.contributedThisMonth ? 'Tekrar ayır' : 'Ayır'}
                                </button>
                              </div>
                            ) : null}
                            {/* Kova hedefin KAYNAĞI değilse ayrılan nakit ilerlemeye
                                yansımaz; "ayırdım ama yüzde artmadı" şaşkınlığını
                                yaşatmadan önce söyle. */}
                            {!plan.fundsProgress ? (
                              <p className="mt-0.5 text-[11px] text-ink-faint">
                                Bu para hedefe ayrılmış nakittir; ilerleme takip kaynağından hesaplanır.
                                {/* Hedefin başka kaynağı yoksa ayırdığın para ilerlemeye
                                    HİÇ yansımaz; kovayı kaynak yapmak tek tık uzakta
                                    olsun. Başka kaynağı varsa (ör. hisse portföyü) bu
                                    gerçekten ayrı bir kap — önerme. */}
                                {!sources.some((source) => source.goal_id === goal.id) ? (
                                  <button
                                    type="button"
                                    disabled={linkingGoalId === goal.id}
                                    onClick={() => void applySuggestedSource(goal, `bucket:${plan.bucket.id}`)}
                                    className="tap-target ml-1 font-bold text-primary hover:underline disabled:opacity-50"
                                  >
                                    Bu kovayı kaynak yap
                                  </button>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        )
                      })()}
                      {(() => {
                        const suggestion = suggestionByGoal.get(goal.id)
                        if (!suggestion) return null
                        // Buton dar ekranda metnin YANINA sıkışmasın: metin tam
                        // satır (w-full), buton alt satırda sağa yaslı (ml-auto).
                        return (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-2 py-1.5">
                            <p className="w-full text-[11px] text-ink-muted">
                              <span className="font-semibold text-ink">{suggestion.label}</span> toplamın{' '}
                              <span className="tabular-nums">{formatSavingsGoalAmount(goal, suggestion.amount)}</span> — bağlayıp
                              otomatik güncelleyeyim mi?
                            </p>
                            <button
                              type="button"
                              disabled={linkingGoalId === goal.id}
                              onClick={() => void applySuggestedSource(goal, suggestion.token)}
                              className="tap-target ml-auto shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
                            >
                              {linkingGoalId === goal.id ? 'Bağlanıyor…' : 'Bağla'}
                            </button>
                          </div>
                        )
                      })()}
                      {goal.value_type !== 'TRY' && goal.value_type !== 'composite' && (goal.auto_valued || goal.estimated_value_try) ? (() => {
                        // "Güncel" etiketi kur alınamadığında da yazıyordu; artık
                        // saklı değere düşüldüğünde bunu söylüyor (Faz D3).
                        const { value, source } = effectiveGoalValueWithSource(goal, snapshot)
                        const confidence = valuationConfidence(source, goal.valued_at)
                        return (
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                            <span>
                              {goal.auto_valued && source === 'live' ? 'Güncel' : 'Tahmini'}:{' '}
                              <span className="font-semibold tabular-nums text-ink">{formatAmount(value)}</span>
                            </span>
                            <ConfidenceBadge confidence={confidence} />
                          </p>
                        )
                      })() : null}
                      {goal.target_date ? <p className="mt-0.5 text-[11px] text-ink-muted">Hedef: {formatDate(goal.target_date)}</p> : null}
                      {!isCompleted ? (() => {
                        const suggestion = buildSavingsSuggestion(goal)
                        if (suggestion.pace === 'active' && suggestion.monthlyNeeded != null) {
                          return (
                            <p className="mt-1 text-[11px] font-bold text-primary">
                              Aylık gerekli: {formatSavingsGoalAmount(goal, suggestion.monthlyNeeded)} · {suggestion.monthsRemaining} ay
                            </p>
                          )
                        }
                        if (suggestion.pace === 'overdue') {
                          return (
                            <p className="mt-1 text-[11px] font-bold text-warning">
                              Hedef tarihi geçti · kalan {formatSavingsGoalAmount(goal, suggestion.remaining)}
                            </p>
                          )
                        }
                        if (suggestion.pace === 'no-date' && suggestion.remaining > 0) {
                          return <p className="mt-1 text-[11px] text-ink-muted">Hedef tarih ekle → aylık plan çıkar</p>
                        }
                        return null
                      })() : null}
                    </div>
                  </div>
                  {goal.value_type === 'composite' && goalComponents.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-line-strong pt-3">
                      {goalComponents.map((row) => {
                        const compRate = row.target_amount > 0 ? Math.min((row.current_amount / row.target_amount) * 100, 100) : 0
                        return (
                          <div key={row.id} className="flex items-center gap-2">
                            <span className="min-w-0 shrink truncate text-xs text-ink-muted">{row.label?.trim() || savingsGoalValueTypeLabel(row.value_type)}</span>
                            <Progress value={compRate} className="h-1 flex-1" color={compRate >= 100 ? 'success' : 'primary'} />
                            <span className="shrink-0 text-[10px] font-bold tabular-nums text-ink-muted">
                              {formatComponentAmount(row, row.current_amount)}/{formatComponentAmount(row, row.target_amount)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {goal.note ? (
                    <p className="mt-2 truncate text-[11px] italic text-ink-muted">{goal.note}</p>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SimpleModal title={editing ? 'Hedefi düzenle' : 'Hedef ekle'} open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium">
            Hedef adı
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" required />
          </label>
          <label className="block text-sm font-medium">
            Hedef türü
            <Select
              value={valueType}
              onChange={(e) => setValueType(e.target.value as SavingsGoalValueType)}
              className="mt-1"
            >
              <option value="TRY">Türk lirası (TRY)</option>
              <option value="gram_altin">Gram altın</option>
              <option value="ceyrek_altin">Çeyrek altın</option>
              <option value="composite">Karma (birden fazla)</option>
            </Select>
          </label>

          {valueType === 'composite' ? (
            <div className="space-y-3 rounded-lg bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">Örn. evlilik: 29 gram + 1 çeyrek ayrı satırlarda.</p>
              {componentDrafts.map((draft, index) => (
                <div key={draft.key} className="space-y-2 rounded-lg bg-raised p-2.5 ring-1 ring-line-strong">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink-muted">Bileşen {index + 1}</span>
                    {componentDrafts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setComponentDrafts((rows) => rows.filter((row) => row.key !== draft.key))
                          // Bileşen gidince bağı da gitmeli; yoksa kaydetmede
                          // sahipsiz kalan kaynak sessizce düşerdi.
                          setSourceDrafts((rows) => rows.filter((row) => row.ownerKey !== draft.key))
                        }}
                        className="text-xs font-semibold text-destructive"
                      >
                        Kaldır
                      </button>
                    ) : null}
                  </div>
                  <Input
                    value={draft.label}
                    onChange={(e) =>
                      setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, label: e.target.value } : row)))
                    }
                    placeholder="Etiket (ör. Gram)"
                    className="h-10 text-sm"
                  />
                  <Select
                    value={draft.value_type}
                    onChange={(e) =>
                      setComponentDrafts((rows) =>
                        rows.map((row) =>
                          row.key === draft.key ? { ...row, value_type: e.target.value as SavingsGoalComponent['value_type'] } : row,
                        ),
                      )
                    }
                    className="h-10 text-sm"
                  >
                    <option value="TRY">TRY</option>
                    <option value="gram_altin">Gram altın</option>
                    <option value="ceyrek_altin">Çeyrek altın</option>
                  </Select>
                  {(() => {
                    const componentSources = sourceDrafts.filter((source) => source.ownerKey === draft.key)
                    const linked = componentSources.length > 0
                    return (
                      <>
                        <div className={linked ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2'}>
                          {/* Bileşen değerleri TL ya da gram olabilir (`draft.value_type`),
                              o yüzden MoneyInput değil; virgül kabul eden ondalık metin. */}
                          {linked ? null : (
                            <Input
                              value={draft.current_amount}
                              onChange={(e) =>
                                setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, current_amount: e.target.value } : row)))
                              }
                              type="text"
                              inputMode="decimal"
                              aria-label={`Bileşen ${index + 1} biriken`}
                              placeholder="Biriken"
                              className="h-10 text-sm tabular-nums"
                            />
                          )}
                          <Input
                            value={draft.target_amount}
                            onChange={(e) =>
                              setComponentDrafts((rows) => rows.map((row) => (row.key === draft.key ? { ...row, target_amount: e.target.value } : row)))
                            }
                            type="text"
                            inputMode="decimal"
                            aria-label={`Bileşen ${index + 1} hedef`}
                            placeholder="Hedef"
                            className="h-10 text-sm tabular-nums"
                            required
                          />
                        </div>
                        <GoalSourceEditor
                          drafts={componentSources}
                          valueType={draft.value_type}
                          refs={refs}
                          formatUnit={(amount) =>
                            formatComponentAmount({ value_type: draft.value_type }, amount)
                          }
                          onAdd={(token) => addSourceDraft(draft.key, token)}
                          onRemove={removeSourceDraft}
                        />
                      </>
                    )
                  })()}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setComponentDrafts((rows) => [...rows, newComponentDraft()])}
                className="text-sm font-semibold text-primary"
              >
                + Bileşen ekle
              </button>
            </div>
          ) : (
            <>
              {/* `valueType === 'TRY'` ise bu iki alan PARADIR → MoneyInput (TR virgülü
                  kabul eder, tutarı biçimlenmiş gösterir). Altın hedeflerinde aynı
                  alanlar gram/adet MİKTARIDIR; oraya TL önizlemesi basmak yanlış
                  olurdu, o yüzden yalnız `type="number"` yerine ondalık metin girişine
                  çevrildi — virgül sorunu orada da çözülür (denetim §6). */}
              <div className={goalIsLinked ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
                {valueType === 'TRY' ? (
                  <>
                    <MoneyInput label="Hedef miktar" value={targetAmount} onValueChange={setTargetAmount} required />
                    {/* Zorunlu DEĞİL: MoneyInput 0'ı boşa çeviriyor (blur), zorunlu
                        alanla birleşince "henüz hiç birikmedim" diyen yeni hedef
                        kaydedilemiyordu. Boş = 0. */}
                    {goalIsLinked ? null : (
                      <MoneyInput label="Biriken miktar" value={currentAmount} onValueChange={setCurrentAmount} />
                    )}
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium">
                      Hedef miktar
                      <Input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} type="text" inputMode="decimal" className="mt-1 tabular-nums" required />
                    </label>
                    {goalIsLinked ? null : (
                      <label className="block text-sm font-medium">
                        Biriken miktar
                        {/* Zorunlu değil: boş = 0 ("henüz birikmedim"). */}
                        <Input value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} type="text" inputMode="decimal" className="mt-1 tabular-nums" />
                      </label>
                    )}
                  </>
                )}
              </div>

              {/* Takip kaynağı: seçilirse biriken tutar elle girilmez, varlıklardan
                  türetilir — "borsa hedefimi her seferinde elle güncelliyorum"
                  sorununun çözümü budur. */}
              <div className="space-y-2 rounded-lg border border-dashed border-line-strong bg-page p-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Biriken tutarı nereden takip edelim?</p>
                  <p className="text-xs text-ink-muted">
                    {goalIsLinked
                      ? 'Tutar seçtiğin kaynaklardan otomatik hesaplanır; elle güncellemen gerekmez.'
                      : 'Kaynak seçmezsen biriken tutarı elle girersin.'}
                  </p>
                </div>
                <GoalSourceEditor
                  drafts={goalSourceDrafts}
                  valueType={valueType}
                  refs={refs}
                  formatUnit={(amount) =>
                    formatSavingsGoalAmount({ value_type: valueType, target_amount: 0, current_amount: 0 }, amount)
                  }
                  onAdd={(token) => addSourceDraft(null, token)}
                  onRemove={removeSourceDraft}
                />
              </div>
              {valueType === 'gram_altin' || valueType === 'ceyrek_altin' ? (
                <div className="space-y-3">
                  <label className="block text-sm font-medium">
                    Değerleme
                    <Select value={autoValued ? 'auto' : 'manual'} onChange={(e) => setAutoValued(e.target.value === 'auto')} className="mt-1">
                      <option value="auto">Otomatik (canlı kur)</option>
                      <option value="manual">Manuel</option>
                    </Select>
                  </label>
                  {autoValued ? (
                    <div className="rounded-lg border border-dashed border-line-strong bg-page px-3 py-2.5 text-sm">
                      <span className="text-ink-muted">Güncel değer: </span>
                      <span className="font-mono font-semibold tabular-nums text-ink">
                        {(() => {
                          // Bağlı hedefte miktar kaynaklardan gelir; elle girilen alan boştur.
                          const live = valueGoal({ value_type: valueType, current_amount: formCurrentAmount }, snapshot)
                          return live === null ? 'Kur bekleniyor…' : formatAmount(live)
                        })()}
                      </span>
                    </div>
                  ) : (
                    <MoneyInput label="Tahmini değer (TRY)" value={estimatedValueTry} onValueChange={setEstimatedValueTry} />
                  )}
                </div>
              ) : null}
            </>
          )}

          {/* Kasa kovası yalnız TL hedefte anlamlı: kova TL rezerv tutar, gram
              hedefinin "aylık gerekli"si gram cinsindendir. */}
          {valueType === 'TRY' ? (
            <label className="block text-sm font-medium">
              Kasa kovası
              {/* aria-label açık veriliyor: <label> içeriği seçeneklerle birleşince
                  erişilebilir ad "Kasa kovasıYok — …" gibi çıkıyor ve başka
                  alanların adıyla çakışıyordu. */}
              <Select
                value={bucketChoice}
                aria-label="Kasa kovası"
                onChange={(e) => setBucketChoice(e.target.value)}
                className="mt-1"
              >
                <option value="">Yok — harcanabilirden düşme</option>
                <option value={NEW_BUCKET}>Yeni kova oluştur</option>
                {(buckets ?? [])
                  .filter((bucket) => !bucket.goal_id || (editing && bucket.goal_id === editing.id))
                  .map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {bucket.name}
                    </option>
                  ))}
              </Select>
              <span className="mt-1 block text-xs font-normal text-ink-muted">
                Yeni kova hedefin adıyla açılır. Kovaya ayırdığın para "bu ay harcayabilirim" tutarından düşer; ayırma her ay tek tıkla yapılır.
              </span>
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Hedef tarih
              <Input value={targetDate} onChange={(e) => setTargetDate(e.target.value)} type="date" className="mt-1" />
            </label>
            <label className="block text-sm font-medium">
              Durum
              <Select value={status} onChange={(e) => setStatus(e.target.value as SavingsGoal['status'])} className="mt-1">
                <option value="active">Aktif</option>
                <option value="completed">Tamamlandı</option>
              </Select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Not
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" />
          </label>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </form>
      </SimpleModal>
      {confirmDialog}
    </section>
  )
}
