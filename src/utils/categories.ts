/**
 * Harcama kategorisi tahmini. İki kaynak, öncelik sırasıyla:
 *  1. Kullanıcının geçmişi (CategoryMemory) — aynı açıklamaya daha önce hangi
 *     kategoriyi verdiyse onu öğrenir (en sık kullanılan kazanır).
 *  2. Yerleşik anahtar kelime sözlüğü (categoryRules) — "migros"→Market gibi.
 *
 * İki incelik:
 *  - normalizeDescription tr-TR büyük-I tuzağını çözer (bkz. searchText.ts).
 *  - Eşleşme TAM KELİME sınırıyla yapılır (substring değil): "taksi" anahtarı
 *    "taksit"e yapışmasın diye (eskiden tüm taksitli alışveriş Ulaşım'a düşüyordu).
 * SMS harcama otomasyonu da inferExpenseCategory'yi kullanır.
 */
import { normalizeSearchText } from './searchText'

export const expenseCategories = [
  'Market',
  // 2026-08-16'da 'Yemek' → 'Yeme & İçme' yeniden adlandırıldı (kafe/kahve de
  // buraya girer). SIRA KORUNDU: viz rengi kanonik indeksten geldiği için
  // ikinci slotta kalınca grafik renkleri kaymaz. Kanonik DEĞER değişti, yani
  // eski satırlar migration `20260816120000` ile güncellendi — kodda 'Yemek'
  // dizesi kalmamalı (parse-sms/parse-receipt edge fonksiyonları dahil).
  'Yeme & İçme',
  'Ulaşım',
  'Alışveriş',
  'Fatura',
  'Sağlık',
  'Eğlence',
  'Eğitim',
  // Yeni kategoriler LİSTE SONUNA (Diğer'den önce) eklenir: vizPalette renkleri
  // kanonik sıradan slot alır, yani ilk 8 kategori mevcut renklerini korur ve
  // yeni gelenler viz-9..13'e düşer (renk kayması olmaz).
  'Konut',
  'Abonelik',
  'İş',
  'Kişisel Bakım',
  'Hediye',
  // Finansman = paranın kendisinin maliyeti: nakit avans (peşin/taksitli),
  // faiz, BSMV/KKDF, gecikme, kart aidatı. Tüketim DEĞİLDİR; ayrı durması
  // "bu ay krediye ne ödedim" sorusunu Diğer'in içinden çıkarır.
  'Finansman',
  'Diğer',
]

export const expenseCategoryOptions = expenseCategories.map((category) => ({
  label: category,
  value: category,
}))

export const categoryRules: Array<{ category: string; keywords: string[] }> = [
  {
    // SIRADA ÖNCE: 'aidat' Konut kuralında da var; Finansman sonra gelseydi
    // "kart aidatı" Konut'a düşerdi. Anahtarlar çok spesifik olduğu için
    // başta olmaları başka kategoriyi çalmaz.
    category: 'Finansman',
    keywords: [
      'nakit avans', 'avans', 'faiz', 'bsmv', 'kkdf', 'gecikme',
      // YALNIZ "kart aidatı" — çıplak 'aidat*' buraya KONMAZ, yoksa apartman
      // aidatı Konut yerine Finansman'a düşer (Konut sırada sonra).
      'kart aidatı', 'kart ücreti', 'yıllık ücret', 'komisyon ücreti',
    ],
  },
  {
    category: 'Market',
    keywords: ['market', 'migros', 'bim', 'a101', 'şok', 'carrefour', 'carrefoursa', 'macrocenter', 'kasap', 'manav', 'gıda', 'bakkal'],
  },
  {
    // Kafe/kahve bu kategoriye DAHİLDİR. Gerçek ekstre satırlarıyla ölçüldü
    // (2026-08-16): 'cafe' varken Türkçe 'kafe' yoktu, 'starbucks' varken
    // bankanın bastığı 'sbux'/'sbx' kısaltması yoktu → "PETROV KAFE",
    // "COFFEE SINKY", "SBX İZM KORDON" gibi satırlar Diğer'e düşüyordu.
    // Yeni satıcı eklerken bankanın BASTIĞI biçimi ekle, ticari adı değil.
    category: 'Yeme & İçme',
    keywords: [
      'yemek', 'restoran', 'restaurant', 'lokanta', 'bistro', 'meyhane',
      'cafe', 'kafe', 'coffee', 'kahve', 'kahvaltı', 'kahvalti', 'çay', 'cay',
      'starbucks', 'sbux', 'sbx', 'gloria jeans', 'nero', 'caribou', 'espressolab',
      // 'trendyol yemek' burada KAZANIR çünkü bu kural Alışveriş'ten (trendyol)
      // önce gelir. 'migros yemek' eklenmedi: Market kuralı sırada daha önce
      // olduğu için ölü anahtar olurdu.
      'yemeksepeti', 'getir yemek', 'trendyol yemek',
      'burger', 'pizza', 'döner', 'doner', 'kebap', 'kebab', 'köfte', 'kofte',
      'köfteci', 'kofteci', 'pastane', 'fırın', 'firin', 'tatlı', 'tatli',
      'dondurma', 'waffle', 'salata', 'pide', 'lahmacun', 'çiğköfte', 'cigkofte',
    ],
  },
  {
    // Ekstredeki "SEYAHAT & ULAŞIM" bölümü de buraya düştüğü için otel/turizm
    // anahtarları burada (bkz. denizBankStatementParser SECTION_CATEGORY).
    // Çekimli biçimler AYRI anahtardır: eşleşme tam-kelimedir, 'otopark'
    // "OTOPARKLAR"ı tutmaz.
    category: 'Ulaşım',
    keywords: [
      'ulaşım', 'benzin', 'yakıt', 'akaryakıt', 'petrol', 'shell', 'opet', 'bp', 'total',
      'taksi', 'uber', 'metro', 'marmaray', 'akbil', 'otobüs', 'otogar',
      'hgs', 'ogs', 'otoyol', 'köprü', 'otopark', 'otoparklar', 'burulaş',
      'otel', 'otelcilik', 'turizm', 'termal', 'hilton',
    ],
  },
  {
    // 'abonelik' kasıtlı olarak burada YOK → yeni Abonelik kategorisine taşındı
    // (Fatura kuralı sırada önce geldiği için burada kalsaydı Abonelik hiç kazanamazdı).
    // Belediye su idareleri ADIYLA basılır ("BUSKİ - BURSA SU"), 'su faturası'
    // ile eşleşmez; çıplak 'su' ise her satıcıya yapışırdı → idare kısaltmaları.
    category: 'Fatura',
    keywords: [
      'fatura', 'elektrik', 'su faturası', 'doğalgaz', 'internet',
      'turkcell', 'vodafone', 'türk telekom', 'superonline',
      'buski', 'iski', 'aski', 'muski', 'izsu', 'asat',
    ],
  },
  {
    // 'eczanesi' AYRI anahtar: eşleşme tam-kelimedir, 'eczane' "ECZANESİ"yi
    // tutmaz. Ölçümde iki eczane satırı bu yüzden Diğer'e düşüyordu.
    category: 'Sağlık',
    keywords: ['sağlık', 'eczane', 'eczanesi', 'hastane', 'doktor', 'diş', 'medikal', 'veteriner', 'optik'],
  },
  {
    category: 'Eğitim',
    keywords: ['eğitim', 'egitim', 'okul', 'kurs', 'kitap', 'udemy', 'kırtasiye', 'kirtasiye'],
  },
  {
    category: 'Eğlence',
    keywords: [
      'eğlence', 'sinema', 'konser', 'tiyatro', 'netflix', 'spotify', 'oyun', 'etkinlik',
      'supercellstore', 'supercell', 'steam', 'playstation', 'xbox', 'nintendo', 'muze', 'müze',
    ],
  },
  {
    category: 'Alışveriş',
    keywords: ['alışveriş', 'alisveris', 'trendyol', 'hepsiburada', 'amazon', 'n11', 'giyim', 'zara', 'lcw', 'teknosa', 'media markt', 'telefon'],
  },
  {
    // Konut = barınma sabit giderleri (kira/aidat/emlak). Elektrik/su/doğalgaz
    // fatura olduğu için Fatura'da kalır; burada onlar YOK.
    // 'aidatı' çekimli biçim olarak ayrıca gerekir; "kart aidatı" yukarıdaki
    // Finansman kuralında daha önce yakalandığı için buraya düşmez.
    category: 'Konut',
    keywords: ['kira', 'aidat', 'aidatı', 'emlak', 'konut', 'apartman', 'ipotek'],
  },
  {
    // Abonelik = yazılım/bulut/dijital abonelikler. Netflix/Spotify kasıtlı olarak
    // Eğlence'de bırakıldı (mevcut geçmiş/memory bozulmasın) — burada YOK.
    // 'youtube' tek başına yeterli — 'google' EKLENMEZ, yoksa bu kural sırada
    // İş'ten önce olduğu için "GOOGLE ADS" reklam harcaması Abonelik'e düşerdi.
    // 'amazonprimet' bankanın bastığı biçimdir; Alışveriş'teki 'amazon'
    // tam-kelime olduğu için o token'ı zaten tutmuyor.
    category: 'Abonelik',
    keywords: [
      'abonelik', 'abone', 'icloud', 'google one', 'youtube', 'youtube premium',
      'apple.com', 'amazon prime', 'amazonprimet', 'disney', 'blutv', 'exxen', 'gain',
    ],
  },
  {
    // İş = gelir getirici/işletme harcamaları (reklam, hosting, komisyon).
    category: 'İş',
    keywords: ['reklam', 'google ads', 'meta ads', 'hosting', 'domain', 'alan adı', 'alan adi', 'sunucu', 'komisyon'],
  },
  {
    category: 'Kişisel Bakım',
    keywords: ['kuaför', 'kuafor', 'berber', 'güzellik', 'guzellik', 'kozmetik', 'spa', 'masaj', 'gratis', 'sephora', 'watsons', 'rossmann', 'gym', 'fitness'],
  },
  {
    category: 'Hediye',
    keywords: ['hediye', 'bağış', 'bagis', 'çiçek', 'cicek', 'kızılay', 'kizilay', 'lösev', 'losev', 'ahbap'],
  },
]

export function normalizeDescription(description: string) {
  // Map Turkish capital I-variants to dotted 'i' BEFORE lowercasing. tr-TR
  // lowercasing folds 'I' → dotless 'ı', so ALL-CAPS bank-statement merchants
  // like "MIGROS"/"BIM"/"NETFLIX" became "mıgros"/"bım"/"netflıx" and never
  // matched the dotted-i keywords. ş/ğ/ç/ö/ü still fold correctly via toLowerCase.
  return normalizeSearchText(description)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Eşleştirme İÇİN Türkçe aksanlarını ASCII'ye katlar. YALNIZ anahtar kelime
 * eşleşmesinde kullanılır — `normalizeDescription` dokunulmadan kalır, çünkü o
 * aynı zamanda CategoryMemory'nin ANAHTARIDIR ve değişirse öğrenilmiş geçmiş
 * eşleşmeleri kaybolur.
 *
 * Neden gerekli: `normalizeSearchText` yalnız I/İ→i katlar, ş/ğ/ç/ö/ü/ı'ya
 * dokunmaz. Bu yüzden ALL-CAPS Türkçe satıcı adı HİBRİT bir forma düşer ve
 * hiçbir sözlük varyantı tutmaz:
 *   "AKUĞUR ALIŞVERİŞ MERKEZİ" → "akuğur alişveriş merkezi"
 *   ('alışveriş' noktasız ı taşır, 'alisveris' aksansızdır → ikisi de tutmaz)
 * Katlamadan sonra her iki taraf da "alisveris" olur. Ölçüldü (2026-08-16):
 * gerçek ekstrede Sağlık/Abonelik/Eğlence 0 kayıt görünüyordu, sebebi buydu —
 * kategoriler kullanılmıyor değildi, sözlük satırı tanıyamıyordu.
 */
function foldForMatch(value: string) {
  return value
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
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
  // Anahtarlar da katlanır ki her iki taraf aynı uzayda karşılaşsın; katlama
  // sonrası oluşan yinelenenler ('yakıt'/'yakit' → 'yakit') elenir.
  const folded = [...new Set(keywords.map((keyword) => foldForMatch(keyword)))]
  const alternation = folded.map(escapeRegExp).join('|')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'u')
}

const categoryMatchers = categoryRules.map((rule) => ({
  category: rule.category,
  matcher: keywordMatcher(rule.keywords),
}))

export function inferExpenseCategory(description: string) {
  const normalized = normalizeDescription(description)
  if (!normalized) return null

  const folded = foldForMatch(normalized)
  return categoryMatchers.find((rule) => rule.matcher.test(folded))?.category ?? null
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

  // Hafıza aramaları normalize edilmiş (katlanmamış) anahtarla yapılır; yalnız
  // sözlük eşleşmesi katlanmış uzayda çalışır (bkz. foldForMatch).
  const folded = foldForMatch(normalized)
  for (const { category, matcher } of categoryMatchers) {
    if (matcher.test(folded)) {
      const rule = categoryRules.find((r) => r.category === category)
      // Gösterilen anahtar sözlükteki ORİJİNAL yazımdır ("neden bu kategoride?"
      // kutusunda kullanıcı katlanmış hâli görmesin), eşleşme katlanmış test edilir.
      const keyword = rule?.keywords.find((k) => keywordMatcher([k]).test(folded)) ?? rule?.keywords[0] ?? ''
      return { category, source: 'keyword', match: keyword }
    }
  }

  return null
}

/** Suggest a category for a description (see explainExpenseCategory for the why). */
export function suggestExpenseCategory(description: string, memory?: CategoryMemory): string | null {
  return explainExpenseCategory(description, memory)?.category ?? null
}
