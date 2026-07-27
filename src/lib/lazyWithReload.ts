import { lazy, type ComponentType } from 'react'

const CHUNK_RELOAD_KEY = 'chunk-reload-attempted'

// React.lazy itself models arbitrary component props with `any`; retaining the
// exact component type here preserves each lazy component's real prop contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy<T>(async () => {
    try {
      const module = await factory()
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      return module
    } catch (error) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
        window.location.reload()
        return new Promise<{ default: T }>(() => {})
      }
      throw error
    }
  })
}
