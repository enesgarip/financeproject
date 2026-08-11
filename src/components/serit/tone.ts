/**
 * Şerit dilinde renk **yalnızca sinyaldir**: bir satır kırmızıysa gerçekten acildir,
 * nötr satırlar `ink` rengindedir. Bu dosya izin verilen sinyal kümesini kapatır ki
 * ekranlar tek tek kendi kırmızısını icat etmesin.
 *
 * Dolgu (`SERIT_FILL`) ve metin (`SERIT_TEXT`) ayrı: uyarı sarısı çubukta parlak
 * durur ama aynı sarı metinde AA'yı geçmez, o yüzden metin için koyu karşılığı var.
 */
export type SeritTone = 'danger' | 'warning' | 'info' | 'brand' | 'accent' | 'neutral' | 'idle' | 'ink'

export const SERIT_FILL: Record<SeritTone, string> = {
  danger: 'var(--signal-danger)',
  warning: 'var(--signal-warning)',
  info: 'var(--signal-info)',
  brand: 'var(--primary)',
  accent: 'var(--accent-soft)',
  neutral: 'var(--neutral-bar)',
  idle: 'var(--chart-idle)',
  ink: 'var(--ink)',
}

export const SERIT_TEXT: Record<SeritTone, string> = {
  ...SERIT_FILL,
  warning: 'var(--signal-warning-ink)',
}
