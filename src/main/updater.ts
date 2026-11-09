// Automatic updates (electron-updater). The feed comes from electron-builder's `publish` setting,
// baked into the installed app as app-update.yml. Updates download in the background and install
// on the next quit, or right away with "Restart to update".

import { app, BrowserWindow, ipcMain } from 'electron'
import type { UpdateStatus } from '@shared/account'
import { getSettings } from './settings'

const CHECK_EVERY_MS = 4 * 3600e3

let status: UpdateStatus = { state: 'idle' }
let updater: typeof import('electron-updater').autoUpdater | null = null
let isBusy: () => boolean = () => false

function set(s: UpdateStatus): void {
  status = s
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('updater:status', s)
  onStatus?.(s)
}

let onStatus: ((s: UpdateStatus) => void) | null = null
/** e.g. rebuild the menu so it can say "Restart to Update" */
export function onUpdateStatus(fn: (s: UpdateStatus) => void): void {
  onStatus = fn
}

export function updateStatus(): UpdateStatus {
  return status
}

function friendly(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  if (/code signature|not signed|signature/i.test(m))
    return 'This copy of Toom isn’t signed, so it can’t update itself. Download the latest version from the website.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network/i.test(m)) return 'Couldn’t reach the update server.'
  if (/404|latest.*\.yml/i.test(m)) return 'No updates are published yet.'
  return 'Couldn’t check for updates.'
}

export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  if (!updater) return status
  if (status.state === 'downloading' || status.state === 'ready' || status.state === 'checking') return status
  if (!manual && !getSettings().general.autoUpdate) return status
  set({ state: 'checking' })
  try {
    await updater.checkForUpdates()
  } catch (err) {
    console.warn('[updater]', err)
    set({ state: 'error', message: friendly(err) })
  }
  return status
}

export function installUpdate(): boolean {
  if (!updater || status.state !== 'ready' || isBusy()) return false
  // let windows close normally first, then swap the app
  setImmediate(() => updater?.quitAndInstall(false, true))
  return true
}

export async function initUpdater(busy: () => boolean): Promise<void> {
  isBusy = busy
  ipcMain.handle('updater:status', () => status)
  ipcMain.handle('updater:check', () => checkForUpdates(true))
  ipcMain.handle('updater:install', () => installUpdate())

  if (!app.isPackaged) {
    set({ state: 'unsupported', reason: 'Updates are turned off in development builds.' })
    return
  }
  if (process.platform === 'linux' && !process.env['APPIMAGE']) {
    set({ state: 'unsupported', reason: 'Update Toom with your package manager.' })
    return
  }
  try {
    updater = (await import('electron-updater')).autoUpdater
  } catch (err) {
    console.warn('[updater] unavailable', err)
    set({ state: 'unsupported', reason: 'Updates aren’t available in this build.' })
    return
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = /-(beta|alpha|rc)/.test(app.getVersion())
  updater.logger = { info: () => undefined, warn: console.warn, error: console.error, debug: () => undefined }

  updater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }))
  updater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
  updater.on('download-progress', (p) => {
    const version = status.state === 'downloading' || status.state === 'available' ? status.version : ''
    set({ state: 'downloading', version, percent: Math.round(p.percent) })
  })
  updater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  updater.on('error', (err) => {
    // a failed background check shouldn't nag; keep the message for Settings
    console.warn('[updater]', err)
    set({ state: 'error', message: friendly(err) })
  })

  setTimeout(() => void checkForUpdates(), 15e3)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
