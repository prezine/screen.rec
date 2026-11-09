import { useCallback, useRef, useState } from 'react'

interface H<T> {
  past: T[]
  present: T | null
  future: T[]
}

const LIMIT = 150
const COALESCE_MS = 900

/**
 * Undo/redo for an immutable value. Calls that share a `key` within a short window
 * (slider drags, timeline drags) collapse into a single undo step.
 */
export function useHistory<T>() {
  const [h, setH] = useState<H<T>>({ past: [], present: null, future: [] })
  const last = useRef<{ key?: string; at: number }>({ at: 0 })

  const reset = useCallback((value: T) => {
    last.current = { at: 0 }
    setH({ past: [], present: value, future: [] })
  }, [])

  const set = useCallback((fn: (v: T) => T, key?: string) => {
    setH((cur) => {
      if (cur.present === null) return cur
      const next = fn(cur.present)
      if (next === cur.present) return cur
      const now = Date.now()
      const coalesce = key !== undefined && key === last.current.key && now - last.current.at < COALESCE_MS
      last.current = { key, at: now }
      if (coalesce) return { ...cur, present: next, future: [] }
      return { past: [...cur.past, cur.present].slice(-LIMIT), present: next, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    last.current = { at: 0 }
    setH((cur) => {
      if (!cur.past.length || cur.present === null) return cur
      return {
        past: cur.past.slice(0, -1),
        present: cur.past[cur.past.length - 1],
        future: [cur.present, ...cur.future]
      }
    })
  }, [])

  const redo = useCallback(() => {
    last.current = { at: 0 }
    setH((cur) => {
      if (!cur.future.length || cur.present === null) return cur
      return { past: [...cur.past, cur.present], present: cur.future[0], future: cur.future.slice(1) }
    })
  }, [])

  return { value: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
