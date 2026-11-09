import { useCallback, useEffect, useState } from 'react'
import type { StylePreset } from '@shared/types'
import { uid } from '@renderer/engine/math'

const KEY = 'screenrec.presets.v1'

interface Store {
  presets: StylePreset[]
  defaultId: string | null
}

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null
    if (s && Array.isArray(s.presets)) return s
  } catch {
    /* ignore */
  }
  return { presets: [], defaultId: null }
}

function write(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    window.dispatchEvent(new Event('screenrec:presets'))
  } catch {
    /* ignore */
  }
}

export function getDefaultPreset(): StylePreset | null {
  const s = read()
  return s.presets.find((p) => p.id === s.defaultId) ?? null
}

export function usePresets() {
  const [store, setStore] = useState<Store>(read)
  useEffect(() => {
    const on = (): void => setStore(read())
    window.addEventListener('screenrec:presets', on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener('screenrec:presets', on)
      window.removeEventListener('storage', on)
    }
  }, [])

  const save = useCallback((name: string, style: StylePreset['style']) => {
    const s = read()
    const p: StylePreset = { id: uid('p'), name: name.trim() || 'Untitled preset', style }
    write({ ...s, presets: [...s.presets, p] })
    return p
  }, [])
  const update = useCallback((id: string, style: StylePreset['style']) => {
    const s = read()
    write({ ...s, presets: s.presets.map((p) => (p.id === id ? { ...p, style } : p)) })
  }, [])
  const remove = useCallback((id: string) => {
    const s = read()
    write({ presets: s.presets.filter((p) => p.id !== id), defaultId: s.defaultId === id ? null : s.defaultId })
  }, [])
  const setDefault = useCallback((id: string | null) => {
    write({ ...read(), defaultId: id })
  }, [])

  return { presets: store.presets, defaultId: store.defaultId, save, update, remove, setDefault }
}
