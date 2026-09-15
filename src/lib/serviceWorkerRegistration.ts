import { discardUnsavedInput, hasUnsavedInput } from './navigationSafety'

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const hadController = Boolean(navigator.serviceWorker.controller)
  const register = () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
  let handled = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || handled) return
    handled = true
    if (!hasUnsavedInput()) { window.location.reload(); return }
    const notice = document.createElement('button')
    notice.type = 'button'
    notice.textContent = 'Yeni sürüm hazır. Kaydettikten sonra yenile.'
    notice.className = 'fixed bottom-24 left-4 right-4 z-[100] rounded-xl bg-primary p-4 text-primary-foreground shadow-lg'
    notice.addEventListener('click', () => {
      if (!hasUnsavedInput() || window.confirm('Kaydedilmemiş değişiklikler silinecek. Sayfa yenilensin mi?')) {
        discardUnsavedInput()
        window.location.reload()
      }
    })
    document.body.append(notice)
  })
}
