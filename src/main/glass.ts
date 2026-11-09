// Liquid Glass.
// macOS 26+: Apple's own glass (NSGlassEffectView) through the optional `electron-liquid-glass` addon.
// Older macOS: the system vibrancy material. Windows 11: Acrylic. Elsewhere: CSS glass only.
//
// Two ways to use it:
//  1. Whole-window material (settings): `applyWindowMaterial(win)` before load.
//  2. Glass under part of a transparent window (the floating launcher bar and its popovers):
//     the renderer reports element rects and we keep a tiny click-through glass window behind
//     each one. Native glass can only cover a whole window, so this is how a floating pill gets it.
import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { getSettings, onSettingsChanged } from './settings'

interface LiquidGlass {
  addView(handle: Buffer, opts: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number
  isGlassSupported(): boolean
}

let lg: LiquidGlass | null | undefined
function liquidGlass(): LiquidGlass | null {
  if (lg !== undefined) return lg
  lg = null
  if (process.platform !== 'darwin') return lg
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-liquid-glass') as { default?: LiquidGlass } & LiquidGlass
    const inst = mod.default ?? mod
    if (inst.isGlassSupported()) lg = inst
  } catch (err) {
    console.warn('[glass] electron-liquid-glass not available, using CSS glass:', (err as Error).message)
  }
  return lg
}

/** Native glass tint from Settings → Appearance (hex #rrggbbaa). */
function tint(strength = 1): string {
  const a = getSettings().appearance
  const t = a.transparency
  const base = a.glass === 'tinted' ? 0.86 - 0.42 * t : 0.6 - 0.5 * t
  const alpha = Math.round(Math.min(1, Math.max(0, base * strength)) * 255)
  // follows light / dark mode (Settings → Appearance → Theme)
  return `${nativeTheme.shouldUseDarkColors ? '#0c0c12' : '#f4f4f8'}${alpha.toString(16).padStart(2, '0')}`
}

export type Material = 'liquid' | 'vibrancy' | 'acrylic' | 'none'
const materials = new WeakMap<BrowserWindow, Material>()

/** Window options for a translucent window. Spread into the BrowserWindow constructor. */
export function materialOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (liquidGlass()) return { transparent: true, backgroundColor: '#00000000' }
  if (process.platform === 'darwin')
    return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
  if (process.platform === 'win32') return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  return {}
}

/** Call right after creating a window built with `materialOptions()`. */
export function applyWindowMaterial(win: BrowserWindow, cornerRadius = 16): Material {
  const g = liquidGlass()
  let m: Material = 'none'
  if (g) {
    m = 'liquid'
    const run = (): void => {
      try {
        g.addView(win.getNativeWindowHandle(), { cornerRadius, tintColor: tint(1.1) })
      } catch (err) {
        console.warn('[glass] addView failed', err)
      }
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', run)
    else run()
  } else if (process.platform === 'darwin') m = 'vibrancy'
  else if (process.platform === 'win32') m = 'acrylic'
  materials.set(win, m)
  return m
}

// ---- glass behind parts of a transparent window ------------------------------------

export interface GlassRegion {
  id: string
  x: number
  y: number
  w: number
  h: number
  r: number
}

const pools = new Map<number, Map<string, BrowserWindow>>()

function backingWindow(owner: BrowserWindow, r: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 10,
    height: 10,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    enableLargerThanScreen: true,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  void win.loadURL('data:text/html,<html style="background:transparent"></html>')
  win.webContents.once('did-finish-load', () => {
    try {
      liquidGlass()?.addView(win.getNativeWindowHandle(), { cornerRadius: r, tintColor: tint(0.6) })
    } catch (err) {
      console.warn('[glass] region addView failed', err)
    }
  })
  owner.once('closed', () => !win.isDestroyed() && win.destroy())
  return win
}

export function setGlassRegions(owner: BrowserWindow, regions: GlassRegion[]): void {
  if (!liquidGlass() || owner.isDestroyed()) return
  if (getSettings().appearance.glass === 'solid') regions = []
  let pool = pools.get(owner.id)
  if (!pool) {
    pool = new Map()
    pools.set(owner.id, pool)
    const p = pool
    const hideAll = (): void => p.forEach((w) => !w.isDestroyed() && w.hide())
    owner.on('hide', hideAll)
    owner.once('closed', () => pools.delete(owner.id))
  }
  const visible = owner.isVisible()
  const cb = owner.getContentBounds()
  const keep = new Set<string>()
  for (const r of regions) {
    // the id carries the radius, so a pill and a popover never share a backing window
    const key = `${r.id}:${Math.round(r.r)}`
    keep.add(key)
    let w = pool.get(key)
    if (!w || w.isDestroyed()) {
      w = backingWindow(owner, r.r)
      pool.set(key, w)
    }
    w.setBounds({
      x: Math.round(cb.x + r.x),
      y: Math.round(cb.y + r.y),
      width: Math.max(1, Math.round(r.w)),
      height: Math.max(1, Math.round(r.h))
    })
    if (visible && !w.isVisible()) w.showInactive()
  }
  for (const [key, w] of pool) if (!keep.has(key) && !w.isDestroyed() && w.isVisible()) w.hide()
  // keep the real UI above its glass
  if (visible) owner.moveTop()
}

export function registerGlassIpc(): void {
  // a new tint means new glass views: drop the backing windows and let each window re-report
  const refresh = (): void => {
    for (const pool of pools.values()) for (const w of pool.values()) if (!w.isDestroyed()) w.destroy()
    for (const pool of pools.values()) pool.clear()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('glass:refresh')
  }
  onSettingsChanged((s, prev) => {
    if (JSON.stringify(s.appearance) !== JSON.stringify(prev.appearance)) refresh()
  })
  // the system switched between light and dark (Theme: System)
  nativeTheme.on('updated', refresh)
  ipcMain.handle('glass:info', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return { regions: !!liquidGlass(), material: (win && materials.get(win)) ?? 'none' }
  })
  ipcMain.on('glass:regions', (e, regions: GlassRegion[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) setGlassRegions(win, regions)
  })
}
