// A log file for support: everything the main process prints, renderer errors and crashes.
//   macOS    ~/Library/Logs/Toom/main.log
//   Windows  %APPDATA%\Toom\logs\main.log
// Help → Show Logs opens it. Session tokens and passwords never reach it (redacted below).
// Imported right after ./migrate in index.ts, so it records the app from its first moment.
import { app, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024

let file = ''
try {
  let dir: string
  try {
    dir = app.getPath('logs')
  } catch {
    dir = join(app.getPath('userData'), 'logs')
  }
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'main.log')
  // one previous file is kept, so a log never grows without end
  if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
} catch {
  file = ''
}

const redact = (s: string): string =>
  s
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/\btm_[\w-]{10,}/g, 'tm_[redacted]')
    .replace(/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"')

function format(v: unknown): string {
  if (v instanceof Error) {
    const cause = (v as Error & { cause?: unknown }).cause
    return `${v.stack ?? `${v.name}: ${v.message}`}${cause ? `\n  caused by: ${format(cause)}` : ''}`
  }
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function writeLog(level: string, args: unknown[]): void {
  if (!file) return
  try {
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(args.map(format).join(' '))}\n`)
  } catch {
    /* a full disk mustn't take the app down */
  }
}

export const logFile = (): string => file

/** Reveal main.log in Finder / Explorer. */
export function showLogs(): void {
  if (file && existsSync(file)) shell.showItemInFolder(file)
  else void shell.openPath(app.getPath('userData'))
}

/** The last lines of the log, for "copy diagnostics". */
export function recentLog(lines = 200): string {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}

// ---- everything the main process prints -------------------------------------------------
for (const [method, level] of [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error']
] as const) {
  const original = console[method].bind(console)
  console[method] = (...args: unknown[]) => {
    original(...args)
    writeLog(level, args)
  }
}

// ---- crashes and errors nobody caught ----------------------------------------------------
process.on('uncaughtExceptionMonitor', (err) => writeLog('fatal', ['uncaught exception', err]))
process.on('unhandledRejection', (reason) => writeLog('error', ['unhandled rejection', reason]))

app.on('render-process-gone', (_e, wc, d) => writeLog('error', [`window crashed (${d.reason}, exit ${d.exitCode}): ${wc.getURL().split('#')[1] ?? ''}`]))
app.on('child-process-gone', (_e, d) => {
  if (d.reason !== 'clean-exit') writeLog('error', [`${d.type} process gone (${d.reason}, exit ${d.exitCode})${d.name ? ` ${d.name}` : ''}`])
})

// renderer warnings and errors (including uncaught exceptions in a window)
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (...a: unknown[]) => {
    // Electron 35+: (event) with level/message on it; older: (event, level, message, line, source)
    const ev = a[0] as { level?: string | number; message?: string; lineNumber?: number; sourceId?: string }
    const level = typeof ev.level === 'string' ? ev.level : ['debug', 'info', 'warning', 'error'][Number(a[1])]
    if (level !== 'warning' && level !== 'error') return
    const message = ev.message ?? String(a[2] ?? '')
    const where = (ev.sourceId ?? String(a[4] ?? '')).split('/').pop()
    const route = wc.getURL().split('#')[1] ?? ''
    writeLog(level === 'error' ? 'error' : 'warn', [`[window ${route}] ${message}${where ? ` (${where}:${ev.lineNumber ?? a[3] ?? ''})` : ''}`])
  })
  wc.on('preload-error', (_ev, path, err) => writeLog('error', [`preload failed: ${path}`, err]))
})

writeLog('info', [
  `---- Toom ${app.getVersion()} starting · ${process.platform} ${release()} ${process.arch} · Electron ${process.versions.electron}${app.isPackaged ? '' : ' (development)'}`
])
