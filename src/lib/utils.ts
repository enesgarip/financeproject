import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Opens a native input picker (e.g. date) without crashing when there is no
 * active user gesture. `showPicker()` requires transient activation and throws
 * NotAllowedError when focus arrives programmatically (modal autofocus, tab
 * return), so we swallow that case — clicking the field still opens the picker.
 */
export function openNativePicker(element: HTMLInputElement | null | undefined) {
  try {
    element?.showPicker?.()
  } catch {
    // No user gesture (NotAllowedError) or unsupported state — ignore.
  }
}
