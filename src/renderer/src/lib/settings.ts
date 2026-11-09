import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import { api } from './api'

/** Live app settings (owned by the main process, broadcast to every window). */
export function useSettings(): { settings: AppSettings | null; set: (patch: SettingsPatch) => void } {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    let alive = true
    void api.settings.get().then((s) => alive && setSettings(s))
    const off = api.settings.onChanged(setSettings)
    return () => {
      alive = false
      off()
    }
  }, [])
  const set = useCallback((patch: SettingsPatch) => {
    // optimistic local update; main broadcasts the merged result
    setSettings((cur) => {
      if (!cur) return cur
      const next = { ...cur } as AppSettings
      for (const k of Object.keys(patch) as (keyof AppSettings)[]) {
        ;(next as unknown as Record<string, unknown>)[k] = { ...cur[k], ...patch[k] }
      }
      return next
    })
    void api.settings.set(patch)
  }, [])
  return { settings, set }
}
