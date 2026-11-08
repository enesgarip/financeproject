// Formu göndermek başarı demek değildir; yalnız DOM'dan çıkan alanlar temizlenir.
const edited = new Map<HTMLElement, string>()
const initial = new WeakMap<HTMLElement, string>()
function fieldValue(field: HTMLElement) {
  if (field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type)) return String(field.checked)
  return 'value' in field ? String(field.value) : field.textContent ?? ''
}
let editingHistoryIndex: number | undefined
export function discardUnsavedInput() { edited.clear() }
export function hasUnsavedInput(scope?: Element) {
  for (const [field, value] of edited) if (!field.isConnected || fieldValue(field) === value) edited.delete(field)
  return [...edited.keys()].some(field => !scope || scope.contains(field))
}
const busy = (scope: ParentNode = document) => !!scope.querySelector('[data-navigation-busy="true"]') || (scope instanceof Element && scope.getAttribute('data-navigation-busy') === 'true')
const confirmDiscard = (scope?: Element) => !busy(scope) && (!hasUnsavedInput(scope) || window.confirm('Kaydedilmemiş değişikliklerin var. Değişiklikleri bırakıp devam edilsin mi?'))

export function installNavigationSafety() {
  document.addEventListener('focusin', event => {
    const field = event.target
    if (field instanceof HTMLElement && !initial.has(field)) initial.set(field, fieldValue(field))
  }, true)
  document.addEventListener('input', event => {
    const field = event.target
    if (!(field instanceof HTMLElement) || field.closest('[data-navigation-transient]') || !field.closest('form, [role="dialog"], [role="alertdialog"], [data-navigation-scope]')) return
    if (!hasUnsavedInput()) editingHistoryIndex = window.history.state?.idx
    edited.set(field, initial.get(field) ?? '')
  }, true)
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const close = event.target.closest('button[aria-label="Kapat"], [data-navigation-discard]')
    const link = event.target.closest<HTMLAnchorElement>('a[href]')
    if (!close && !link) return
    if (close?.hasAttribute('disabled')) return
    const scope = close?.closest('[role="dialog"], [role="alertdialog"], [data-navigation-scope]') ?? undefined
    if (link && (link.target === '_blank' || link.hasAttribute('download') || (link.origin === location.origin && link.pathname === location.pathname && link.search === location.search))) return
    if (!confirmDiscard(scope)) { event.preventDefault(); event.stopImmediatePropagation() }
    // Kapatma başarılıysa alanlar DOM'dan çıkınca kendiliğinden temizlenir.
    // Busy/onClose reddinde ve alttaki farklı formda kirli izleme korunur.
    else if (link) edited.clear()
  }, true)
  window.addEventListener('keydown', event => {
    const scope = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="alertdialog"]') : null
    if (event.key === 'Escape' && scope && !confirmDiscard(scope)) {
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
    if (busy() || hasUnsavedInput()) { event.preventDefault(); event.returnValue = '' }
  })
}
