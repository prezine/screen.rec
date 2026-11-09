// App-wide Electron hardening. Every window loads Toom's own pages; nothing else may navigate,
// open windows, attach webviews or talk to the main process.

import { app, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

/** Toom's own pages: the bundled renderer (file://) or the dev server */
export function isAppUrl(url: string): boolean {
  if (!url) return false
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && url.startsWith(dev)) return true
  if (!url.startsWith('file://')) return false
  // the bundled renderer lives inside the app (app.asar/out/renderer/index.html)
  const path = decodeURIComponent(new URL(url).pathname)
  return path.replace(/\\/g, '/').endsWith('/out/renderer/index.html')
}

/** Only real web links leave the app, in the default browser. */
export function openExternalSafely(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || (u.protocol === 'http:' && !app.isPackaged)) void shell.openExternal(u.toString())
  } catch {
    /* not a URL */
  }
}

function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  return isAppUrl(url)
}

/**
 * Refuse IPC from anything that isn't one of Toom's pages (a frame that navigated away, an
 * injected iframe…). Installed before any handler is registered.
 */
function guardIpc(): void {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error(`Blocked IPC "${channel}" from ${e.senderFrame?.url ?? 'unknown'}`)
      return listener(e, ...args)
    })
  const on = ipcMain.on.bind(ipcMain)
  ipcMain.on = (channel, listener) =>
    on(channel, (e, ...args) => {
      if (!trusted(e)) return console.warn(`[security] blocked IPC "${channel}"`)
      listener(e, ...args)
    })
}

export function hardenApp(): void {
  guardIpc()
  app.on('web-contents-created', (_e, contents) => {
    // no navigating away from the app (a dropped file or link would otherwise replace the page)
    contents.on('will-navigate', (ev, url) => {
      if (!isAppUrl(url)) {
        ev.preventDefault()
        openExternalSafely(url)
      }
    })
    contents.on('will-redirect', (ev, url) => {
      if (!isAppUrl(url)) ev.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
  })
}
