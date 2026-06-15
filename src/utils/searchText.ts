export function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .replace(/[Iİ]/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
