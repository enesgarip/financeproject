export const expenseCategories = [
  'Market',
  'Yemek',
  'Ulaşım',
  'Alışveriş',
  'Fatura',
  'Sağlık',
  'Eğlence',
  'Eğitim',
  'Diğer',
]

export const expenseCategoryOptions = expenseCategories.map((category) => ({
  label: category,
  value: category,
}))

export const categoryRules: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Market',
    keywords: ['market', 'migros', 'bim', 'a101', 'şok', 'sok', 'carrefour', 'carrefoursa', 'macrocenter', 'kasap', 'manav'],
  },
  {
    category: 'Yemek',
    keywords: ['yemek', 'restoran', 'restaurant', 'cafe', 'kahve', 'starbucks', 'yemeksepeti', 'getir yemek', 'burger', 'pizza', 'döner', 'doner', 'kebap'],
  },
  {
    category: 'Ulaşım',
    keywords: ['ulaşım', 'ulasim', 'benzin', 'yakıt', 'yakit', 'petrol', 'shell', 'opet', 'bp', 'total', 'taksi', 'uber', 'metro', 'marmaray', 'akbil', 'otobüs', 'otobus'],
  },
  {
    category: 'Fatura',
    keywords: ['fatura', 'elektrik', 'su faturası', 'su faturasi', 'doğalgaz', 'dogalgaz', 'internet', 'abonelik', 'turkcell', 'vodafone', 'türk telekom', 'turk telekom', 'superonline'],
  },
  {
    category: 'Sağlık',
    keywords: ['sağlık', 'saglik', 'eczane', 'hastane', 'doktor', 'diş', 'dis', 'medikal'],
  },
  {
    category: 'Eğitim',
    keywords: ['eğitim', 'egitim', 'okul', 'kurs', 'kitap', 'udemy', 'kırtasiye', 'kirtasiye'],
  },
  {
    category: 'Eğlence',
    keywords: ['eğlence', 'eglence', 'sinema', 'konser', 'tiyatro', 'netflix', 'spotify', 'oyun', 'etkinlik'],
  },
  {
    category: 'Alışveriş',
    keywords: ['alışveriş', 'alisveris', 'trendyol', 'hepsiburada', 'amazon', 'n11', 'giyim', 'zara', 'lcw', 'teknosa', 'media markt', 'telefon'],
  },
]

export function normalizeDescription(description: string) {
  // Map Turkish capital I-variants to dotted 'i' BEFORE lowercasing. tr-TR
  // lowercasing folds 'I' → dotless 'ı', so ALL-CAPS bank-statement merchants
  // like "MIGROS"/"BIM"/"NETFLIX" became "mıgros"/"bım"/"netflıx" and never
  // matched the dotted-i keywords. ş/ğ/ç/ö/ü still fold correctly via toLowerCase.
  return description.trim().replace(/[Iİ]/g, 'i').toLowerCase().replace(/\s+/g, ' ')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a whole-word matcher for a rule's keywords. Matching on word
 * boundaries (instead of a raw substring `includes`) stops short keywords from
 * latching onto unrelated words — e.g. the Ulaşım keyword "taksi" must not match
 * "taksit"/"taksitli", which previously dumped every instalment purchase into
 * Ulaşım. The boundaries use \p{L}/\p{N} (Unicode-aware so Turkish letters
 * count as word characters) and avoid lookbehind for older Safari/iOS support.
 */
function keywordMatcher(keywords: string[]) {
  const alternation = keywords.map(escapeRegExp).join('|')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'u')
}

const categoryMatchers = categoryRules.map((rule) => ({
  category: rule.category,
  matcher: keywordMatcher(rule.keywords),
}))

export function inferExpenseCategory(description: string) {
  const normalized = normalizeDescription(description)
  if (!normalized) return null

  return categoryMatchers.find((rule) => rule.matcher.test(normalized))?.category ?? null
}

/** A learned lookup of (normalized description → category) built from past expenses. */
export type CategoryMemory = Map<string, string>

/**
 * Build a category memory from the user's previous expenses. For each distinct
 * description, the most frequently used category wins (ties favour the most
 * recent, so pass rows newest-first). Only known categories are kept.
 */
export function buildCategoryMemory(rows: Array<{ description: string | null; category: string | null }>): CategoryMemory {
  const counts = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const key = normalizeDescription(row.description ?? '')
    const category = (row.category ?? '').trim()
    if (!key || !category || !expenseCategories.includes(category)) continue
    const inner = counts.get(key) ?? new Map<string, number>()
    inner.set(category, (inner.get(category) ?? 0) + 1)
    counts.set(key, inner)
  }

  const memory: CategoryMemory = new Map()
  for (const [key, inner] of counts) {
    let best = ''
    let bestCount = -1
    for (const [category, count] of inner) {
      if (count > bestCount) {
        best = category
        bestCount = count
      }
    }
    if (best) memory.set(key, best)
  }
  return memory
}

/** Why a category was suggested — powers the "neden bu kategoride?" UI. */
export type CategorySuggestion = {
  category: string
  /** memory = user's own past expenses; keyword = built-in dictionary. */
  source: 'memory-exact' | 'memory-partial' | 'keyword'
  /** The remembered description (memory) or the dictionary keyword that matched. */
  match: string
}

/**
 * Suggest a category for a description, with the reason. The user's own
 * history (memory) wins over the built-in keyword dictionary; an exact
 * normalized match is preferred, then a partial match, then keyword rules.
 */
export function explainExpenseCategory(description: string, memory?: CategoryMemory): CategorySuggestion | null {
  const normalized = normalizeDescription(description)
  if (!normalized) return null

  if (memory && memory.size > 0) {
    const exact = memory.get(normalized)
    if (exact) return { category: exact, source: 'memory-exact', match: normalized }

    for (const [key, category] of memory) {
      if (key.length >= 3 && (normalized.includes(key) || key.includes(normalized))) {
        return { category, source: 'memory-partial', match: key }
      }
    }
  }

  for (const { category, matcher } of categoryMatchers) {
    if (matcher.test(normalized)) {
      const rule = categoryRules.find((r) => r.category === category)
      const keyword = rule?.keywords.find((k) => keywordMatcher([k]).test(normalized)) ?? rule?.keywords[0] ?? ''
      return { category, source: 'keyword', match: keyword }
    }
  }

  return null
}

/** Suggest a category for a description (see explainExpenseCategory for the why). */
export function suggestExpenseCategory(description: string, memory?: CategoryMemory): string | null {
  return explainExpenseCategory(description, memory)?.category ?? null
}
