import { spawn, type ChildProcess } from 'node:child_process'
import { screen } from 'electron'

export type Bounds = { x: number; y: number; width: number; height: number }

// Polls one window's on-screen frame (in Electron screen coordinates) a few times a second, so
// cursor positions can be normalised to a window recording. Uses tools every system already has:
// JavaScript for Automation on macOS, PowerShell on Windows.

const MAC_SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run(argv) {
  var id = parseInt(argv[0], 10);
  while (true) {
    var out = 'null';
    try {
      var ref = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionIncludingWindow, id);
      var list = ObjC.deepUnwrap(ObjC.castRefToObject(ref));
      if (list && list.length && list[0].kCGWindowBounds) {
        var b = list[0].kCGWindowBounds;
        out = JSON.stringify({ x: b.X, y: b.Y, width: b.Width, height: b.Height });
      }
    } catch (e) {}
    console.log(out);
    delay(0.2);
  }
}`

const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public static class W {
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
"@
$h = [IntPtr][Int64]$args[0]
while ($true) {
  if (-not [W]::IsWindow($h)) { [Console]::Out.WriteLine('null') }
  else {
    $r = New-Object RECT
    if ([W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { [void][W]::GetWindowRect($h, [ref]$r) }
    [Console]::Out.WriteLine('{"x":' + $r.Left + ',"y":' + $r.Top + ',"width":' + ($r.Right - $r.Left) + ',"height":' + ($r.Bottom - $r.Top) + '}')
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 200
}`

/** Native window id from a desktopCapturer source id like "window:1234:0". */
export function windowIdFromSource(sourceId: string): string | null {
  const m = /^window:(\d+)/.exec(sourceId)
  return m ? m[1] : null
}

export class WindowBoundsWatcher {
  private proc: ChildProcess | null = null
  private buf = ''
  bounds: Bounds | null = null

  constructor(
    private windowId: string,
    private onBounds?: (b: Bounds) => void
  ) {}

  /** Starts polling; resolves with the first bounds (or null after a short timeout). */
  start(timeoutMs = 2500): Promise<Bounds | null> {
    return new Promise((resolve) => {
      let settled = false
      const done = (b: Bounds | null): void => {
        if (settled) return
        settled = true
        resolve(b)
      }
      setTimeout(() => done(this.bounds), timeoutMs)
      try {
        if (process.platform === 'darwin') {
          this.proc = spawn('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, this.windowId], {
            stdio: ['ignore', 'pipe', 'pipe']
          })
        } else if (process.platform === 'win32') {
          this.proc = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT, this.windowId],
            {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true
            }
          )
        } else return done(null)
      } catch {
        return done(null)
      }
      const onData = (chunk: Buffer): void => {
        this.buf += chunk.toString()
        let i: number
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim()
          this.buf = this.buf.slice(i + 1)
          const b = parse(line)
          if (!b) continue
          this.bounds = b
          this.onBounds?.(b)
          done(b)
        }
      }
      // JXA's console.log writes to stderr
      this.proc.stdout?.on('data', onData)
      this.proc.stderr?.on('data', onData)
      this.proc.on('error', () => done(null))
      this.proc.on('exit', () => done(this.bounds))
    })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}

function parse(line: string): Bounds | null {
  if (!line.startsWith('{')) return null
  try {
    const b = JSON.parse(line) as Bounds
    if (!(b.width > 0 && b.height > 0)) return null
    // Windows reports physical pixels; Electron's screen API works in DIPs
    if (process.platform === 'win32') {
      const r = screen.screenToDipRect(null, b)
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return b
  } catch {
    return null
  }
}
