import type { ExportSettings } from './types'

export type Countdown = 0 | 3 | 5 | 10
export type RecordingQuality = 'standard' | 'high' | 'max'

export type RecordingControls = 'island' | 'toolbar'
/** clear: see-through glass · tinted: darker, calmer glass · solid: no transparency (accessibility) */
export type GlassStyle = 'clear' | 'tinted' | 'solid'
/** system follows macOS / Windows light and dark mode */
export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppSettings {
  general: {
    showLauncherOnStart: boolean
    launchAtLogin: boolean
    showInDock: boolean // macOS only
    /** empty = default (~/Movies/Toom or ~/Videos/Toom) */
    recordingsFolder: string
    /** where the user dragged the recording bar, relative to its default spot (null = default) */
    launcherOffset: { x: number; y: number } | null
    /** finished the welcome steps (account, plan, permissions) */
    onboarded: boolean
    /** download and install updates automatically */
    autoUpdate: boolean
  }
  /** Liquid Glass look, shared by every window */
  appearance: {
    theme: ThemeMode
    glass: GlassStyle
    /** 0..1 — how much shows through */
    transparency: number
    /** 0..1 — frost */
    blur: number
    /** 0..1 — how strongly the edges bend what's behind them */
    refraction: number
    /** 0..1 — specular rim and sheen */
    highlights: number
  }
  recording: {
    countdown: Countdown
    fps: 30 | 60
    quality: RecordingQuality
    openEditorAfterRecording: boolean
    noiseSuppression: boolean
    echoCancellation: boolean
    /** where the stop/pause controls live while recording */
    controls: RecordingControls
  }
  /** Launcher selections, remembered between sessions. null = off. */
  devices: {
    cameraId: string | null
    microphoneId: string | null
    systemAudio: boolean
  }
  editing: {
    autoZoom: boolean
    zoomLevel: number
    cursorSmoothing: number
    clickEffect: 'none' | 'ripple' | 'circle' | 'glass'
    /** speed up stretches of typing in new recordings */
    speedUpTyping: boolean
    /** scan new recordings for emails, numbers, keys and faces, and mask them */
    autoPrivacy: boolean
  }
  export: ExportSettings & {
    /** empty = Desktop */
    folder: string
    revealAfterExport: boolean
  }
  shortcuts: {
    toggleRecording: string
    showLauncher: string
  }
  integrations: {
    /** Unsplash API access key (Client-ID), from unsplash.com/developers */
    unsplashKey: string
  }
  transcription: {
    model: 'fast' | 'accurate'
    /** '' = detect automatically */
    language: string
  }
  advanced: {
    clickTracking: boolean
    /** shortcuts and typing activity (never what you type) */
    keyTracking: boolean
    hardwareAcceleration: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    showLauncherOnStart: true,
    launchAtLogin: false,
    showInDock: true,
    recordingsFolder: '',
    launcherOffset: null,
    onboarded: false,
    autoUpdate: true
  },
  appearance: { theme: 'system', glass: 'clear', transparency: 0.55, blur: 0.45, refraction: 0.6, highlights: 0.7 },
  recording: {
    countdown: 3,
    fps: 60,
    quality: 'high',
    openEditorAfterRecording: true,
    noiseSuppression: true,
    echoCancellation: true,
    controls: 'island'
  },
  devices: { cameraId: null, microphoneId: 'default', systemAudio: false },
  editing: {
    autoZoom: true,
    zoomLevel: 1.9,
    cursorSmoothing: 0.6,
    clickEffect: 'ripple',
    speedUpTyping: false,
    autoPrivacy: true
  },
  export: { resolution: 1080, fps: 60, quality: 'high', folder: '', revealAfterExport: false },
  shortcuts: { toggleRecording: 'CommandOrControl+Shift+2', showLauncher: 'CommandOrControl+Shift+1' },
  integrations: { unsplashKey: '' },
  transcription: { model: 'accurate', language: '' },
  advanced: { clickTracking: true, keyTracking: true, hardwareAcceleration: true }
}

export const RECORDING_BITRATE: Record<RecordingQuality, number> = {
  standard: 8_000_000,
  high: 16_000_000,
  max: 30_000_000
}

export type SettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> }

/** Merge a (possibly old / partial) settings object over the defaults, section by section. */
export function mergeSettings(base: AppSettings, patch: SettingsPatch | undefined | null): AppSettings {
  const out = { ...base } as AppSettings
  if (!patch) return out
  for (const key of Object.keys(base) as (keyof AppSettings)[]) {
    const p = patch[key]
    if (p && typeof p === 'object') (out as unknown as Record<string, unknown>)[key] = { ...base[key], ...p }
  }
  return out
}
