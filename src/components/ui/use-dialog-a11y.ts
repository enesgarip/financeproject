import { useEffect, useRef } from 'react'

/**
 * Diyalog/popover katmanının TEK focus sözleşmesi: açılışta odağı içeri taşı,
 * Tab'ı içeride hapset, Escape ile kapat, kapanınca odağı tetikleyiciye geri ver.
 *
 * Neden ortak: aynı davranış SimpleModal, ConfirmDialog, QuickActions ve iki
 * import modalında dört ayrı (ve birbirinden farklı) şekilde yazılıydı —
 * ConfirmDialog odağı geri vermiyor, import modalları hiç trap kurmuyordu
 * (denetim 2026-08-12 §6).
 *
 * İKİ İNCE NOKTA (tekrar bozulmasın):
 * 1) `onClose` ref'te tutulur; effect yalnız `open` değişince kurulur. Çağıranlar
 *    inline `onClose={() => ...}` verir (her render'da yeni referans); effect ona
 *    bağlı olsaydı her tuş vuruşunda yeniden kurulup odağı input'tan alır ve
 *    MOBİLDE KLAVYE KAPANIRDI.
 * 2) Focusable listesi HER Tab'da yeniden sorgulanır. Açılışta bir kez alınırsa,
 *    `loading` sırasında butonlar disabled olduğunda döngü ölü referanslara
 *    kurulur ve Tab kapsayıcının dışına kaçar.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogA11y<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const containerRef = useRef<T>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusablesIn = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

    // Kapsayıcı `tabindex="-1"` taşıyorsa odak ona gider (ekran okuyucu başlığı ve
    // açıklamayı baştan okur); taşımıyorsa ilk etkileşimli öğeye.
    if (container.hasAttribute('tabindex')) container.focus()
    else focusablesIn()[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = focusablesIn()
      if (focusable.length === 0) {
        event.preventDefault()
        container!.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open])

  return containerRef
}
