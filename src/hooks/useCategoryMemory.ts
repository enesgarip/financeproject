import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildCategoryMemory, type CategoryMemory } from '../utils/categories'

/**
 * Learned (description → category) memory built from the user's past card
 * expenses, so the expense form can auto-fill the category for merchants it has
 * seen before. Cached for the session; `invalidateCategoryMemory()` clears it
 * after a new expense so the next load reflects it.
 */

let cache: CategoryMemory | null = null
let inflight: Promise<CategoryMemory> | null = null

async function loadMemory(): Promise<CategoryMemory> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('description, category, spent_at')
    .order('spent_at', { ascending: false })
    .limit(400)

  if (error) return new Map()
  return buildCategoryMemory((data ?? []) as Array<{ description: string | null; category: string | null }>)
}

export function invalidateCategoryMemory() {
  cache = null
  inflight = null
}

export function useCategoryMemory(): CategoryMemory {
  const [memory, setMemory] = useState<CategoryMemory>(() => cache ?? new Map())

  useEffect(() => {
    let alive = true
    if (cache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMemory(cache)
      return
    }
    inflight ??= loadMemory().then((loaded) => {
      cache = loaded
      return loaded
    })
    void inflight.then((loaded) => {
      if (alive) setMemory(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  return memory
}
