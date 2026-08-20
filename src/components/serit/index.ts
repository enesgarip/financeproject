/**
 * Şerit — ortak görsel dilin parçaları.
 * Kaynak tasarım: design_handoff_denge_redesign/README.md (sistem kuralları bölümü).
 *
 * Şerit v2'de **kart yasağı kalktı**: dilin ana fikri "kart yok" değil, "kartı
 * hak eden yerde kart" — bağımsız nesne, aksiyon/araç bloğu, grafik bloğu.
 * Homojen satır verisi hâlâ `LineGroup`a gider. Kart bileşeni bu ailede değil,
 * `components/ui/card.tsx`te yaşamaya devam eder (tek kart bileşeni olsun diye);
 * tekil ayıraç için `Divider` kullanılır. Kural: `docs/UI_ARCHITECTURE.md`.
 */
export { ScreenHeader, SectionEyebrow } from './ScreenHeader'
export { HeroNumber } from './HeroNumber'
export { LineGroup, LineRow, DayBadge } from './LineRow'
export { Divider } from './Divider'
export { BreakdownBar, type BreakdownSegment } from './BreakdownBar'
export { TrendBars } from './TrendBars'
export { Delta } from './Delta'
export { SERIT_FILL, SERIT_TEXT, type SeritTone } from './tone'
export { useSeritAmount } from './useSeritAmount'
