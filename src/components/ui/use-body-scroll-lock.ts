import { useEffect } from 'react'

type RestoreState = {
  scrollY: number
  bodyOverflow: string
  bodyPosition: string
  bodyTop: string
  bodyLeft: string
  bodyRight: string
  bodyWidth: string
  bodyPaddingRight: string
  htmlOverscrollBehavior: string
}

let lockCount = 0
let restoreState: RestoreState | null = null

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof window === 'undefined') return

    lockCount += 1

    if (lockCount === 1) {
      const { body, documentElement } = document
      const scrollY = window.scrollY
      const scrollbarGap = window.innerWidth - documentElement.clientWidth

      restoreState = {
        scrollY,
        bodyOverflow: body.style.overflow,
        bodyPosition: body.style.position,
        bodyTop: body.style.top,
        bodyLeft: body.style.left,
        bodyRight: body.style.right,
        bodyWidth: body.style.width,
        bodyPaddingRight: body.style.paddingRight,
        htmlOverscrollBehavior: documentElement.style.overscrollBehavior,
      }

      body.style.overflow = 'hidden'
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.left = '0'
      body.style.right = '0'
      body.style.width = '100%'
      if (scrollbarGap > 0) body.style.paddingRight = `${scrollbarGap}px`
      documentElement.style.overscrollBehavior = 'none'
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount > 0 || !restoreState) return

      const { body, documentElement } = document
      body.style.overflow = restoreState.bodyOverflow
      body.style.position = restoreState.bodyPosition
      body.style.top = restoreState.bodyTop
      body.style.left = restoreState.bodyLeft
      body.style.right = restoreState.bodyRight
      body.style.width = restoreState.bodyWidth
      body.style.paddingRight = restoreState.bodyPaddingRight
      documentElement.style.overscrollBehavior = restoreState.htmlOverscrollBehavior

      window.scrollTo(0, restoreState.scrollY)
      restoreState = null
    }
  }, [locked])
}
