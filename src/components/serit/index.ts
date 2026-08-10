/**
 * Şerit — kartsız görsel dilin ortak parçaları.
 * Kaynak tasarım: design_handoff_denge_redesign/README.md (sistem kuralları bölümü).
 *
 * Buraya **Card bileşeni eklenmez**: bu dilin ana fikri kartları bırakmak. Ayrım
 * çizgi ve zemin tonuyla yapılır; yükseltilmiş blok ekran başına en fazla 1-2 tane
 * ve yalnız aksiyon/grafik için (`LineGroup variant="raised"` ya da düz `bg-raised`).
 */
export { ScreenHeader, SectionEyebrow } from './ScreenHeader'
export { HeroNumber } from './HeroNumber'
export { LineGroup, LineRow, DayBadge } from './LineRow'
export { BreakdownBar, type BreakdownSegment } from './BreakdownBar'
export { SERIT_FILL, SERIT_TEXT, type SeritTone } from './tone'
export { useSeritAmount } from './useSeritAmount'
