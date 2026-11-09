import './migrate'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { CaptureSource, DisplayInfo, NRect, ProjectMeta } from '@shared/types'
import type { SettingsPatch } from '@shared/settings'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import {
  closeWriter,
  closeWritersOf,
  copyIntoProject,
  defaultProjectsRoot,
  deleteProject,
  getProject,
  listProjects,
  openWriter,
  projectDir,
  projectFile,
  projectsRoot,
  readCursor,
  saveProject,
  writeAt
} from './projects'
import { clickTrackingAvailable } from './cursor-tracker'
import { isRecording, registerRecordingIpc } from './recording'
import { getSettings, onSettingsChanged, resetSettings, updateSettings } from './settings'
import { applyShortcuts, shortcutStatus } from './shortcuts'
import { buildTrayMenu, createTray } from './tray'
import { registerGlassIpc } from './glass'
import { registerSoundIpc } from './sounds'
import { buildAppMenu, registerMenuIpc } from './menu'
import { registerModelIpc } from './models'
import { findDeepLink, handleDeepLink, registerAccountIpc, registerDeepLinks, setAccountFocus } from './account'
import { initUpdater, onUpdateStatus } from './updater'
import { hardenApp, isAppUrl } from './security'
import { registerStorageIpc } from './storage'
import { addLocalImageToLibrary, registerBackgroundIpc } from './backgrounds'
import {
  broadcastProjectsChanged,
  closeAreaOverlay,
  hasAppWindows,
  launcherDragEnd,
  launcherDragMove,
  launcherDragStart,
  resetLauncherPosition,
  registerIslandIpc,
  closeEditorWindow,
  createLauncherWindow,
  hideLauncher,
  openAreaOverlay,
  openEditorWindow,
  showLauncher,
  showLibrary,
  showSettings,
  showOnboarding,
  getWelcomeWindow,
  focusAccountUi
} from './windows'

const isMac = process.platform === 'darwin'

// ---- before ready ----------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// navigation, new windows, webviews and IPC are locked to Toom's own pages
hardenApp()

registerMediaScheme()
// toom:// links: emailed sign-in links, coming back from checkout
registerDeepLinks()

if (!getSettings().advanced.hardwareAcceleration) app.disableHardwareAcceleration()

// Allow system-audio loopback capture on macOS 13+ (ScreenCaptureKit). No-op elsewhere.
if (isMac) {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride')
}

/** Source chosen in our own picker; consumed by the getDisplayMedia handler. */
let pendingCapture: { sourceId: string; audio: boolean } | null = null
const exportTokens = new Map<string, string>()

// Area selection: the launcher awaits a rect from the overlay window.
let areaResolve: ((r: { displayId: string; rect: NRect } | null) => void) | null = null

function settleArea(result: { displayId: string; rect: NRect } | null): void {
  const resolve = areaResolve
  areaResolve = null
  closeAreaOverlay()
  if (!result) showLauncher()
  resolve?.(result)
}

// ---- IPC ---------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('app:platform', () => process.platform)
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:showLauncher', () => showLauncher())
  ipcMain.handle('app:showLibrary', () => void showLibrary())
  ipcMain.handle('app:showSettings', (_e, section?: string) => void showSettings(section))
  ipcMain.handle('app:quit', () => app.quit())
  ipcMain.handle(
    'app:confirm',
    async (e, o: { message: string; detail?: string; ok?: string; destructive?: boolean }) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts: Electron.MessageBoxOptions = {
        type: o.destructive ? 'warning' : 'question',
        buttons: [o.ok ?? 'OK', 'Cancel'],
        defaultId: o.destructive ? 1 : 0,
        cancelId: 1,
        message: o.message,
        detail: o.detail
      }
      // tiny/transparent windows (toolbar) make poor sheet parents
      const parent = win && win.getBounds().height > 200 ? win : null
      const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts)
      return response === 0
    }
  )
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('app:devtools', (e) => e.sender.openDevTools({ mode: 'detach' }))
  ipcMain.handle('app:openPath', (_e, which: 'userData' | 'recordings') => {
    void shell.openPath(which === 'userData' ? app.getPath('userData') : projectsRoot())
  })
  // kept for older callers
  ipcMain.handle('app:newRecording', () => showLauncher())

  // launcher
  ipcMain.handle('launcher:setIgnoreMouse', (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.setIgnoreMouseEvents(ignore, { forward: true })
  })
  ipcMain.handle('launcher:hide', () => hideLauncher())
  ipcMain.on('launcher:dragStart', () => launcherDragStart())
  ipcMain.on('launcher:drag', (_e, dx: number, dy: number) => launcherDragMove(dx, dy))
  ipcMain.on('launcher:dragEnd', () => launcherDragEnd())
  ipcMain.handle('launcher:resetPosition', () => resetLauncherPosition())

  // settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: SettingsPatch) => updateSettings(patch))
  ipcMain.handle('settings:reset', () => resetSettings())
  ipcMain.handle('settings:shortcutStatus', () => shortcutStatus())
  ipcMain.handle('settings:defaultFolders', () => ({
    recordings: defaultProjectsRoot(),
    export: app.getPath('desktop')
  }))
  ipcMain.handle('settings:chooseFolder', async (e, kind: 'recordings' | 'export') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    if (kind === 'recordings') updateSettings({ general: { recordingsFolder: dir } })
    else updateSettings({ export: { folder: dir } })
    if (kind === 'recordings') broadcastProjectsChanged()
    return dir
  })

  // capture sources
  ipcMain.handle(
    'sources:list',
    async (_e, types: ('screen' | 'window')[] = ['screen', 'window']): Promise<CaptureSource[]> => {
      const sources = await desktopCapturer.getSources({
        types,
        thumbnailSize: { width: 480, height: 300 },
        fetchWindowIcons: true
      })
      const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
      return sources
        .filter((s) => !own.has(s.id) && !/^Toom( |$)/.test(s.name))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
          displayId: s.display_id || undefined
        }))
    }
  )

  ipcMain.handle('capture:select', (_e, sel: { sourceId: string; audio: boolean }) => {
    pendingCapture = sel
  })

  ipcMain.handle('displays:list', (): DisplayInfo[] =>
    screen.getAllDisplays().map((d) => ({ id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor }))
  )

  // area selection
  ipcMain.handle('area:pick', () => {
    if (areaResolve) settleArea(null)
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    hideLauncher()
    openAreaOverlay(display)
    return new Promise<{ displayId: string; rect: NRect } | null>((resolve) => (areaResolve = resolve))
  })
  ipcMain.handle('area:result', (_e, result: { displayId: string; rect: NRect } | null) => settleArea(result))

  // permissions
  ipcMain.handle('permissions:status', () => {
    const status = (kind: 'screen' | 'camera' | 'microphone'): string =>
      isMac || process.platform === 'win32' ? systemPreferences.getMediaAccessStatus(kind) : 'granted'
    return {
      screen: isMac ? status('screen') : 'granted',
      camera: status('camera'),
      microphone: status('microphone'),
      accessibility: clickTrackingAvailable(false)
    }
  })
  ipcMain.handle('permissions:request', async (_e, kind: 'camera' | 'microphone' | 'screen' | 'accessibility') => {
    if (!isMac) return true
    if (kind === 'camera' || kind === 'microphone') return systemPreferences.askForMediaAccess(kind)
    if (kind === 'accessibility') return clickTrackingAvailable(true)
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    return false
  })

  // projects
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:get', (_e, id: string) => getProject(id))
  ipcMain.handle('projects:save', async (_e, meta: ProjectMeta) => {
    await saveProject(meta)
    broadcastProjectsChanged()
  })
  ipcMain.handle('projects:delete', async (_e, id: string) => {
    closeEditorWindow(id)
    await deleteProject(id)
    broadcastProjectsChanged()
  })
  ipcMain.handle('projects:confirmDelete', async (e, id: string) => {
    const meta = await getProject(id)
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete “${meta?.name ?? 'this recording'}”?`,
      detail: 'The recording and its edits will be removed from disk. This can’t be undone.'
    }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (response !== 0) return false
    closeEditorWindow(id)
    await deleteProject(id)
    broadcastProjectsChanged()
    showLibrary()
    return true
  })
  ipcMain.handle('projects:open', (_e, id: string) => {
    openEditorWindow(id)
  })
  ipcMain.handle('projects:reveal', async (_e, id?: string) => {
    if (!id) return void shell.openPath(projectsRoot())
    const meta = await getProject(id)
    // reveal the recording itself when there is one, else the project folder
    const target = meta ? projectFile(id, meta.files.screen) : projectDir(id)
    try {
      await fs.access(target)
      shell.showItemInFolder(target)
    } catch {
      void shell.openPath(projectDir(id))
    }
  })
  ipcMain.handle('projects:removeFile', async (_e, id: string, name: string) => {
    if (['project.json', 'cursor.json'].includes(name)) throw new Error('Refusing to delete project metadata')
    await fs.rm(projectFile(id, name), { force: true })
  })
  ipcMain.handle('projects:cursor', (_e, id: string) => readCursor(id))
  ipcMain.handle('projects:importImage', async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    void addLocalImageToLibrary(res.filePaths[0]).catch(() => undefined)
    return copyIntoProject(id, res.filePaths[0])
  })

  // positional file writers (mediabunny StreamTarget for conversion + export)
  const watched = new Set<number>()
  ipcMain.handle('file:open', async (e, target: { projectId: string; name: string } | { token: string }) => {
    const owner = e.sender.id
    if (!watched.has(owner)) {
      watched.add(owner)
      e.sender.once('destroyed', () => {
        watched.delete(owner)
        void closeWritersOf(owner)
      })
    }
    if ('token' in target) {
      const path = exportTokens.get(target.token)
      if (!path) throw new Error('Unknown export target')
      return openWriter(path, owner)
    }
    projectDir(target.projectId) // validates id
    return openWriter(projectFile(target.projectId, target.name), owner)
  })
  ipcMain.handle('file:write', (_e, handle: number, position: number, data: Uint8Array) =>
    writeAt(handle, position, data)
  )
  // only exports may be discarded (a failed or cancelled export leaves no half-written file)
  ipcMain.handle('file:close', async (_e, handle: number, discard?: boolean) => {
    const path = await closeWriter(handle, false)
    if (discard && path && [...exportTokens.values()].includes(path))
      await fs.rm(path, { force: true }).catch(() => undefined)
    return path
  })

  ipcMain.handle('export:choosePath', async (e, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const folder = getSettings().export.folder || app.getPath('desktop')
    const opts: Electron.SaveDialogOptions = {
      defaultPath: join(folder, defaultName),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    const token = randomUUID()
    exportTokens.set(token, res.filePath)
    return { token, path: res.filePath }
  })
  ipcMain.handle('shell:showItem', (_e, path: string) => {
    if ([...exportTokens.values()].includes(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle('onboarding:show', () => void showOnboarding())
  ipcMain.handle('onboarding:finish', () => {
    updateSettings({ general: { onboarded: true } })
    getWelcomeWindow()?.close()
    showLauncher()
  })

  registerAccountIpc()
  registerStorageIpc()
  registerRecordingIpc()
  registerModelIpc()
  registerBackgroundIpc()
  registerGlassIpc()
  registerSoundIpc()
  registerIslandIpc()
  registerMenuIpc()
}

// ---- settings side effects -------------------------------------------------------

function applySystemSettings(): void {
  const s = getSettings()
  // light / dark / follow the system: native frames, menus, dialogs and vibrancy follow too
  nativeTheme.themeSource = s.appearance.theme
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin })
  if (isMac && app.dock) {
    if (s.general.showInDock || hasAppWindows()) void app.dock.show()
    else app.dock.hide()
  }
}

// ---- lifecycle -------------------------------------------------------------------

app.on('second-instance', (_e, argv) => {
  const link = findDeepLink(argv)
  if (link) void handleDeepLink(link)
  else if (getWelcomeWindow()) getWelcomeWindow()!.focus()
  else showLauncher()
})

app.whenReady().then(() => {
  if (isMac) app.setName('Toom')

  // camera, mic and screen only for Toom's own pages; everything else (geolocation, notifications…) is refused
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = details.requestingUrl || wc.getURL()
    cb(isAppUrl(url) && ['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, origin) => isAppUrl(wc?.getURL() ?? origin) && ['media', 'display-capture'].includes(permission)
  )

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const src =
        sources.find((s) => s.id === pendingCapture?.sourceId) ?? sources.find((s) => s.id.startsWith('screen:'))
      if (!src) return cb({})
      cb(pendingCapture?.audio ? { video: src, audio: 'loopback' } : { video: src })
    } catch (err) {
      console.error('[capture] display media handler failed', err)
      cb({})
    }
  })

  handleMediaProtocol()
  registerIpc()
  buildAppMenu()
  createTray()
  applySystemSettings()
  applyShortcuts(getSettings().shortcuts)

  onSettingsChanged((s, prev) => {
    if (JSON.stringify(s.shortcuts) !== JSON.stringify(prev.shortcuts)) applyShortcuts(s.shortcuts)
    if (
      s.general.launchAtLogin !== prev.general.launchAtLogin ||
      s.general.showInDock !== prev.general.showInDock ||
      s.appearance.theme !== prev.appearance.theme
    ) {
      applySystemSettings()
    }
    buildTrayMenu()
  })

  setAccountFocus(focusAccountUi)
  void initUpdater(isRecording)
  onUpdateStatus(() => {
    buildAppMenu()
    buildTrayMenu()
  })

  // warm up the launcher so it appears instantly
  createLauncherWindow()
  if (!getSettings().general.onboarded) showOnboarding()
  else if (getSettings().general.showLauncherOnStart) showLauncher()
  else showLibrary()

  app.on('activate', () => {
    const anyVisible = BrowserWindow.getAllWindows().some((w) => w.isVisible())
    if (!anyVisible && !isRecording()) showLauncher()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// Tray app: closing windows never quits; use Quit from the tray or app menu.
app.on('window-all-closed', () => undefined)
