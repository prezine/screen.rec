import { screen, systemPreferences } from 'electron'
import type { ClickEvent, CursorData, CursorSample } from '@shared/types'
import { classifyKey, type KeyEvent, type Mod } from '@shared/keys'

type Bounds = { x: number; y: number; width: number; height: number }

type KeyDown = { keycode: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

interface HookModule {
  UiohookKey?: Record<string, number>
  uIOhook: {
    on(event: 'mousedown', cb: (e: { button: number | unknown }) => void): void
    on(event: 'keydown', cb: (e: KeyDown) => void): void
    removeAllListeners(event?: string): void
    start(): void
    stop(): void
  }
}

let hook: HookModule | null | undefined

/** Load the optional global input hook (uiohook-napi). Returns null if unavailable. */
function loadHook(): HookModule | null {
  if (hook !== undefined) return hook
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hook = require('uiohook-napi') as HookModule
  } catch (err) {
    console.warn('[cursor] uiohook-napi not available, click tracking disabled:', (err as Error).message)
    hook = null
  }
  return hook
}

/** On macOS global mouse hooks require Accessibility permission. */
export function clickTrackingAvailable(prompt = false): boolean {
  if (!loadHook()) return false
  if (process.platform === 'darwin') return systemPreferences.isTrustedAccessibilityClient(prompt)
  return true
}

/**
 * Samples the global cursor position at ~60Hz and records mouse clicks.
 * Times are seconds of *recorded* time: pauses are excluded so data lines up with the video.
 */
export class CursorTracker {
  private samples: CursorSample[] = []
  private clicks: ClickEvent[] = []
  private timer: NodeJS.Timeout | null = null
  private startedAt = 0
  private pausedTotal = 0
  private pausedAt: number | null = null
  private hooked = false
  private keys: KeyEvent[] = []
  private typing: number[] = []
  private keyNames: Map<number, string> | null = null
  private lastX = NaN
  private lastY = NaN

  constructor(
    private bounds: Bounds | null,
    private trackClicks = true,
    private trackKeys = true
  ) {}

  get tracked(): boolean {
    return this.bounds !== null
  }

  /** Window recordings: the captured region follows the window as it moves. */
  setBounds(b: Bounds): void {
    this.bounds = b
  }

  start(startedAt: number): void {
    this.startedAt = startedAt
    if (!this.bounds) return
    this.timer = setInterval(() => this.sample(), 1000 / 60)
    this.sample()
    if ((this.trackClicks || this.trackKeys) && clickTrackingAvailable(false)) {
      try {
        const mod = loadHook()!
        const { uIOhook } = mod
        if (this.trackClicks) uIOhook.on('mousedown', (e) => this.onClick(Number(e.button)))
        if (this.trackKeys) {
          this.keyNames = new Map(Object.entries(mod.UiohookKey ?? {}).map(([name, code]) => [code, name]))
          uIOhook.on('keydown', (e) => this.onKey(e))
        }
        uIOhook.start()
        this.hooked = true
      } catch (err) {
        console.warn('[cursor] failed to start input hook', err)
      }
    }
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = Date.now()
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += Date.now() - this.pausedAt
      this.pausedAt = null
    }
  }

  private now(): number {
    return (Date.now() - this.startedAt - this.pausedTotal) / 1000
  }

  private normalised(): { x: number; y: number } {
    const p = screen.getCursorScreenPoint()
    const b = this.bounds!
    return { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height }
  }

  private sample(): void {
    if (this.pausedAt !== null || !this.bounds) return
    const t = this.now()
    if (t < 0) return
    const { x, y } = this.normalised()
    // skip duplicates to keep the file small, but keep a heartbeat every ~0.5s
    const last = this.samples[this.samples.length - 1]
    if (x === this.lastX && y === this.lastY && last && t - last[0] < 0.5) return
    this.lastX = x
    this.lastY = y
    this.samples.push([round(t, 4), round(x, 5), round(y, 5)])
  }

  private onClick(button: number): void {
    if (this.pausedAt !== null || !this.bounds) return
    const t = this.now()
    if (t < 0) return
    const { x, y } = this.normalised()
    const b: ClickEvent['button'] = button === 2 ? 'right' : button === 3 ? 'middle' : 'left'
    this.clicks.push({ t: round(t, 4), x: round(x, 5), y: round(y, 5), button: b })
  }

  private onKey(e: KeyDown): void {
    if (this.pausedAt !== null) return
    const t = this.now()
    if (t < 0) return
    const key = this.keyNames?.get(e.keycode)
    const mods: Mod[] = []
    if (e.metaKey) mods.push('meta')
    if (e.ctrlKey) mods.push('ctrl')
    if (e.altKey) mods.push('alt')
    if (e.shiftKey) mods.push('shift')
    const kind = classifyKey(key, mods)
    if (kind === 'typing') this.typing.push(round(t, 3))
    else if (kind === 'shortcut' || kind === 'special') {
      this.keys.push({ t: round(t, 3), key: key!, mods })
      // editing keys are part of a typing burst too
      if (kind === 'special' && (key === 'Backspace' || key === 'Delete')) this.typing.push(round(t, 3))
    }
  }

  stop(): CursorData {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.hooked) {
      try {
        const { uIOhook } = loadHook()!
        uIOhook.removeAllListeners('mousedown')
        uIOhook.removeAllListeners('keydown')
        uIOhook.stop()
      } catch {
        /* ignore */
      }
      this.hooked = false
    }
    return {
      samples: this.samples,
      clicks: this.clicks,
      tracked: this.tracked,
      keys: this.keys,
      typing: this.typing,
      platform: process.platform
    }
  }
}

function round(v: number, d: number): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}
