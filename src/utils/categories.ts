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

const categoryRules: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Market',
    keywords: ['market', 'migros', 'bim', 'a101', 'şok', 'sok', 'carrefour', 'macrocenter', 'kasap', 'manav'],
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

export function inferExpenseCategory(description: string) {
  const normalized = description.trim().toLocaleLowerCase('tr-TR')
  if (!normalized) return null

  return categoryRules.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)))?.category ?? null
}
