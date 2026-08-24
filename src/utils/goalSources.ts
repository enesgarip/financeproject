/**
 * Birikim hedefinin biriken tutarını varlıklardan/hesaplardan türetme (saf).
 *
 * Hedef bir ya da birden çok "takip kaynağına" bağlanabilir (varlık satırı,
 * varlık kategorisi, tüm varlıklar, banka hesabı, kasa kovası). Bağ varsa
 * `current_amount` elle girilmez ve SAKLANMAZ: burada, okuma anında türetilir.
 * Gerekçe DB tarafında da yazılı (20260824100000_savings_goal_sources.sql) —
 * canlı BIST fiyatı ve kur snapshot'ı yalnız client'ta olduğu için tek doğru
 * hesap yeri burasıdır; saklanan kopya bayat kalırdı.
 *
 * Birim duyarlıdır. TRY hedefte kaynaklar TL değerine çevrilir; gram/çeyrek
 * altın hedefinde altın varlıklarının MİKTARI (gram/adet) toplanır — banka
 * bakiyesi ya da kova rezervi bu birimde anlamlı olmadığı için "kullanılamaz"
 * olarak işaretlenir (arayüz bunu kullanıcıya söyler, sessizce 0 saymaz).
 *
 * Dışa açılan asıl işlev `resolveSavingsGoalRows`: hedef/bileşen satırlarının
 * KOPYASINI türetilmiş `current_amount` ile döndürür. Böylece mevcut tüketiciler
 * (savingsGoal.ts, savingsSuggestion, DataHealth, analiz dökümü) değişmeden
 * doğru sayıyı okur.
 */
import type {
  Asset,
  AssetCategory,
  Card,
  KasaBucket,
  SavingsGoal,
  SavingsGoalComponent,
  SavingsGoalSource,
  SavingsGoalValueType,
} from '../types/database'
import type { MarketRatesSnapshot } from './marketRates'
import { roundTL, sumTL } from './money'
import { savingsGoalTargetReached } from './savingsGoal'
import { effectiveAssetValue, type StockPrices } from './valuation'

/** Kaynakların çözüleceği veri kümesi. Canlı fiyat/kur yoksa saklı değere düşülür. */
export type GoalSourceRefs = {
  assets: Asset[]
  /** Banka hesapları dahil tüm kartlar; yalnız `banka_karti` bakiyesi kullanılır. */
  cards?: Card[]
  buckets?: KasaBucket[]
  snapshot?: MarketRatesSnapshot | null
  stockPrices?: StockPrices | null
}

/**
 * Çözüm için yeterli olan asgari kaynak şekli. Kaydedilmiş satır da (SavingsGoalSource),
 * formda henüz kaydedilmemiş taslak da bu şekle uyar — önizleme aynı hesabı kullanabilsin diye.
 */
export type GoalSourceLike = Pick<SavingsGoalSource, 'kind' | 'asset_id' | 'asset_category' | 'card_id' | 'bucket_id'>

/** Kaynaktan türetilen tek satırlık sonuç. */
export type GoalSourceResolution<T extends GoalSourceLike = SavingsGoalSource> = {
  /** Türetilen tutar, hedefin biriminde (TL ya da gram/adet). */
  amount: number
  /** Tutara katkı veren kaynak sayısı. */
  matched: number
  /** Bu birimde çözülemeyen kaynaklar (ör. altın hedefine bağlı banka hesabı). */
  unusable: T[]
  /** Referansı silinmiş/bulunamamış kaynaklar. */
  missing: T[]
}

type ResolvableUnit = Exclude<SavingsGoalValueType, 'composite'>

function goldUnitFor(valueType: ResolvableUnit): Asset['unit'] | null {
  if (valueType === 'gram_altin') return 'gram'
  if (valueType === 'ceyrek_altin') return 'adet'
  return null
}

/** Hedefin birimine sayılabilecek varlıklar (TRY'de hepsi, altında yalnız o birimdeki altın). */
function assetCountsForUnit(asset: Asset, valueType: ResolvableUnit): boolean {
  const goldUnit = goldUnitFor(valueType)
  if (goldUnit === null) return true
  return asset.category === 'Altın' && asset.unit === goldUnit
}

function assetAmountForUnit(asset: Asset, valueType: ResolvableUnit, refs: GoalSourceRefs): number {
  if (goldUnitFor(valueType) !== null) return asset.amount
  return effectiveAssetValue(asset, refs.snapshot, refs.stockPrices)
}

/** Kaynak türlerinin altın (miktar) hedefinde karşılığı yoktur; TL'ye özgüdür. */
function isMoneyOnlyKind(source: GoalSourceLike): boolean {
  return source.kind === 'bank_account' || source.kind === 'kasa_bucket'
}

type SingleSourceOutcome =
  | { status: 'ok'; amount: number }
  /** Kaynak bu birimde kullanılamaz (ör. altın hedefine bağlı banka hesabı). */
  | { status: 'unusable' }
  /** Referans edilen satır artık yok. */
  | { status: 'missing' }

function resolveSingleSource(
  source: GoalSourceLike,
  valueType: ResolvableUnit,
  refs: GoalSourceRefs,
): SingleSourceOutcome {
  const isGold = goldUnitFor(valueType) !== null

  if (isGold && isMoneyOnlyKind(source)) return { status: 'unusable' }

  switch (source.kind) {
    case 'asset': {
      const asset = refs.assets.find((row) => row.id === source.asset_id)
      if (!asset) return { status: 'missing' }
      if (!assetCountsForUnit(asset, valueType)) return { status: 'unusable' }
      return { status: 'ok', amount: assetAmountForUnit(asset, valueType, refs) }
    }
    case 'asset_category': {
      // Kategori bağı boş olabilir (henüz o kategoride varlık yok) — bu bir
      // hata değil, 0'dır. Altın hedefinde altın DIŞI kategori kullanılamaz.
      if (isGold && source.asset_category !== 'Altın') return { status: 'unusable' }
      const rows = refs.assets.filter(
        (row) => row.category === source.asset_category && assetCountsForUnit(row, valueType),
      )
      return { status: 'ok', amount: sumTL(rows.map((row) => assetAmountForUnit(row, valueType, refs))) }
    }
    case 'all_assets': {
      const rows = refs.assets.filter((row) => assetCountsForUnit(row, valueType))
      return { status: 'ok', amount: sumTL(rows.map((row) => assetAmountForUnit(row, valueType, refs))) }
    }
    case 'bank_account': {
      const card = (refs.cards ?? []).find((row) => row.id === source.card_id)
      if (!card) return { status: 'missing' }
      if (card.card_type !== 'banka_karti') return { status: 'unusable' }
      return { status: 'ok', amount: card.current_balance }
    }
    case 'kasa_bucket': {
      const bucket = (refs.buckets ?? []).find((row) => row.id === source.bucket_id)
      if (!bucket) return { status: 'missing' }
      return { status: 'ok', amount: bucket.reserved_amount }
    }
    default:
      return { status: 'unusable' }
  }
}

/**
 * Bir satırın (hedef ya da bileşen) kaynaklarını tek tutara indirger.
 *
 * "Tüm varlıklar" bağı diğer bağları GEREKSİZ kılar ama ikisi birden seçilirse
 * aynı varlık iki kez sayılırdı; bu yüzden `all_assets` varsa yalnız o kullanılır.
 */
export function resolveGoalSources<T extends GoalSourceLike>(
  sources: T[],
  valueType: ResolvableUnit,
  refs: GoalSourceRefs,
): GoalSourceResolution<T> {
  if (sources.length === 0) return { amount: 0, matched: 0, unusable: [], missing: [] }

  const hasAllAssets = sources.some((source) => source.kind === 'all_assets')
  const effective = hasAllAssets
    ? sources.filter((source) => source.kind === 'all_assets' || isMoneyOnlyKind(source))
    : sources

  const amounts: number[] = []
  const unusable: T[] = []
  const missing: T[] = []

  for (const source of effective) {
    const outcome = resolveSingleSource(source, valueType, refs)
    if (outcome.status === 'ok') amounts.push(outcome.amount)
    else if (outcome.status === 'unusable') unusable.push(source)
    else missing.push(source)
  }

  return { amount: roundTL(sumTL(amounts)), matched: amounts.length, unusable, missing }
}

export type ResolvedSavingsGoals = {
  goals: SavingsGoal[]
  components: SavingsGoalComponent[]
  /** goal_id → türetme sonucu (yalnız kaynağa bağlı hedefler). */
  goalResolutions: Map<string, GoalSourceResolution>
  /** component_id → türetme sonucu (yalnız kaynağa bağlı bileşenler). */
  componentResolutions: Map<string, GoalSourceResolution>
}

function sourcesFor(sources: SavingsGoalSource[], goalId: string, componentId: string | null) {
  return sources
    .filter((source) => source.goal_id === goalId && source.component_id === componentId)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Hedef ve bileşen satırlarını türetilmiş `current_amount` ile döndürür.
 * Kaynağı olmayan satırlar aynen (referans olarak) geçer.
 *
 * Karma hedefte ana satırın sayaçları (`target_amount` = bileşen sayısı,
 * `current_amount` = hedefine ulaşan bileşen sayısı) TÜRETİLMİŞ bileşenlerden
 * yeniden hesaplanır: DB bu sayıyı bağlı bileşen için bilemez, çünkü hesabı
 * canlı fiyat gerektirir.
 */
export function resolveSavingsGoalRows(
  goals: SavingsGoal[],
  components: SavingsGoalComponent[],
  sources: SavingsGoalSource[],
  refs: GoalSourceRefs,
): ResolvedSavingsGoals {
  const goalResolutions = new Map<string, GoalSourceResolution>()
  const componentResolutions = new Map<string, GoalSourceResolution>()

  if (sources.length === 0) {
    return { goals, components, goalResolutions, componentResolutions }
  }

  const resolvedComponents = components.map((component) => {
    const rows = sourcesFor(sources, component.goal_id, component.id)
    if (rows.length === 0) return component
    const resolution = resolveGoalSources(rows, component.value_type, refs)
    componentResolutions.set(component.id, resolution)
    return { ...component, current_amount: resolution.amount }
  })

  const resolvedGoals = goals.map((goal) => {
    if (goal.value_type === 'composite') {
      const rows = resolvedComponents.filter((component) => component.goal_id === goal.id)
      const touched = rows.some((component) => componentResolutions.has(component.id))
      if (!touched) return goal
      return {
        ...goal,
        target_amount: rows.length,
        current_amount: rows.filter(savingsGoalTargetReached).length,
      }
    }

    const rows = sourcesFor(sources, goal.id, null)
    if (rows.length === 0) return goal
    const resolution = resolveGoalSources(rows, goal.value_type, refs)
    goalResolutions.set(goal.id, resolution)
    return { ...goal, current_amount: resolution.amount }
  })

  return { goals: resolvedGoals, components: resolvedComponents, goalResolutions, componentResolutions }
}

// --- Form tarafı: kaynak = tek bir metin jetonu ----------------------------
//
// Arayüzde kaynak seçimi tek bir <select> ile yapılır; jeton ("asset:<id>",
// "cat:Hisse", "all", "bank:<id>", "bucket:<id>") seçeneği kaynağa çevirmenin
// tek yeridir. Panelin kolon eşlemesini bilmesi gerekmesin diye burada durur.

export function goalSourceToken(source: GoalSourceLike): string {
  switch (source.kind) {
    case 'asset':
      return `asset:${source.asset_id ?? ''}`
    case 'asset_category':
      return `cat:${source.asset_category ?? ''}`
    case 'all_assets':
      return 'all'
    case 'bank_account':
      return `bank:${source.card_id ?? ''}`
    case 'kasa_bucket':
      return `bucket:${source.bucket_id ?? ''}`
    default:
      return ''
  }
}

/** Jetonu kaynak alanlarına çevirir; tanınmayan jeton null (sessiz kaynak yazılmaz). */
export function parseGoalSourceToken(token: string): GoalSourceLike | null {
  const empty = { asset_id: null, asset_category: null, card_id: null, bucket_id: null }
  if (token === 'all') return { ...empty, kind: 'all_assets' }

  const separator = token.indexOf(':')
  if (separator < 0) return null
  const prefix = token.slice(0, separator)
  const value = token.slice(separator + 1)
  if (!value) return null

  if (prefix === 'asset') return { ...empty, kind: 'asset', asset_id: value }
  if (prefix === 'cat') return { ...empty, kind: 'asset_category', asset_category: value as AssetCategory }
  if (prefix === 'bank') return { ...empty, kind: 'bank_account', card_id: value }
  if (prefix === 'bucket') return { ...empty, kind: 'kasa_bucket', bucket_id: value }
  return null
}

export type GoalSourceOption = { token: string; label: string; group: string }

/**
 * Seçilebilecek kaynaklar. `valueType` altınsa yalnız o birimde ANLAMLI olanlar
 * listelenir — kullanıcıya seçtirip sonra "kullanılamaz" demek yerine.
 */
export function goalSourceOptions(refs: GoalSourceRefs, valueType: ResolvableUnit): GoalSourceOption[] {
  const isGold = goldUnitFor(valueType) !== null
  const options: GoalSourceOption[] = [{ token: 'all', label: 'Tüm varlıklarım', group: 'Genel' }]

  const categories = [...new Set(refs.assets.filter((asset) => assetCountsForUnit(asset, valueType)).map((asset) => asset.category))]
  for (const category of categories) {
    options.push({ token: `cat:${category}`, label: `${category} (tümü)`, group: 'Varlık kategorisi' })
  }

  for (const asset of refs.assets) {
    if (!assetCountsForUnit(asset, valueType)) continue
    options.push({ token: `asset:${asset.id}`, label: asset.name, group: 'Varlık' })
  }

  if (!isGold) {
    for (const card of refs.cards ?? []) {
      if (card.card_type !== 'banka_karti') continue
      options.push({ token: `bank:${card.id}`, label: `${card.bank_name} · ${card.card_name}`, group: 'Banka hesabı' })
    }
    for (const bucket of refs.buckets ?? []) {
      options.push({ token: `bucket:${bucket.id}`, label: bucket.name, group: 'Kasa kovası' })
    }
  }

  return options
}

/**
 * "Bu hedefi bağlamak ister misin?" önerisi.
 *
 * Elle girilen biriken tutar bir kaynağın toplamına çok yakınsa, kullanıcı
 * aslında o kaynağı elle kopyalıyordur — özelliğin varlığını keşfetmesi için
 * beklemek yerine söylüyoruz. Yalnız ÖNERİ: bağlama tek tıkla ve kullanıcının
 * onayıyla olur.
 *
 * Eşik oransal (varsayılan %2): 350.000 TL'lik portföyde 7.000 TL sapma hâlâ
 * "aynı şeyi kastediyor" demek, 100 TL'lik kovada 2 TL sapma da öyle.
 */
export type GoalSourceSuggestion = {
  token: string
  label: string
  /** Kaynağın şu anki tutarı (hedefin biriminde). */
  amount: number
  /** |elle girilen − kaynak| / kaynak. */
  diffRatio: number
}

/** Eşitlikte hangi kaynak türü önerilsin: dar ama kalıcı olan önce. */
const SUGGESTION_KIND_ORDER: SavingsGoalSource['kind'][] = [
  'asset_category',
  'asset',
  'bank_account',
  'kasa_bucket',
  'all_assets',
]

export function suggestGoalSource(
  goal: Pick<SavingsGoal, 'value_type' | 'current_amount'>,
  refs: GoalSourceRefs,
  tolerance = 0.02,
): GoalSourceSuggestion | null {
  if (goal.value_type === 'composite') return null
  if (!(goal.current_amount > 0)) return null

  let best: (GoalSourceSuggestion & { rank: number }) | null = null

  for (const option of goalSourceOptions(refs, goal.value_type)) {
    const parsed = parseGoalSourceToken(option.token)
    if (!parsed) continue

    const { amount, matched } = resolveGoalSources([parsed], goal.value_type, refs)
    // Boş kaynak (henüz o kategoride varlık yok) 0 döner; 0'a "yakın" bir hedef
    // önermek anlamsız olurdu.
    if (matched === 0 || amount <= 0) continue

    const diffRatio = Math.abs(amount - goal.current_amount) / amount
    if (diffRatio > tolerance) continue

    const rank = SUGGESTION_KIND_ORDER.indexOf(parsed.kind)
    if (best === null || diffRatio < best.diffRatio - 1e-9 || (Math.abs(diffRatio - best.diffRatio) <= 1e-9 && rank < best.rank)) {
      best = { token: option.token, label: option.label, amount, diffRatio, rank }
    }
  }

  if (!best) return null
  return { token: best.token, label: best.label, amount: best.amount, diffRatio: best.diffRatio }
}

/** Kaynağın kullanıcıya gösterilecek adı. */
export function goalSourceLabel(source: GoalSourceLike, refs: GoalSourceRefs): string {
  switch (source.kind) {
    case 'asset': {
      const asset = refs.assets.find((row) => row.id === source.asset_id)
      return asset ? asset.name : 'Silinmiş varlık'
    }
    case 'asset_category':
      return `${source.asset_category} (tüm varlıklar)`
    case 'all_assets':
      return 'Tüm varlıklarım'
    case 'bank_account': {
      const card = (refs.cards ?? []).find((row) => row.id === source.card_id)
      return card ? `${card.bank_name} · ${card.card_name}` : 'Silinmiş hesap'
    }
    case 'kasa_bucket': {
      const bucket = (refs.buckets ?? []).find((row) => row.id === source.bucket_id)
      return bucket ? `Kasa: ${bucket.name}` : 'Silinmiş kova'
    }
    default:
      return 'Bilinmeyen kaynak'
  }
}
