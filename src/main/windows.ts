import { BrowserWindow, ipcMain, nativeTheme, screen, type Display } from 'electron'
import { join } from 'node:path'
import { applyWindowMaterial, materialOptions } from './glass'
import { openExternalSafely } from './security'
import { getSettings, updateSettings } from './settings'
import { accountLoaded, accountReady, isSignedIn } from './account'

const isMac = process.platform === 'darwin'

/** window colour before the page paints, so light mode doesn't flash dark */
const paint = (dark: string, light = '#f3f3f6'): string => (nativeTheme.shouldUseDarkColors ? dark : light)

function load(win: BrowserWindow, route: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

// ---------------------------------------------------------------------------
// Sign-in gate: Toom needs an account. Everything that opens the app proper (recording bar,
// library, editor, settings) asks for sign-in first.
// ---------------------------------------------------------------------------

/**
 * True when `retry` can't run yet: the stored session is still loading (it runs once it has), or
 * nobody is signed in (the sign-in window opens instead).
 */
function needsSignIn(retry: () => void): boolean {
  if (!accountLoaded()) {
    void accountReady().then(retry)
    return true
  }
  if (isSignedIn()) return false
  showSignIn()
  return true
}

/** `idle`: windows that do no work in the background (library, settings, welcome) may be throttled when hidden */
function baseWebPreferences(idle = false): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    // renderers get no Node.js; the preload only uses contextBridge + ipcRenderer
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    backgroundThrottling: idle
  }
}

function hardenLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed()

function cursorDisplay(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

// ---------------------------------------------------------------------------
// Launcher: floating bar at the bottom of the screen. The window is larger than
// the bar so popovers can open above it; empty areas are click-through.
// ---------------------------------------------------------------------------

export const LAUNCHER_W = 1100
export const LAUNCHER_H = 600
let launcher: BrowserWindow | null = null

export function getLauncherWindow(): BrowserWindow | null {
  return alive(launcher) ? launcher : null
}

/** Where the launcher window sits by default: bar centred at the bottom of the display. */
function defaultLauncherPos(display: Display): { x: number; y: number } {
  const wa = display.workArea
  return { x: Math.round(wa.x + wa.width / 2 - LAUNCHER_W / 2), y: Math.round(wa.y + wa.height - LAUNCHER_H - 12) }
}

/** Keep the bar (bottom-centre of the window) on screen. */
function clampLauncher(x: number, y: number, display: Display): { x: number; y: number } {
  const wa = display.workArea
  const half = 200 // keep at least this much of the bar visible horizontally
  const cx = Math.min(Math.max(x + LAUNCHER_W / 2, wa.x + half), wa.x + wa.width - half)
  const bottom = Math.min(Math.max(y + LAUNCHER_H - 12, wa.y + 70), wa.y + wa.height)
  return { x: Math.round(cx - LAUNCHER_W / 2), y: Math.round(bottom - LAUNCHER_H + 12) }
}

function placeLauncher(win: BrowserWindow, display = cursorDisplay()): void {
  const d = defaultLauncherPos(display)
  const off = getSettings().general.launcherOffset
  const p = off ? clampLauncher(d.x + off.x, d.y + off.y, display) : d
  win.setBounds({ ...p, width: LAUNCHER_W, height: LAUNCHER_H })
}

// ---- dragging the bar (the window itself isn't movable: it's mostly click-through) ----
let dragFrom: { x: number; y: number } | null = null

export function launcherDragStart(): void {
  if (alive(launcher)) {
    const [x, y] = launcher.getPosition()
    dragFrom = { x, y }
  }
}

export function launcherDragMove(dx: number, dy: number): void {
  if (!alive(launcher) || !dragFrom) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const p = clampLauncher(dragFrom.x + dx, dragFrom.y + dy, display)
  launcher.setPosition(p.x, p.y)
}

export function launcherDragEnd(): void {
  if (!alive(launcher) || !dragFrom) return
  dragFrom = null
  const [x, y] = launcher.getPosition()
  const display = screen.getDisplayMatching(launcher.getBounds())
  const d = defaultLauncherPos(display)
  const off = { x: x - d.x, y: y - d.y }
  updateSettings({ general: { launcherOffset: Math.abs(off.x) < 4 && Math.abs(off.y) < 4 ? null : off } })
}

export function resetLauncherPosition(): void {
  updateSettings({ general: { launcherOffset: null } })
  if (alive(launcher)) placeLauncher(launcher, screen.getDisplayMatching(launcher.getBounds()))
}

export function createLauncherWindow(): BrowserWindow {
  if (alive(launcher)) return launcher
  launcher = new BrowserWindow({
    width: LAUNCHER_W,
    height: LAUNCHER_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Toom',
    webPreferences: baseWebPreferences()
  })
  launcher.setAlwaysOnTop(true, 'floating', 1) // above its own glass backing windows
  launcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  launcher.setContentProtection(true) // never appears in recordings
  launcher.setIgnoreMouseEvents(true, { forward: true })
  launcher.on('closed', () => (launcher = null))
  load(launcher, '/launcher')
  return launcher
}

export function showLauncher(): void {
  if (needsSignIn(showLauncher)) return
  const win = createLauncherWindow()
  placeLauncher(win)
  const reveal = (): void => {
    win.show()
    win.focus()
    win.webContents.send('launcher:shown')
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
  else reveal()
}

export function hideLauncher(): void {
  if (alive(launcher)) {
    launcher.webContents.send('launcher:hidden')
    launcher.hide()
  }
}

export function toggleLauncher(): void {
  if (alive(launcher) && launcher.isVisible()) hideLauncher()
  else showLauncher()
}

// ---------------------------------------------------------------------------
// Library (recent recordings)
// ---------------------------------------------------------------------------

let library: BrowserWindow | null = null

export function getLibraryWindow(): BrowserWindow | null {
  return alive(library) ? library : null
}

export function showLibrary(): BrowserWindow | null {
  if (needsSignIn(() => void showLibrary())) return null
  if (alive(library)) {
    library.show()
    library.focus()
    return library
  }
  library = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Toom — Library',
    backgroundColor: paint('#08080b'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: baseWebPreferences(true)
  })
  hardenLinks(library)
  library.once('ready-to-show', () => library?.show())
  library.on('closed', () => (library = null))
  load(library, '/library')
  return library
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let settingsWin: BrowserWindow | null = null

export function showSettings(section = 'general'): BrowserWindow | null {
  if (needsSignIn(() => void showSettings(section))) return null
  if (alive(settingsWin)) {
    settingsWin.webContents.send('settings:section', section)
    settingsWin.show()
    settingsWin.focus()
    return settingsWin
  }
  settingsWin = new BrowserWindow({
    width: 800,
    height: 680,
    minWidth: 780,
    minHeight: 520,
    show: false,
    title: 'Settings',
    backgroundColor: paint('#0e0e12', '#fbfbfd'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...materialOptions(),
    webPreferences: baseWebPreferences(true)
  })
  applyWindowMaterial(settingsWin, 16)
  hardenLinks(settingsWin)
  settingsWin.once('ready-to-show', () => settingsWin?.show())
  settingsWin.on('closed', () => (settingsWin = null))
  load(settingsWin, `/settings/${section}`)
  return settingsWin
}

// ---------------------------------------------------------------------------
// About Toom (needs no account: it's how anyone checks which version they have)
// ---------------------------------------------------------------------------

let aboutWin: BrowserWindow | null = null

export function showAbout(): BrowserWindow {
  if (alive(aboutWin)) {
    aboutWin.show()
    aboutWin.focus()
    return aboutWin
  }
  aboutWin = new BrowserWindow({
    width: 380,
    height: 540,
    resizable: false,
    show: false,
    title: 'About Toom',
    backgroundColor: paint('#0e0e12', '#fbfbfd'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    ...materialOptions(),
    webPreferences: baseWebPreferences(true)
  })
  applyWindowMaterial(aboutWin, 16)
  hardenLinks(aboutWin)
  aboutWin.once('ready-to-show', () => aboutWin?.show())
  aboutWin.on('closed', () => (aboutWin = null))
  load(aboutWin, '/about')
  return aboutWin
}

// ---------------------------------------------------------------------------
// Welcome (first run)
// ---------------------------------------------------------------------------

let welcomeWin: BrowserWindow | null = null

export function getWelcomeWindow(): BrowserWindow | null {
  return alive(welcomeWin) ? welcomeWin : null
}

export function showOnboarding(route = '/welcome'): BrowserWindow {
  if (alive(welcomeWin)) {
    // already open (onboarding or sign-in): switch to what's asked, unless onboarding is under way
    if (route !== '/welcome' && !welcomeWin.webContents.getURL().endsWith(`#${route}`)) load(welcomeWin, route)
    welcomeWin.show()
    welcomeWin.focus()
    return welcomeWin
  }
  welcomeWin = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 640,
    minHeight: 580,
    show: false,
    title: 'Welcome to Toom',
    backgroundColor: paint('#0e0e12', '#fbfbfd'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...materialOptions(),
    webPreferences: baseWebPreferences(true)
  })
  applyWindowMaterial(welcomeWin, 20)
  hardenLinks(welcomeWin)
  welcomeWin.once('ready-to-show', () => welcomeWin?.show())
  welcomeWin.on('closed', () => (welcomeWin = null))
  load(welcomeWin, route)
  return welcomeWin
}

/** Ask for sign-in: first-run onboarding (which starts with it), or just the sign-in screen. */
export function showSignIn(): BrowserWindow {
  return getSettings().general.onboarded ? showOnboarding('/welcome/signin') : showOnboarding()
}

/** Signed out: close everything that needs an account (an ongoing recording finishes first). */
export function closeAccountWindows(): void {
  hideLauncher()
  for (const w of [library, settingsWin, ...editorWindows.values()]) if (alive(w ?? null)) w!.close()
}

/** Bring forward whichever window can show account changes (welcome, else Settings → Account). */
export function focusAccountUi(): void {
  if (accountLoaded() && !isSignedIn()) return void showSignIn()
  if (alive(welcomeWin)) {
    if (welcomeWin.isMinimized()) welcomeWin.restore()
    welcomeWin.show()
    welcomeWin.focus()
  } else showSettings('account')
}

// ---------------------------------------------------------------------------
// Area selection overlay (one display)
// ---------------------------------------------------------------------------

let areaWin: BrowserWindow | null = null

export function openAreaOverlay(display: Display): BrowserWindow {
  if (alive(areaWin)) areaWin.close()
  const b = display.bounds
  areaWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: baseWebPreferences()
  })
  areaWin.setAlwaysOnTop(true, 'screen-saver')
  areaWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  areaWin.setContentProtection(true)
  areaWin.setBounds(b) // macOS may clamp the initial frame below the menu bar
  areaWin.once('ready-to-show', () => {
    areaWin?.show()
    areaWin?.focus()
  })
  areaWin.on('closed', () => (areaWin = null))
  load(areaWin, `/area/${display.id}`)
  return areaWin
}

export function closeAreaOverlay(): void {
  if (alive(areaWin)) areaWin.close()
}

// ---------------------------------------------------------------------------
// Recording toolbar
// ---------------------------------------------------------------------------

let toolbarWindow: BrowserWindow | null = null

export function getToolbarWindow(): BrowserWindow | null {
  return alive(toolbarWindow) ? toolbarWindow : null
}

export function createToolbarWindow(displayId?: string): BrowserWindow {
  getToolbarWindow()?.close()
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? cursorDisplay()
  if (getSettings().recording.controls === 'island') return createIslandWindow(display)
  const width = 320
  const height = 64
  const { x, y, width: dw } = display.workArea
  toolbarWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(x + dw / 2 - width / 2),
    y: y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    webPreferences: baseWebPreferences()
  })
  toolbarWindow.setAlwaysOnTop(true, 'screen-saver')
  toolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  toolbarWindow.setContentProtection(true)
  toolbarWindow.once('ready-to-show', () => toolbarWindow?.showInactive())
  const tw = toolbarWindow
  tw.on('closed', () => {
    if (toolbarWindow === tw) toolbarWindow = null
  })
  load(toolbarWindow, '/toolbar')
  return toolbarWindow
}

// ---------------------------------------------------------------------------
// Dynamic Island: recording controls wrapped around the MacBook notch (or a floating
// pill at the top of displays without one). The window is larger than the island so it
// can expand on hover; the empty area is click-through.
// ---------------------------------------------------------------------------

export interface IslandInfo {
  notch: boolean
  notchWidth: number
  menuBarHeight: number
}
const islandInfo = new Map<number, IslandInfo>()
const ISLAND_W = 560
const ISLAND_H = 260

function createIslandWindow(display: Display): BrowserWindow {
  const b = display.bounds
  const menuBarHeight = Math.max(0, display.workArea.y - b.y)
  // Notched MacBooks have a taller menu bar (~37pt vs 24pt) on the built-in panel.
  const notch = isMac && display.internal && menuBarHeight >= 30
  const info: IslandInfo = {
    notch,
    notchWidth: notch ? Math.round(Math.min(240, Math.max(160, b.width * 0.122))) : 0,
    menuBarHeight: menuBarHeight || 28
  }
  const bounds = { x: Math.round(b.x + b.width / 2 - ISLAND_W / 2), y: b.y, width: ISLAND_W, height: ISLAND_H }
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: baseWebPreferences()
  })
  toolbarWindow = win
  islandInfo.set(win.webContents.id, info)
  const wcId = win.webContents.id
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(true)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => {
    win.setBounds(bounds) // macOS keeps new windows below the menu bar; put it back on top
    win.showInactive()
  })
  win.on('closed', () => {
    islandInfo.delete(wcId)
    if (toolbarWindow === win) toolbarWindow = null
  })
  load(win, '/island')
  return win
}

export function registerIslandIpc(): void {
  ipcMain.handle(
    'island:info',
    (e) => islandInfo.get(e.sender.id) ?? { notch: false, notchWidth: 0, menuBarHeight: 28 }
  )
  ipcMain.handle('island:setIgnoreMouse', (e, ignore: boolean) => {
    BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(ignore, { forward: true })
  })
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editorWindows = new Map<string, BrowserWindow>()

/** The project id shown in `win`, if it's an editor window. */
export function editorProjectOf(win: BrowserWindow | null): string | null {
  if (!win) return null
  for (const [id, w] of editorWindows) if (w === win) return id
  return null
}

/** Full app windows (as opposed to the floating bar, island and overlays). */
export function hasAppWindows(): boolean {
  return [...editorWindows.values(), library, settingsWin, welcomeWin].some((w) => alive(w ?? null) && w!.isVisible())
}

export function openEditorWindow(projectId: string): BrowserWindow | null {
  if (needsSignIn(() => void openEditorWindow(projectId))) return null
  // the recording bar makes way for the editor (New Recording brings it back)
  hideLauncher()
  const existing = editorWindows.get(projectId)
  if (alive(existing ?? null)) {
    existing!.show()
    existing!.focus()
    return existing!
  }
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Toom — Editor',
    backgroundColor: paint('#08080b'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: baseWebPreferences()
  })
  hardenLinks(win)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => editorWindows.delete(projectId))
  editorWindows.set(projectId, win)
  load(win, `/editor/${projectId}`)
  return win
}

export function closeEditorWindow(projectId: string): void {
  editorWindows.get(projectId)?.close()
}

/** Tell every window that the project list changed. */
export function broadcastProjectsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('projects:changed')
}
