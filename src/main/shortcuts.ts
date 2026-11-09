import { globalShortcut } from 'electron'
import type { AppSettings } from '@shared/settings'
import { isRecording, requestStop } from './recording'
import { toggleLauncher } from './windows'

export interface ShortcutStatus {
  toggleRecording: boolean
  showLauncher: boolean
}

let status: ShortcutStatus = { toggleRecording: true, showLauncher: true }

/** (Re)register global shortcuts. Returns which ones could be registered. */
export function applyShortcuts(s: AppSettings['shortcuts']): ShortcutStatus {
  globalShortcut.unregisterAll()
  const reg = (accel: string, fn: () => void): boolean => {
    if (!accel) return true
    try {
      return globalShortcut.register(accel, fn)
    } catch {
      return false
    }
  }
  status = {
    toggleRecording: reg(s.toggleRecording, () => {
      if (isRecording()) requestStop()
      else toggleLauncher()
    }),
    showLauncher: s.showLauncher === s.toggleRecording ? true : reg(s.showLauncher, () => toggleLauncher())
  }
  return status
}

export function shortcutStatus(): ShortcutStatus {
  return status
}
