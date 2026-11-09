import { app, BrowserWindow } from 'electron'
import { readFileSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings, type SettingsPatch } from '@shared/settings'

const file = (): string => join(app.getPath('userData'), 'settings.json')

let current: AppSettings | null = null
const listeners = new Set<(s: AppSettings, prev: AppSettings) => void>()

/** Synchronous so it can be used before app 'ready' (e.g. hardware acceleration). */
export function getSettings(): AppSettings {
  if (!current) {
    try {
      current = mergeSettings(DEFAULT_SETTINGS, JSON.parse(readFileSync(file(), 'utf8')) as SettingsPatch)
    } catch {
      current = mergeSettings(DEFAULT_SETTINGS, null)
    }
  }
  return current
}

let writeChain: Promise<void> = Promise.resolve()

export function updateSettings(patch: SettingsPatch): AppSettings {
  const prev = getSettings()
  const next = mergeSettings(prev, patch)
  current = next
  const json = JSON.stringify(next, null, 2)
  writeChain = writeChain
    .then(async () => {
      const tmp = file() + '.tmp'
      await fs.writeFile(tmp, json)
      await fs.rename(tmp, file())
    })
    .catch((err) => console.error('[settings] write failed', err))
  for (const l of listeners) l(next, prev)
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings:changed', next)
  return next
}

export function resetSettings(): AppSettings {
  // resetting preferences shouldn't bring the welcome steps back
  return updateSettings({
    ...DEFAULT_SETTINGS,
    general: { ...DEFAULT_SETTINGS.general, onboarded: getSettings().general.onboarded }
  })
}

export function onSettingsChanged(fn: (s: AppSettings, prev: AppSettings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
