// Formu göndermek başarı demek değildir; yalnız DOM'dan çıkan alanlar temizlenir.
const edited = new Map<HTMLElement, string>()
const initial = new WeakMap<HTMLElement, string>()
function fieldValue(field: HTMLElement) {
  if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) return String(field.checked)
  return 'value' in field ? String(field.value) : field.textContent ?? ''
}
let editingHistoryIndex: number | undefined
export function discardUnsavedInput() { edited.clear() }
export function hasUnsavedInput() {
  for (const [field, value] of edited) if (!field.isConnected || fieldValue(field) === value) edited.delete(field)
  return edited.size > 0
}
const confirmDiscard = () => !hasUnsavedInput() || window.confirm('Kaydedilmemiş değişikliklerin var. Değişiklikleri bırakıp devam edilsin mi?')

export function installNavigationSafety() {
  document.addEventListener('focusin', event => {
    const field = event.target
    if (field instanceof HTMLElement && !initial.has(field)) initial.set(field, fieldValue(field))
  }, true)
  document.addEventListener('input', event => {
    const field = event.target
    if (!(field instanceof HTMLElement) || !field.closest('form, [role="dialog"]')) return
    if (!hasUnsavedInput()) editingHistoryIndex = window.history.state?.idx
    edited.set(field, initial.get(field) ?? '')
  }, true)
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement
    if (!target.closest('a[href], button[aria-label="Kapat"]')) return
    if (!confirmDiscard()) { event.preventDefault(); event.stopImmediatePropagation() }
    else edited.clear()
  }, true)
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('[role="dialog"]') && !confirmDiscard()) {
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }, true)
  let restoring = false
  window.addEventListener('popstate', event => {
    if (restoring) { restoring = false; return }
    if (confirmDiscard()) { edited.clear(); return }
    event.stopImmediatePropagation()
    restoring = true
    const delta = typeof editingHistoryIndex === 'number' && typeof event.state?.idx === 'number'
      ? editingHistoryIndex - event.state.idx : 1
    window.history.go(delta || 1)
  }, true)
  window.addEventListener('beforeunload', event => {
    if (hasUnsavedInput()) { event.preventDefault(); event.returnValue = '' }
  })
}
